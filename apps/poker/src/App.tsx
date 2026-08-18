import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, useConnect, useDisconnect } from '@starknet-react/core';
import { isLocal } from './config';
import { useArtifacts } from './hooks/useArtifacts';
import { useDevnetStatus } from './hooks/useDevnetStatus';
import { useContractPoller } from './hooks/useContractPoller';
import { useGameActions } from './hooks/useGameActions';
import { createPlayerContext, createPlayerContextFromController } from './game/sdk-factory';
import { TexasHoldemContract } from '@mental-poker/sdk';
import { RpcProvider, Account, Signer } from 'starknet';
import { determineAction, isAutoAction } from './game/phase-logic';
import type { PlayerAction } from './game/phase-logic';
import type { Screen, DeployedConfig, PlayerContext, LogEntry, CardSlot, HandResult, RoomConfig } from './types';
import { getCommunityCardIndices } from './constants';

import { LobbyScreen } from './screens/LobbyScreen';
import { GameScreen } from './screens/GameScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { HandResultOverlay } from './components/HandResultOverlay';
import { NetworkBanner } from './components/NetworkBanner';

export default function App() {
  // --- Core state ---
  const [screen, setScreen] = useState<Screen>('lobby');
  const [deployed, setDeployed] = useState<DeployedConfig | null>(null);
  const [playerCtx, setPlayerCtx] = useState<PlayerContext | null>(null);
  const [gameId, setGameId] = useState<bigint | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logCounter = useRef(0);

  // Card display state (built from polled state)
  const [myHoleCards, setMyHoleCards] = useState<CardSlot[]>([]);
  const [otherPlayersHoleCards, setOtherPlayersHoleCards] = useState<Map<number, CardSlot[]>>(new Map());
  const [communityCards, setCommunityCards] = useState<CardSlot[]>([]);

  // Track what we've already done (to avoid re-executing auto-actions)
  const [completedActions, setCompletedActions] = useState<Set<string>>(new Set());
  const executingRef = useRef(false);

  // Track individual card reveals/unmasks to avoid duplicate submissions (race condition fix)
  const submittedRevealsRef = useRef<Set<number>>(new Set());
  const unmaskedCardsRef = useRef<Set<number>>(new Set());

  // Locally decrypted hole cards — NOT stored on-chain (private until showdown)
  const [localDecryptedCards, setLocalDecryptedCards] = useState<Map<number, number>>(new Map());
  const localDecryptedRef = useRef<Set<number>>(new Set()); // for dedup in auto-execute

  // Lobby state
  const [lobbyStatus, setLobbyStatus] = useState(
    isLocal ? '' : 'Connect your wallet to continue'
  );
  const [lobbyLoading, setLobbyLoading] = useState(false);
  const [lobbyError, setLobbyError] = useState<string | null>(null);

  // Lobby state
  const [createdGameId, setCreatedGameId] = useState<bigint | null>(null);
  const [activeBigBlind, setActiveBigBlind] = useState<bigint>(10n);

  // Track which poker phases we've already advanced past
  const advancedPhasesRef = useRef<Set<number>>(new Set());

  // Track whether the betting round is complete on-chain (for River → Showdown detection)
  const [bettingRoundComplete, setBettingRoundComplete] = useState(false);

  // Hand result overlay (shown between hands)
  const [handResult, setHandResult] = useState<HandResult | null>(null);
  const handResultBlockRef = useRef(false); // synchronous guard — set before setHandResult
  const prevStacksRef = useRef<bigint[]>([]);

  // Retry counters to prevent infinite loops
  const showdownRetriesRef = useRef(0);
  const MAX_SHOWDOWN_RETRIES = 3;
  const verifyRetriesRef = useRef(0);
  const MAX_VERIFY_RETRIES = 3;

  // Track successfully completed verify/showdown to avoid re-execution on Sepolia
  // (poller latency can cause determineAction to return the same action before state updates)
  const verifiedPlayersRef = useRef<Set<number>>(new Set());
  const showdownDoneRef = useRef(false);

  // Track the last handNumber for which PREPARE_NEW_HAND was called
  const lastPreparedHandRef = useRef(-1);

  // Cumulative unmasked cards — accumulates throughout a hand, never loses entries when
  // pokerPhase resets to 0 (which causes polledState.unmaskedCards to lose community cards)
  const cumulativeUnmaskedRef = useRef<Map<number, number>>(new Map());

  // --- Starknet React hooks (sepolia mode only, harmless in local mode) ---
  const { account: controllerAccount, address: controllerAddress, isConnected: walletConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  // --- Load deployed config ---
  useEffect(() => {
    if (isLocal) {
      // Devnet: load from static JSON (includes test accounts)
      fetch('/deployed-poker.json')
        .then(res => res.json())
        .then(setDeployed)
        .catch(err => console.error('Failed to load deployed-poker.json:', err));
    } else {
      // Sepolia: build config from env vars
      const contractAddr = import.meta.env.VITE_CONTRACT_ADDRESS ?? '';
      const rpc = import.meta.env.VITE_RPC_URL ?? 'https://api.cartridge.gg/x/starknet/sepolia';
      setDeployed({
        url: rpc,
        contracts: { texas_holdem: contractAddr },
        config: { small_blind: 5, big_blind: 10, initial_stack: 1000 },
      });
    }
  }, []);

  const rpcUrl = deployed?.url ?? 'http://localhost:5050';
  // null off devnet, so the poller genuinely stops rather than failing on a dead URL.
  const { isAlive: devnetAlive } = useDevnetStatus(isLocal ? rpcUrl : null);
  const { artifacts, loading: artifactsLoading } = useArtifacts();

  // --- Lightweight contract reader (for polling games without full SDK) ---
  const readerRef = useRef<TexasHoldemContract | null>(null);
  useEffect(() => {
    if (!deployed) return;
    const provider = new RpcProvider({ nodeUrl: deployed.url });
    // Dummy account — only used for read calls, never signs
    const dummyAccount = new Account({ provider, address: '0x0', signer: new Signer('0x1') });
    readerRef.current = new TexasHoldemContract(deployed.contracts.texas_holdem, dummyAccount as any);
  }, [deployed]);

  // --- Logging ---
  const addLog = useCallback((phase: string, message: string, txHash?: string, duration?: number) => {
    const entry: LogEntry = {
      id: logCounter.current++,
      timestamp: Date.now(),
      phase,
      message,
      txHash,
      duration,
    };
    setLogs(prev => [...prev, entry]);
  }, []);

  // --- SDK hooks ---
  const { state: polledState, startPolling, stopPolling, forcePoll } = useContractPoller(
    playerCtx?.sdk ?? null,
    gameId,
    playerCtx?.playerIndex ?? 0,
  );

  const actions = useGameActions(
    playerCtx?.sdk ?? null,
    playerCtx?.secretKey ?? 0n,
    addLog,
  );

  // =============================================
  // LOBBY: Create Room
  // =============================================

  const handleCreateRoom = useCallback(async (config: RoomConfig) => {
    if (!deployed || !artifacts) return;
    if (isLocal && (!devnetAlive || !artifacts)) return;
    if (!isLocal && !controllerAccount) return;

    setLobbyLoading(true);
    setLobbyError(null);
    setCreatedGameId(null);

    try {
      const reader = readerRef.current!;
      const targetGameId = await reader.getNextGameId();
      const playerNumber = 1;

      setLobbyStatus(`Initializing as Player ${playerNumber}...`);

      let ctx: PlayerContext;
      if (isLocal) {
        ctx = await createPlayerContext(playerNumber, deployed, artifacts);
      } else {
        ctx = await createPlayerContextFromController(controllerAccount!, deployed, artifacts, playerNumber);
      }

      setPlayerCtx(ctx);
      addLog('INFO', `Player ${playerNumber} initialized (${ctx.address.slice(0, 10)}...)`);

      setLobbyStatus('Creating table...');
      await ctx.sdk.createTable({
        maxPlayers: config.maxPlayers,
        smallBlind: config.smallBlind,
        bigBlind: config.bigBlind,
        initialStack: config.initialStack,
      });
      addLog('CREATE', `Room created (${config.maxPlayers} players, ${config.initialStack.toString()} stack)`);

      setCreatedGameId(targetGameId);
      setGameId(targetGameId);
      setActiveBigBlind(config.bigBlind);

      setLobbyStatus('Joining table (generating key ownership proof)...');
      await ctx.sdk.joinTable(targetGameId, ctx.secretKey);
      addLog('JOIN', `Joined game #${targetGameId} as Player ${playerNumber}`);

      setLobbyStatus(`Waiting for other players... (1/${config.maxPlayers})`);
      setLobbyLoading(false);
      startPolling();
    } catch (err: any) {
      setPlayerCtx(null);
      setGameId(null);
      setCreatedGameId(null);
      setLobbyLoading(false);
      setLobbyError(err.message || 'Failed to create room');
      addLog('ERROR', `Create room failed: ${err.message}`);
    }
  }, [deployed, artifacts, controllerAccount, devnetAlive, addLog, startPolling]);

  // =============================================
  // LOBBY: Join Game by ID
  // =============================================

  const handleJoinGame = useCallback(async (gameIdStr: string) => {
    if (!deployed || !artifacts) return;
    if (isLocal && (!devnetAlive || !artifacts)) return;
    if (!isLocal && !controllerAccount) return;

    setLobbyLoading(true);
    setLobbyError(null);

    try {
      const targetGameId = BigInt(gameIdStr);
      const reader = readerRef.current!;

      // Read game info from contract
      const [gameState, numPlayers, maxPlayers] = await Promise.all([
        reader.getGameState(targetGameId),
        reader.getGamePlayers(targetGameId),
        reader.getGameMaxPlayers(targetGameId),
      ]);

      if (gameState !== 1) {
        throw new Error(`Game #${targetGameId} is not in Registration state (state=${gameState})`);
      }
      if (numPlayers >= maxPlayers) {
        throw new Error(`Game #${targetGameId} is full (${numPlayers}/${maxPlayers})`);
      }

      // Read big blind from contract
      let bigBlind = 10n;
      try {
        bigBlind = await reader.getBigBlind();
      } catch {
        // fallback to default
      }

      const playerIndex = numPlayers;
      const playerNumber = playerIndex + 1;

      setLobbyStatus(`Initializing as Player ${playerNumber}...`);

      let ctx: PlayerContext;
      if (isLocal) {
        ctx = await createPlayerContext(playerNumber, deployed, artifacts);
      } else {
        ctx = await createPlayerContextFromController(controllerAccount!, deployed, artifacts, playerNumber);
      }

      setPlayerCtx(ctx);
      addLog('INFO', `Player ${playerNumber} initialized (${ctx.address.slice(0, 10)}...)`);

      setGameId(targetGameId);
      setActiveBigBlind(bigBlind);

      setLobbyStatus('Joining table (generating key ownership proof)...');
      await ctx.sdk.joinTable(targetGameId, ctx.secretKey);
      addLog('JOIN', `Joined game #${targetGameId} as Player ${playerNumber}`);

      setLobbyStatus(`Waiting for other players... (${playerNumber}/${maxPlayers})`);
      setLobbyLoading(false);
      startPolling();
    } catch (err: any) {
      setPlayerCtx(null);
      setGameId(null);
      setLobbyLoading(false);
      setLobbyError(err.message || 'Failed to join game');
      addLog('ERROR', `Join game failed: ${err.message}`);
    }
  }, [deployed, artifacts, controllerAccount, devnetAlive, addLog, startPolling]);

  // =============================================
  // SEPOLIA MODE: Wallet connect
  // =============================================

  const handleConnect = useCallback(() => {
    if (connectors.length > 0) {
      connect({ connector: connectors[0] });
    }
  }, [connect, connectors]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    setPlayerCtx(null);
    setGameId(null);
    setCreatedGameId(null);
    setLobbyLoading(false);
    setLobbyError(null);
    setLobbyStatus('Connect your wallet to continue');
  }, [disconnect]);

  // --- Leave table (abandon seat while waiting — local only, no contract call) ---
  const handleLeaveTable = useCallback(() => {
    stopPolling();
    setPlayerCtx(null);
    setGameId(null);
    setCreatedGameId(null);
    setLobbyLoading(false);
    setLobbyError(null);
    setLobbyStatus(isLocal ? '' : 'Connect your wallet to continue');
  }, [stopPolling]);

  // =============================================
  // SHARED: Game flow (identical for both modes)
  // =============================================

  // --- Update lobby status when enough players join ---
  useEffect(() => {
    if (screen !== 'lobby') return;
    if (playerCtx?.playerIndex !== 0) return;
    if (polledState.numPlayers >= polledState.maxPlayers && gameId !== null) {
      setLobbyStatus('All players joined! Starting game...');
    }
  }, [playerCtx?.playerIndex, screen, polledState.numPlayers, polledState.maxPlayers, gameId]);

  // --- Transition lobby -> game when gameState advances ---
  useEffect(() => {
    if (screen === 'lobby' && polledState.gameState >= 2) {
      setScreen('game');
      addLog('INFO', 'Game started! Entering game screen.');
    }
  }, [screen, polledState.gameState, addLog]);

  // --- Reset completed actions when game goes back to Shuffle (new hand) ---
  const prevGameStateRef = useRef(0);
  useEffect(() => {
    const gs = polledState.gameState;
    // If we went from Deal(3) back to Shuffle(2), it's a new hand shuffle
    if (prevGameStateRef.current === 3 && gs === 2) {
      setCompletedActions(new Set());
      addLog('INFO', 'New hand: shuffling deck...');
    }
    prevGameStateRef.current = gs;
  }, [polledState.gameState, addLog]);

  // --- Build card display from polled state ---
  useEffect(() => {
    if (!playerCtx || polledState.gameState < 3) return;

    const myIdx = playerCtx.playerIndex;
    const numPlayers = polledState.numPlayers;
    const numActive = polledState.numActive;

    // My hole cards (using compact active indices from poller)
    const myIndices = polledState.myHoleCardIndices;
    setMyHoleCards(myIndices.map(idx => ({
      index: idx,
      value: localDecryptedCards.get(idx) ?? polledState.unmaskedCards.get(idx) ?? null,
      faceUp: localDecryptedCards.has(idx) || polledState.unmaskedCards.has(idx),
    })));

    // Other players' hole cards
    const showOtherCards = polledState.pokerPhase >= 5 || polledState.gameState === 4;
    const othersMap = new Map<number, CardSlot[]>();
    for (let p = 0; p < numPlayers; p++) {
      if (p === myIdx) continue;
      const pIndices = polledState.otherPlayersHoleCardIndices.get(p);
      if (!pIndices) continue;
      othersMap.set(p, pIndices.map(idx => ({
        index: idx,
        value: showOtherCards ? (polledState.unmaskedCards.get(idx) ?? null) : null,
        faceUp: showOtherCards && polledState.unmaskedCards.has(idx),
      })));
    }
    setOtherPlayersHoleCards(othersMap);

    // Community cards (use numActive for indices)
    const commIndices = getCommunityCardIndices(numActive);
    const allCommIndices = [
      ...commIndices.flop,
      ...commIndices.turn,
      ...commIndices.river,
    ];
    setCommunityCards(allCommIndices.map(idx => ({
      index: idx,
      value: polledState.unmaskedCards.get(idx) ?? null,
      faceUp: polledState.unmaskedCards.has(idx),
    })));
  }, [playerCtx, polledState, localDecryptedCards]);

  // --- Determine current action ---
  const currentAction: PlayerAction | null = playerCtx && gameId !== null && polledState.gameState >= 1
    ? determineAction(polledState, playerCtx.playerIndex, new Set(localDecryptedCards.keys()), bettingRoundComplete, lastPreparedHandRef.current)
    : null;

  // --- Auto-execute actions ---
  useEffect(() => {
    if (!currentAction || !playerCtx || gameId === null || actions.loading || executingRef.current) return;
    if (!isAutoAction(currentAction)) return;
    // Don't auto-execute while hand result overlay is shown (ref for sync check)
    if (handResult || handResultBlockRef.current) return;

    const actionKey = JSON.stringify({
      type: currentAction.type,
      ...(currentAction.type === 'SUBMIT_REVEALS' ? { cards: currentAction.cardIndices } : {}),
      ...(currentAction.type === 'DECRYPT_AND_UNMASK' ? { cards: currentAction.cardIndices } : {}),
      ...(currentAction.type === 'DECRYPT_LOCAL' ? { cards: currentAction.cardIndices } : {}),
      ...(currentAction.type === 'VERIFY_HOLE_CARDS' ? { player: currentAction.playerIndex } : {}),
    });

    // For VERIFY_HOLE_CARDS and SHOWDOWN, don't use completedActions —
    // rely on retry counters instead (on-chain state drives retries via determineAction).
    if (currentAction.type === 'VERIFY_HOLE_CARDS' && verifyRetriesRef.current >= MAX_VERIFY_RETRIES) return;
    if (currentAction.type === 'SHOWDOWN' && showdownRetriesRef.current >= MAX_SHOWDOWN_RETRIES) return;
    const skipCompletedCheck = currentAction.type === 'VERIFY_HOLE_CARDS' || currentAction.type === 'SHOWDOWN';
    if (!skipCompletedCheck && completedActions.has(actionKey)) return;

    executingRef.current = true;

    const execute = async () => {
      let success = true;
      try {
        switch (currentAction.type) {
          case 'START_TABLE': {
            addLog('INFO', 'Auto: Starting table...');
            const r = await actions.startTable(gameId);
            if (r === null) success = false;
            break;
          }
          case 'SHUFFLE': {
            addLog('INFO', 'Auto: Shuffling deck...');
            const r = await actions.shuffle(gameId);
            if (r === null) success = false;
            break;
          }
          case 'START_HAND': {
            addLog('INFO', 'Auto: Starting hand...');
            const r = await actions.startHand(gameId);
            if (r === null) success = false;
            break;
          }
          case 'SUBMIT_REVEALS': {
            const pendingReveals = currentAction.cardIndices.filter(
              idx => !submittedRevealsRef.current.has(idx)
            );
            if (pendingReveals.length === 0) break;
            for (const cardIdx of pendingReveals) {
              addLog('REVEAL', `Auto: Submitting reveal for card ${cardIdx}...`);
              const r = await actions.submitRevealToken(gameId, cardIdx);
              if (r === null) { success = false; break; }
              submittedRevealsRef.current.add(cardIdx);
            }
            break;
          }
          case 'DECRYPT_LOCAL': {
            const pendingLocal = currentAction.cardIndices.filter(
              idx => !localDecryptedRef.current.has(idx)
            );
            if (pendingLocal.length === 0) break;
            for (const cardIdx of pendingLocal) {
              addLog('DECRYPT', `Auto: Decrypting card ${cardIdx} locally (private)...`);
              const value = await actions.decryptLocal(gameId, cardIdx);
              if (value === null) { success = false; break; }
              localDecryptedRef.current.add(cardIdx);
              setLocalDecryptedCards(prev => new Map(prev).set(cardIdx, value));
            }
            break;
          }
          case 'DECRYPT_AND_UNMASK': {
            const pendingUnmask = currentAction.cardIndices.filter(
              idx => !unmaskedCardsRef.current.has(idx)
            );
            if (pendingUnmask.length === 0) break;
            for (const cardIdx of pendingUnmask) {
              addLog('UNMASK', `Auto: Decrypting card ${cardIdx}...`);
              const r = await actions.decryptAndUnmask(gameId, cardIdx);
              if (r === null) { success = false; break; }
              unmaskedCardsRef.current.add(cardIdx);
            }
            break;
          }
          case 'ADVANCE_PHASE': {
            addLog('PHASE', 'Auto: Advancing phase...');
            const r = await actions.advancePhase(gameId);
            if (r === null) success = false;
            break;
          }
          case 'VERIFY_HOLE_CARDS': {
            // Skip if already verified locally (avoids re-execution before poller catches up)
            if (verifiedPlayersRef.current.has(currentAction.playerIndex)) {
              console.log('[VERIFY] skipping — player', currentAction.playerIndex, 'already verified locally');
              break;
            }
            verifyRetriesRef.current++;
            addLog('VERIFY', `Auto: Verifying hole cards for Player ${currentAction.playerIndex + 1}...`);
            console.log('[VERIFY] calling verifyHoleCards, gameId:', gameId.toString(), 'playerIndex:', currentAction.playerIndex);
            const r = await actions.verifyHoleCards(gameId, currentAction.playerIndex);
            console.log('[VERIFY] result:', r);
            if (r === null) {
              console.error('[VERIFY] verifyHoleCards returned null (failed)');
              success = false;
            } else {
              console.log('[VERIFY] verifyHoleCards succeeded, txHash:', r);
              verifiedPlayersRef.current.add(currentAction.playerIndex);
            }
            break;
          }
          case 'PREPARE_NEW_HAND': {
            addLog('INFO', 'Auto: Preparing new hand (new APK + deck)...');
            const r = await actions.prepareNewHand(gameId);
            if (r === null) success = false;
            else lastPreparedHandRef.current = polledState.handNumber;
            break;
          }
          case 'SHOWDOWN': {
            // Skip if already completed locally (avoids re-execution before poller catches up)
            if (showdownDoneRef.current) {
              console.log('[SHOWDOWN] skipping — already completed locally');
              break;
            }
            if (showdownRetriesRef.current >= MAX_SHOWDOWN_RETRIES) {
              addLog('ERROR', 'Showdown failed after max retries. Waiting for state to update...');
              break;
            }
            showdownRetriesRef.current++;
            addLog('INFO', 'Auto: Running showdown...');
            const r = await actions.showdown(gameId);
            if (r === null) {
              success = false;
            } else {
              showdownDoneRef.current = true;
            }
            break;
          }
        }

        if (success) {
          setCompletedActions(prev => new Set(prev).add(actionKey));
        }
      } catch (err: any) {
        addLog('ERROR', `Auto-action failed: ${err.message}`);
      } finally {
        executingRef.current = false;
        setTimeout(forcePoll, 500);
      }
    };

    execute();
  }, [currentAction, playerCtx, gameId, actions, completedActions, addLog, forcePoll]);

  // --- Try advance phase after betting (P1 only) ---
  const tryAdvancePhase = useCallback(async () => {
    if (!playerCtx || gameId === null || playerCtx.playerIndex !== 0 || executingRef.current) return;

    const phase = polledState.pokerPhase;
    if (phase < 1 || phase > 3 || advancedPhasesRef.current.has(phase)) return;

    try {
      const contract = playerCtx.sdk.getContract();
      const ready = await contract.isBettingRoundComplete(gameId);
      if (!ready) return;
    } catch {
      return;
    }

    executingRef.current = true;
    try {
      const result = await actions.advancePhase(gameId);
      if (result !== null) {
        advancedPhasesRef.current.add(phase);
        setCompletedActions(new Set());
        addLog('PHASE', `Advanced to next phase`);
        setTimeout(forcePoll, 500);
      } else {
        actions.setError(null);
      }
    } catch (err: any) {
      console.log('[AdvancePhase] Error:', err.message);
    } finally {
      executingRef.current = false;
    }
  }, [playerCtx, gameId, polledState.pokerPhase, actions, addLog, forcePoll]);

  // --- Try to start showdown after River betting (P1 only) ---
  const tryShowdown = useCallback(async () => {
    if (!playerCtx || gameId === null || executingRef.current) return;
    if (polledState.pokerPhase !== 4) return;
    if (bettingRoundComplete) return;

    try {
      const contract = playerCtx.sdk.getContract();
      const ready = await contract.isBettingRoundComplete(gameId);
      if (ready) {
        setBettingRoundComplete(true);
        showdownRetriesRef.current = 0;
        verifyRetriesRef.current = 0;
        setCompletedActions(new Set());
        setTimeout(forcePoll, 500);
      }
    } catch {
      // ignore
    }
  }, [playerCtx, gameId, polledState.pokerPhase, bettingRoundComplete, forcePoll]);

  // --- Betting handlers ---
  const handleFold = useCallback(async () => {
    if (gameId === null) return;
    await actions.fold(gameId);
    setCompletedActions(new Set());
    setTimeout(forcePoll, 500);
    if (polledState.pokerPhase < 4) setTimeout(tryAdvancePhase, 1500);
    if (polledState.pokerPhase === 4) setTimeout(tryShowdown, 1500);
  }, [gameId, actions, forcePoll, tryAdvancePhase, tryShowdown, polledState.pokerPhase]);

  const handleCheck = useCallback(async () => {
    if (gameId === null) return;
    await actions.check(gameId);
    setCompletedActions(new Set());
    setTimeout(forcePoll, 500);
    if (polledState.pokerPhase < 4) setTimeout(tryAdvancePhase, 1500);
    if (polledState.pokerPhase === 4) setTimeout(tryShowdown, 1500);
  }, [gameId, actions, forcePoll, tryAdvancePhase, tryShowdown, polledState.pokerPhase]);

  const handleCall = useCallback(async () => {
    if (gameId === null) return;
    await actions.call(gameId);
    setCompletedActions(new Set());
    setTimeout(forcePoll, 500);
    if (polledState.pokerPhase < 4) setTimeout(tryAdvancePhase, 1500);
    if (polledState.pokerPhase === 4) setTimeout(tryShowdown, 1500);
  }, [gameId, actions, forcePoll, tryAdvancePhase, tryShowdown, polledState.pokerPhase]);

  const handleRaise = useCallback(async (amount: bigint) => {
    if (gameId === null) return;
    await actions.raise(gameId, amount);
    setCompletedActions(new Set());
    setTimeout(forcePoll, 500);
  }, [gameId, actions, forcePoll]);

  // --- P1: try to advance phase on every poll update ---
  useEffect(() => {
    if (!playerCtx || playerCtx.playerIndex !== 0 || !gameId) return;
    if (polledState.gameState !== 3 || actions.loading || executingRef.current) return;

    const phase = polledState.pokerPhase;
    if (phase < 1 || phase > 3) return;
    if (advancedPhasesRef.current.has(phase)) return;

    const timer = setTimeout(tryAdvancePhase, 1500);
    return () => clearTimeout(timer);
  }, [playerCtx, gameId, polledState, actions.loading, tryAdvancePhase]);

  // --- All players: check if River betting is complete on every poll update ---
  useEffect(() => {
    if (!playerCtx || !gameId) return;
    if (polledState.gameState !== 3 || polledState.pokerPhase !== 4) return;
    if (bettingRoundComplete) return;
    if (actions.loading || executingRef.current) return;

    const timer = setTimeout(tryShowdown, 1500);
    return () => clearTimeout(timer);
  }, [playerCtx, gameId, polledState, bettingRoundComplete, actions.loading, tryShowdown]);

  // --- Reset bettingRoundComplete when phase changes ---
  useEffect(() => {
    setBettingRoundComplete(false);
    showdownRetriesRef.current = 0;
    verifyRetriesRef.current = 0;
    // Reset local completion tracking when phase changes (new hand)
    if (polledState.pokerPhase === 0) {
      verifiedPlayersRef.current = new Set();
      showdownDoneRef.current = false;
    }
  }, [polledState.pokerPhase]);

  // --- Accumulate unmasked cards throughout the hand ---
  // polledState.unmaskedCards loses community cards when pokerPhase resets to 0 after showdown.
  // This ref keeps all cards seen during the hand so we can use them in the result overlay.
  useEffect(() => {
    for (const [idx, val] of polledState.unmaskedCards) {
      cumulativeUnmaskedRef.current.set(idx, val);
    }
  }, [polledState.unmaskedCards]);

  // --- Detect hand result when hand number increases ---
  const prevHandNumberRef = useRef(0);

  useEffect(() => {
    const hn = polledState.handNumber;
    if (hn > prevHandNumberRef.current && prevHandNumberRef.current >= 0) {
      // A hand just ended — build result from polled state
      // unmaskedCards still has values (only reset in prepare_new_hand_internal)
      const prevStacks = prevStacksRef.current;
      if (prevStacks.length > 0 && playerCtx) {
        // Find winner: who gained the most chips
        let winnerIdx = 0;
        let maxGain = -Infinity;
        for (let i = 0; i < polledState.stacks.length; i++) {
          const gain = Number((polledState.stacks[i] ?? 0n) - (prevStacks[i] ?? 0n));
          if (gain > maxGain) {
            maxGain = gain;
            winnerIdx = i;
          }
        }
        const potWon = maxGain > 0 ? BigInt(maxGain) : 0n;

        // Determine reason: if all but one folded, it was a fold-win
        const nonFolded = polledState.folded.filter(f => !f).length;
        const reason: 'showdown' | 'fold' = nonFolded <= 1 ? 'fold' : 'showdown';

        // Build cards from cumulative unmasked map (preserves values even after pokerPhase resets)
        const cumUnmasked = cumulativeUnmaskedRef.current;
        const numActive = polledState.numActive > 0 ? polledState.numActive : polledState.numPlayers;
        const holeCardsMap = new Map<number, CardSlot[]>();

        // My hole cards (use local decrypted or unmasked)
        const myIndices = polledState.myHoleCardIndices;
        holeCardsMap.set(playerCtx.playerIndex, myIndices.map(idx => ({
          index: idx,
          value: localDecryptedCards.get(idx) ?? cumUnmasked.get(idx) ?? null,
          faceUp: localDecryptedCards.has(idx) || cumUnmasked.has(idx),
        })));

        // Other players' hole cards (from cumulative unmasked — available after showdown)
        for (const [pIdx, indices] of polledState.otherPlayersHoleCardIndices) {
          holeCardsMap.set(pIdx, indices.map(idx => ({
            index: idx,
            value: cumUnmasked.get(idx) ?? null,
            faceUp: cumUnmasked.has(idx),
          })));
        }

        // Community cards from cumulative unmasked
        const commIndices = getCommunityCardIndices(numActive);
        const allCommIndices = [...commIndices.flop, ...commIndices.turn, ...commIndices.river];
        const resultCommunityCards: CardSlot[] = allCommIndices.map(idx => ({
          index: idx,
          value: cumUnmasked.get(idx) ?? null,
          faceUp: cumUnmasked.has(idx),
        }));

        handResultBlockRef.current = true; // sync guard before async setState
        setHandResult({
          handNumber: prevHandNumberRef.current + 1,
          winnerIndex: winnerIdx,
          amount: polledState.lastWinnerAmount ?? potWon,
          reason,
          handRank: reason === 'showdown' ? polledState.lastWinnerRank : undefined,
          stacks: [...polledState.stacks],
          communityCards: resultCommunityCards,
          holeCards: holeCardsMap,
        });
      }

      // Reset per-hand local state
      cumulativeUnmaskedRef.current = new Map();
      setLocalDecryptedCards(new Map());
      localDecryptedRef.current = new Set();
      submittedRevealsRef.current = new Set();
      unmaskedCardsRef.current = new Set();
      setCompletedActions(new Set());
      advancedPhasesRef.current = new Set();
      setBettingRoundComplete(false);
      showdownRetriesRef.current = 0;
      verifyRetriesRef.current = 0;
      setMyHoleCards([]);
      setOtherPlayersHoleCards(new Map());
      setCommunityCards([]);
      addLog('INFO', `Hand #${hn} starting...`);
    }
    prevHandNumberRef.current = hn;
  }, [polledState, addLog, playerCtx, localDecryptedCards]);

  // --- Track stacks for hand result detection ---
  // Capture stacks when deal phase starts (before any betting)
  const stacksCapturedForHandRef = useRef(-1);
  useEffect(() => {
    if (polledState.stacks.length > 0 && polledState.gameState === 3) {
      // Capture at first poll of each hand
      if (stacksCapturedForHandRef.current !== polledState.handNumber) {
        prevStacksRef.current = [...polledState.stacks];
        stacksCapturedForHandRef.current = polledState.handNumber;
      }
    }
  }, [polledState.stacks, polledState.gameState, polledState.handNumber]);

  // --- Game over detection ---
  const gameOverHandledRef = useRef(false);
  useEffect(() => {
    if (polledState.gameState === 4 && screen === 'game' && !gameOverHandledRef.current && playerCtx) {
      gameOverHandledRef.current = true;
      const prevStacks = prevStacksRef.current;
      if (prevStacks.length > 0) {
        let winnerIdx = 0;
        let maxGain = -Infinity;
        for (let i = 0; i < polledState.stacks.length; i++) {
          const gain = Number((polledState.stacks[i] ?? 0n) - (prevStacks[i] ?? 0n));
          if (gain > maxGain) {
            maxGain = gain;
            winnerIdx = i;
          }
        }
        const potWon = maxGain > 0 ? BigInt(maxGain) : 0n;
        const nonFolded = polledState.folded.filter(f => !f).length;
        const reason: 'showdown' | 'fold' = nonFolded <= 1 ? 'fold' : 'showdown';

        // Build cards from cumulative unmasked map (polledState.unmaskedCards loses
        // community cards when pokerPhase resets to 0 at game end)
        const cumUnmasked = cumulativeUnmaskedRef.current;
        const numActive = polledState.numActive > 0 ? polledState.numActive : polledState.numPlayers;
        const holeCardsMap = new Map<number, CardSlot[]>();
        const myIndices = polledState.myHoleCardIndices;
        holeCardsMap.set(playerCtx.playerIndex, myIndices.map(idx => ({
          index: idx,
          value: localDecryptedCards.get(idx) ?? cumUnmasked.get(idx) ?? null,
          faceUp: localDecryptedCards.has(idx) || cumUnmasked.has(idx),
        })));
        for (const [pIdx, indices] of polledState.otherPlayersHoleCardIndices) {
          holeCardsMap.set(pIdx, indices.map(idx => ({
            index: idx,
            value: cumUnmasked.get(idx) ?? null,
            faceUp: cumUnmasked.has(idx),
          })));
        }
        const commIndices = getCommunityCardIndices(numActive);
        const allCommIndices = [...commIndices.flop, ...commIndices.turn, ...commIndices.river];
        const gameOverCommCards: CardSlot[] = allCommIndices.map(idx => ({
          index: idx,
          value: cumUnmasked.get(idx) ?? null,
          faceUp: cumUnmasked.has(idx),
        }));

        // Also update display state so ResultsScreen (shown after overlay dismiss) has correct cards
        setCommunityCards(gameOverCommCards);
        const othersForResults = new Map<number, CardSlot[]>();
        for (const [pIdx, indices] of polledState.otherPlayersHoleCardIndices) {
          othersForResults.set(pIdx, indices.map(idx => ({
            index: idx,
            value: cumUnmasked.get(idx) ?? null,
            faceUp: cumUnmasked.has(idx),
          })));
        }
        setOtherPlayersHoleCards(othersForResults);

        handResultBlockRef.current = true;
        setHandResult({
          handNumber: polledState.handNumber + 1,
          winnerIndex: winnerIdx,
          amount: polledState.lastWinnerAmount ?? potWon,
          reason,
          handRank: reason === 'showdown' ? polledState.lastWinnerRank : undefined,
          stacks: [...polledState.stacks],
          communityCards: gameOverCommCards,
          holeCards: holeCardsMap,
        });
      } else {
        setScreen('results');
        stopPolling();
        addLog('INFO', 'Game complete!');
      }
    }
  }, [polledState, screen, stopPolling, addLog, playerCtx, localDecryptedCards]);

  const handlePlayAgain = useCallback(() => {
    window.location.reload();
  }, []);

  const handleDismissHandResult = useCallback(() => {
    handResultBlockRef.current = false;
    setHandResult(null);
    prevStacksRef.current = [...polledState.stacks];
    // If the game ended, now transition to results screen
    if (polledState.gameState === 4) {
      setScreen('results');
      stopPolling();
      addLog('INFO', 'Game complete!');
    }
  }, [polledState.stacks, polledState.gameState, stopPolling, addLog]);

  // =============================================
  // RENDER
  // =============================================

  if (screen === 'lobby') {
    return (
      <>
        <NetworkBanner />
        <LobbyScreen
          joinedGameId={gameId}
          createdGameId={createdGameId}
          numPlayers={polledState.numPlayers}
          maxPlayers={polledState.maxPlayers}
          loading={lobbyLoading || actions.loading}
          loadingMessage={lobbyLoading ? lobbyStatus : actions.loadingMessage}
          error={lobbyError || actions.error}
          connectedAddress={!isLocal ? (controllerAddress ?? null) : undefined}
          onConnect={!isLocal ? handleConnect : undefined}
          onDisconnect={!isLocal ? handleDisconnect : undefined}
          devnetAlive={isLocal ? devnetAlive : undefined}
          artifactsReady={isLocal ? !!artifacts : undefined}
          onCreateRoom={handleCreateRoom}
          onJoinGame={handleJoinGame}
          onLeaveTable={handleLeaveTable}
        />
      </>
    );
  }

  if (screen === 'results') {
    return (
      <ResultsScreen
        playerNumber={playerCtx!.playerNumber}
        myPlayerIndex={playerCtx!.playerIndex}
        polledState={polledState}
        myHoleCards={myHoleCards}
        otherPlayersHoleCards={otherPlayersHoleCards}
        communityCards={communityCards}
        onPlayAgain={handlePlayAgain}
      />
    );
  }

  return (
    <>
      <NetworkBanner />
      <GameScreen
        myPlayerIndex={playerCtx!.playerIndex}
        polledState={polledState}
        myHoleCards={myHoleCards}
        otherPlayersHoleCards={otherPlayersHoleCards}
        communityCards={communityCards}
        currentAction={currentAction}
        logs={logs}
        loading={actions.loading}
        loadingMessage={actions.loadingMessage}
        error={actions.error}
        bigBlind={activeBigBlind}
        onFold={handleFold}
        onCheck={handleCheck}
        onCall={handleCall}
        onRaise={handleRaise}
      />
      {handResult && (
        <HandResultOverlay
          result={handResult}
          myPlayerIndex={playerCtx!.playerIndex}
          onDismiss={handleDismissHandResult}
        />
      )}
    </>
  );
}
