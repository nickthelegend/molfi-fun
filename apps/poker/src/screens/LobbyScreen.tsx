import { useState } from 'react';
import { isLocal } from '../config';
import { useCartridgeUsernames } from '../hooks/useCartridgeUsernames';
import type { RoomConfig } from '../types';
import { Wordmark, ProtocolCredit } from '../components/Wordmark';

const STACK_PRESETS = [1000n, 5000n, 20000n] as const;
const PLAYER_OPTIONS = [2, 3, 4] as const;

function computeBlinds(stack: bigint): { small: bigint; big: bigint } {
  const big = stack / 100n;
  const small = big / 2n;
  return { small: small < 1n ? 1n : small, big: big < 2n ? 2n : big };
}

function formatStack(n: bigint) {
  if (n >= 1000n) return `${(Number(n) / 1000).toFixed(n % 1000n === 0n ? 0 : 1)}k`;
  return n.toString();
}

interface Props {
  joinedGameId: bigint | null;
  createdGameId: bigint | null;
  numPlayers: number;
  maxPlayers: number;
  loading: boolean;
  loadingMessage: string;
  error: string | null;
  connectedAddress?: string | null;
  onConnect?: () => void;
  onDisconnect?: () => void;
  devnetAlive?: boolean;
  artifactsReady?: boolean;
  onCreateRoom: (config: RoomConfig) => void;
  onJoinGame: (gameId: string) => void;
  onLeaveTable: () => void;
}

function SeatDots({ filled, total }: { filled: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`w-3.5 h-3.5 rounded-full border-2 transition-colors ${
            i < filled
              ? 'bg-emerald-400 border-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
              : 'border-white/20 bg-transparent'
          }`}
        />
      ))}
    </div>
  );
}

export function LobbyScreen({
  joinedGameId,
  createdGameId,
  numPlayers,
  maxPlayers,
  loading,
  loadingMessage,
  error,
  connectedAddress,
  onConnect,
  onDisconnect,
  devnetAlive,
  artifactsReady,
  onCreateRoom,
  onJoinGame,
  onLeaveTable,
}: Props) {
  const isConnected = isLocal ? true : !!connectedAddress;
  const hasJoined = joinedGameId !== null;

  const canAct = isConnected && !hasJoined && !loading &&
    (isLocal ? !!devnetAlive && !!artifactsReady : true);

  // Create Room state
  const [selectedPlayers, setSelectedPlayers] = useState<number>(2);
  const [selectedStackIdx, setSelectedStackIdx] = useState<number>(0);
  const [customStack, setCustomStack] = useState('');
  const [useCustomStack, setUseCustomStack] = useState(false);
  const [copied, setCopied] = useState(false);

  // Join Game state
  const [joinGameId, setJoinGameId] = useState('');

  const activeStack = useCustomStack
    ? (BigInt(customStack || '0'))
    : STACK_PRESETS[selectedStackIdx];
  const blinds = computeBlinds(activeStack);

  const handleCreate = () => {
    if (!canAct || activeStack < 10n) return;
    onCreateRoom({
      maxPlayers: selectedPlayers,
      smallBlind: blinds.small,
      bigBlind: blinds.big,
      initialStack: activeStack,
    });
  };

  const handleJoin = () => {
    if (!canAct || !/^\d+$/.test(joinGameId)) return;
    onJoinGame(joinGameId);
  };

  const handleCopyGameId = () => {
    if (createdGameId === null) return;
    navigator.clipboard.writeText(createdGameId.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Username lookup for connected address
  const addressList = connectedAddress ? [connectedAddress] : [];
  const usernameMap = useCartridgeUsernames(addressList);
  const myUsername = connectedAddress
    ? usernameMap.get(connectedAddress.toLowerCase()) ?? null
    : null;

  const displayName = myUsername ?? (connectedAddress ? connectedAddress.slice(0, 6) + '...' + connectedAddress.slice(-4) : null);

  return (
    <div className="h-screen flex overflow-hidden relative">
      {/* Video background */}
      <video
        className="absolute inset-0 w-full h-full object-cover"
        src="/assets/game-bg.mp4"
        autoPlay loop muted playsInline
      />
      <div className="absolute inset-0 bg-black/60" />

      {/* Main content */}
      <div className="relative z-10 flex-1 flex flex-col items-center overflow-y-auto">

        {/* Top bar */}
        <div className="w-full flex items-center justify-between px-8 py-5 flex-shrink-0">
          {/* Left: status indicators (local) */}
          <div className="flex items-center gap-4">
            {isLocal && (
              <>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${devnetAlive ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-red-500 animate-pulse'}`} />
                  <span className="text-[10px] text-white/35 uppercase tracking-wider">
                    Devnet {devnetAlive ? 'Online' : 'Offline'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${artifactsReady ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-yellow-500 animate-pulse'}`} />
                  <span className="text-[10px] text-white/35 uppercase tracking-wider">
                    Artifacts {artifactsReady ? 'Ready' : 'Loading...'}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Right: wallet */}
          <div>
            {!isLocal && connectedAddress ? (
              <div className="flex items-center gap-3 bg-black/50 border border-white/[0.08] rounded-full px-4 py-2">
                <img src="/profile-pics/1.png" alt="avatar" className="w-7 h-7 rounded-full object-cover ring-1 ring-white/20" />
                <span className="text-xs text-white/60 font-mono">{displayName}</span>
                <button
                  onClick={onDisconnect}
                  className="text-[10px] text-white/25 hover:text-white/50 uppercase tracking-wider transition-colors ml-1"
                >
                  Disconnect
                </button>
              </div>
            ) : !isLocal ? (
              <button
                onClick={onConnect}
                className="flex items-center gap-2 px-5 py-2.5 bg-cyan-600/20 border border-cyan-500/40 hover:border-cyan-400/70 hover:bg-cyan-600/30 rounded-full text-xs font-medium text-cyan-300 uppercase tracking-wider transition-all"
              >
                <img src="/Cartridge - Logomark - Black - Large.svg" alt="" style={{ filter: 'brightness(0) saturate(100%) invert(78%) sepia(60%) saturate(600%) hue-rotate(5deg) brightness(105%)' }} className="w-6 h-6" />
                Connect
              </button>
            ) : null}
          </div>
        </div>

        {/* Center content */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 pb-4 w-full max-w-5xl min-h-0">

          {/* The table's own mark. Drawn, not a raster, so it stays sharp at any size. */}
          <div className="-mt-6 mb-8">
            <Wordmark />
          </div>

          {/* Waiting state */}
          {hasJoined && (
            <div className="w-full max-w-lg bg-black/50 backdrop-blur-sm border border-white/[0.08] rounded-2xl p-8 flex flex-col items-center gap-5">
              <div className="flex items-center gap-3">
                <span className="w-5 h-5 rounded-full border-2 border-white/15 border-t-white/60 animate-spin inline-block" />
                <span className="text-white/70 text-base font-medium">
                  Waiting for players...
                </span>
              </div>

              {numPlayers > 0 && maxPlayers > 0 && (
                <div className="flex items-center gap-3">
                  <SeatDots filled={numPlayers} total={maxPlayers} />
                  <span className="text-sm text-white/40 tabular-nums font-mono">
                    {numPlayers}/{maxPlayers}
                  </span>
                </div>
              )}

              <div className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.08] rounded-xl px-5 py-3 w-full justify-center">
                <span className="text-[10px] text-white/30 uppercase tracking-wider">Table</span>
                <span className="text-lg text-white/80 font-mono font-bold">#{joinedGameId.toString()}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(joinedGameId.toString());
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="ml-2 px-3 py-1 border border-white/15 hover:border-white/30 rounded-lg text-[10px] text-white/50 hover:text-white/80 uppercase tracking-wider transition-all"
                >
                  {copied ? 'Copied!' : 'Copy ID'}
                </button>
              </div>

              <p className="text-[10px] text-white/20 uppercase tracking-wider">
                Share this ID with friends to join your table
              </p>

              {loadingMessage && (
                <p className="text-[10px] text-white/20 uppercase tracking-wider">{loadingMessage}</p>
              )}

              <button
                onClick={onLeaveTable}
                className="px-5 py-2 border border-red-700/30 hover:border-red-500/50 hover:bg-red-950/30 rounded-xl text-xs text-red-400/60 hover:text-red-400 uppercase tracking-wider transition-all"
              >
                Leave Table
              </button>
            </div>
          )}

          {/* Main lobby — not joined */}
          {!hasJoined && (
            <div className="w-full max-w-3xl grid grid-cols-2 gap-4">

              {/* Create Room — cyan accent */}
              <div className="bg-black/50 backdrop-blur-sm border border-cyan-500/15 rounded-2xl p-5 shadow-[0_0_30px_rgba(34,211,238,0.04)] flex flex-col">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-cyan-500/15 border border-cyan-500/20">
                    <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-cyan-400">Create Room</h2>
                    <p className="text-[11px] text-white/25">Host a private table</p>
                  </div>
                </div>

                <div className="flex flex-col gap-4 flex-1">
                  {/* Players */}
                  <div>
                    <span className="text-[10px] text-white/30 uppercase tracking-wider block mb-2">Players</span>
                    <div className="flex gap-2">
                      {PLAYER_OPTIONS.map(n => (
                        <button
                          key={n}
                          onClick={() => setSelectedPlayers(n)}
                          className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-all border ${
                            selectedPlayers === n
                              ? 'border-cyan-500/60 bg-cyan-900/30 text-cyan-400'
                              : 'border-white/10 text-white/40 hover:border-white/25 hover:text-white/60'
                          }`}
                        >
                          {n}P
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Stack */}
                  <div>
                    <span className="text-[10px] text-white/30 uppercase tracking-wider block mb-2">Buy-in</span>
                    <div className="flex gap-2">
                      {STACK_PRESETS.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => { setSelectedStackIdx(i); setUseCustomStack(false); }}
                          className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-all border ${
                            !useCustomStack && selectedStackIdx === i
                              ? 'border-cyan-500/60 bg-cyan-900/30 text-cyan-400'
                              : 'border-white/10 text-white/40 hover:border-white/25 hover:text-white/60'
                          }`}
                        >
                          {formatStack(s)}
                        </button>
                      ))}
                      <button
                        onClick={() => setUseCustomStack(true)}
                        className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-all border ${
                          useCustomStack
                            ? 'border-cyan-500/60 bg-cyan-900/30 text-cyan-400'
                            : 'border-white/10 text-white/40 hover:border-white/25 hover:text-white/60'
                        }`}
                      >
                        Custom
                      </button>
                    </div>
                  </div>

                  {/* Custom stack input */}
                  {useCustomStack && (
                    <input
                      type="number"
                      value={customStack}
                      onChange={e => setCustomStack(e.target.value)}
                      placeholder="Enter stack size"
                      className="w-full px-3 py-2.5 bg-black/40 border border-white/10 rounded-lg text-sm text-white/70 placeholder-white/20 focus:outline-none focus:border-cyan-500/40"
                    />
                  )}

                  {/* Blinds */}
                  <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.03] rounded-lg border border-white/[0.04]">
                    <span className="text-[10px] text-white/30 uppercase tracking-wider">Blinds</span>
                    <span className="text-sm text-white/50 tabular-nums font-mono">
                      {blinds.small.toString()} / {blinds.big.toString()}
                    </span>
                  </div>

                  {/* Spacer to push button to bottom */}
                  <div className="flex-1" />

                  {/* Create button */}
                  <button
                    onClick={handleCreate}
                    disabled={!canAct || activeStack < 10n || loading}
                    className="w-full py-3.5 rounded-xl text-sm font-bold uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed
                      bg-cyan-600/25 border border-cyan-500/50 text-cyan-400 hover:bg-cyan-600/35 hover:border-cyan-400/70 active:scale-[0.98]
                      shadow-[0_0_20px_rgba(34,211,238,0.1)]"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 rounded-full border-2 border-cyan-400/30 border-t-cyan-400 animate-spin inline-block" />
                        <span className="text-white/70">{loadingMessage || 'Creating table...'}</span>
                      </span>
                    ) : (
                      'Create Table'
                    )}
                  </button>

                  {/* Created game ID */}
                  {createdGameId !== null && !hasJoined && (
                    <div className="flex items-center gap-3 p-3 bg-cyan-950/30 border border-cyan-500/20 rounded-xl">
                      <span className="text-[10px] text-cyan-400/60 uppercase tracking-wider">ID:</span>
                      <span className="text-sm text-cyan-400 font-mono font-medium">#{createdGameId.toString()}</span>
                      <button
                        onClick={handleCopyGameId}
                        className="ml-auto px-3 py-1 border border-cyan-500/30 hover:border-cyan-400/60 rounded-lg text-[10px] text-cyan-400/70 hover:text-cyan-400 uppercase tracking-wider transition-all"
                      >
                        {copied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Join Game — purple accent */}
              <div className="bg-black/50 backdrop-blur-sm border border-purple-500/15 rounded-2xl p-5 shadow-[0_0_30px_rgba(168,85,247,0.04)] flex flex-col">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-purple-500/15 border border-purple-500/20">
                    <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 9l-6 6-6-6" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-purple-400">Join Game</h2>
                    <p className="text-[11px] text-white/25">Enter a table ID</p>
                  </div>
                </div>

                <div className="flex flex-col gap-5 flex-1">
                  <div>
                    <span className="text-[10px] text-white/30 uppercase tracking-wider block mb-2">Game ID</span>
                    <input
                      type="text"
                      value={joinGameId}
                      onChange={e => setJoinGameId(e.target.value.replace(/\D/g, ''))}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      onKeyDown={e => e.key === 'Enter' && handleJoin()}
                      placeholder="e.g. 42"
                      className="w-full px-4 py-3.5 bg-black/40 border border-white/10 rounded-xl text-lg text-white/70 placeholder-white/20 font-mono text-center focus:outline-none focus:border-purple-500/40 transition-colors"
                    />
                  </div>

                  <p className="text-[11px] text-white/20 text-center leading-relaxed">
                    Ask a friend for their table ID to join their game
                  </p>

                  {/* Spacer */}
                  <div className="flex-1" />

                  <button
                    onClick={handleJoin}
                    disabled={!canAct || !/^\d+$/.test(joinGameId)}
                    className="w-full py-3.5 rounded-xl text-sm font-bold uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed
                      bg-purple-600/25 border border-purple-500/50 text-purple-400 hover:bg-purple-600/35 hover:border-purple-400/70 active:scale-[0.98]
                      shadow-[0_0_20px_rgba(168,85,247,0.1)]"
                  >
                    Join Table
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="max-w-md w-full p-4 mt-6 bg-red-950/40 border border-red-700/30 rounded-xl text-xs text-red-400 text-center">
              {error}
            </div>
          )}

        </div>

        {/* Footer.

            The reference client shipped its own hackathon submission line here, naming its
            authors and the event it was entered in. Left in place it read as a claim that
            this table is that submission, which is false in both directions: wrong event,
            wrong authors. What is true is who wrote the protocol, and that is what stays. */}
        <div className="flex-shrink-0 pb-5">
          <div className="flex flex-col items-center gap-2">
            <p className="text-[11px] uppercase tracking-[0.3em] text-white/25">
              Starknet Sepolia · settled onchain
            </p>
            <ProtocolCredit />
          </div>
        </div>
      </div>
    </div>
  );
}
