/**
 * End-to-end test for Texas Hold'em on the Mental Poker protocol (starknet-devnet).
 *
 * Runs a full 2-player hand:
 *   create_table → join → start → shuffle → start_hand →
 *   deal hole cards (reveal+unmask) →
 *   PreFlop betting (call, check) →
 *   advance_phase → Flop (reveal+unmask community) →
 *   Flop betting (check, check) →
 *   advance_phase → Turn → reveal+unmask →
 *   Turn betting (check, check) →
 *   advance_phase → River → reveal+unmask →
 *   River betting (check, check) →
 *   showdown → verify winner + pot distribution
 *
 * Prerequisites:
 *   1. starknet-devnet running on localhost:5050
 *   2. TexasHoldem deployed (./scripts/deploy-poker.sh)
 *   3. npm install in sdk/
 *
 * Usage:
 *   cd sdk && npx tsx ../scripts/e2e-poker.ts
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { RpcProvider, Account, Contract, Signer } from 'starknet';

import {
  privToPubKey,
  computeAggregateKey,
  encryptDeck,
  shuffleAndRemask,
  randomPermutation,
  computeRevealToken,
  decryptWithTokens,
  buildCardTable,
  lookupCard,
} from '@mental-poker/sdk';
import { MentalPokerProver } from '@mental-poker/sdk';
import { proofToCalldata } from '@mental-poker/sdk';
import { cardName } from '@mental-poker/sdk';

// ── Constants ──────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = '/Volumes/Extreme SSD/Projects/strk-20/_references/mental-poker';

const DECK_SIZE = 52;
const NUM_PLAYERS = 2;

// Deterministic secret keys for testing
const SK1 = 42n;
const SK2 = 77n;

// ── Helpers ────────────────────────────────────────────────

function log(phase: string, msg: string) {
  console.log(`[${phase}] ${msg}`);
}

function loadJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadBinary(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

function toFelt(n: bigint): string {
  return '0x' + n.toString(16);
}

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
}

async function waitTx(provider: RpcProvider, txHash: string, label: string) {
  log('TX', `Waiting for ${label}: ${txHash}`);
  const receipt = await provider.waitForTransaction(txHash);
  if (!receipt.isSuccess()) {
    throw new Error(`Transaction ${label} failed: ${JSON.stringify(receipt)}`);
  }
  log('TX', `${label} confirmed`);
  return receipt;
}

interface EncryptedCard {
  c1: { x: bigint; y: bigint };
  c2: { x: bigint; y: bigint };
}

async function readDeckFromContract(contract: Contract, gameId: bigint, deckSize: number): Promise<EncryptedCard[]> {
  const deck: EncryptedCard[] = [];
  for (let i = 0; i < deckSize; i++) {
    const result = await contract.call('get_deck_card', [gameId, i]);
    deck.push({
      c1: { x: BigInt(result[0]), y: BigInt(result[1]) },
      c2: { x: BigInt(result[2]), y: BigInt(result[3]) },
    });
  }
  return deck;
}

// ── Main ───────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  console.log('');
  console.log('============================================');
  console.log(' Texas Hold\'em E2E Test (2 players)');
  console.log('============================================');
  console.log('');

  // ── Phase 0: Setup ────────────────────────────────────

  log('SETUP', 'Loading deployment info...');
  const deployed = loadJson(resolve(__dirname, 'deployed-poker.json'));

  const provider = new RpcProvider({ nodeUrl: deployed.url });

  const account0 = new Account({
    provider,
    address: deployed.accounts.devnet0.address,
    signer: new Signer(deployed.accounts.devnet0.private_key),
  });
  const account1 = new Account({
    provider,
    address: deployed.accounts.devnet1.address,
    signer: new Signer(deployed.accounts.devnet1.private_key),
  });

  log('SETUP', `Player 0 (devnet0): ${account0.address}`);
  log('SETUP', `Player 1 (devnet1): ${account1.address}`);

  // Load contract ABI from compiled artifact
  const thArtifact = loadJson(
    resolve(ROOT, 'contracts/target/release/mental_poker_TexasHoldem.contract_class.json'),
  );

  const thAddr = deployed.contracts.texas_holdem;
  const contract0 = new Contract({ abi: thArtifact.abi, address: thAddr, providerOrAccount: account0 });
  const contract1 = new Contract({ abi: thArtifact.abi, address: thAddr, providerOrAccount: account1 });
  // Wrap invoke to pass tip: 0 (devnet has too few txs for tip estimation)
  for (const c of [contract0, contract1]) {
    const orig = c.invoke.bind(c);
    c.invoke = ((m: string, a?: any, o?: any) => orig(m, a, { tip: 0, ...o })) as any;
  }

  // Load circuit artifacts
  log('SETUP', 'Loading circuit artifacts...');
  const prover = new MentalPokerProver(1);

  const koArtifact = loadJson(resolve(__dirname, '..', 'public/artifacts/key_ownership.json'));
  const dcArtifact = loadJson(resolve(__dirname, '..', 'public/artifacts/decrypt_card.json'));
  const seArtifact = loadJson(resolve(__dirname, '..', 'public/artifacts/shuffle_encrypt.json'));

  prover.loadCircuit('key_ownership', koArtifact);
  prover.loadCircuit('decrypt_card', dcArtifact);
  prover.loadCircuit('shuffle_encrypt', seArtifact);

  const vkKo = loadBinary(resolve(__dirname, '..', 'public/artifacts/vk_key_ownership'));
  const vkDc = loadBinary(resolve(__dirname, '..', 'public/artifacts/vk_decrypt_card'));
  const vkSe = loadBinary(resolve(__dirname, '..', 'public/artifacts/vk_shuffle_encrypt'));

  log('SETUP', 'All artifacts loaded.');

  const pk1 = privToPubKey(SK1);
  const pk2 = privToPubKey(SK2);
  log('SETUP', `PK0: (${pk1.x}, ${pk1.y})`);
  log('SETUP', `PK1: (${pk2.x}, ${pk2.y})`);

  const sks = [SK1, SK2];
  const pks = [pk1, pk2];
  const contracts = [contract0, contract1];
  const accounts = [account0, account1];

  // ── Phase 1: Create table ───────────────────────────────

  const GAME_ID = BigInt(await contract0.call('get_next_game_id') as any);
  log('CREATE', `Next game_id will be: ${GAME_ID}`);

  log('CREATE', `Creating table (2 players, SB=${deployed.config.small_blind}, BB=${deployed.config.big_blind}, stack=${deployed.config.initial_stack})...`);
  const createResult = await contract0.invoke('create_table', [
    NUM_PLAYERS,
    DECK_SIZE,
    toFelt(BigInt(deployed.config.small_blind)),
    toFelt(BigInt(deployed.config.big_blind)),
    toFelt(BigInt(deployed.config.initial_stack)),
  ]);
  await waitTx(provider, createResult.transaction_hash, 'create_table');

  // ── Phase 2: Join game ──────────────────────────────────

  for (let p = 0; p < NUM_PLAYERS; p++) {
    log('JOIN', `Player ${p} generating key_ownership proof...`);
    let t = Date.now();
    const koProof = await prover.proveKeyOwnership(sks[p], pks[p]);
    log('JOIN', `  Proof generated in ${Date.now() - t}ms`);

    const koCalldata = await proofToCalldata(koProof, vkKo);

    log('JOIN', `Player ${p} joining game...`);
    const joinResult = await contracts[p].invoke('join_game', [
      GAME_ID,
      toFelt(pks[p].x),
      toFelt(pks[p].y),
      koCalldata,
    ]);
    await waitTx(provider, joinResult.transaction_hash, `join_game P${p}`);
  }

  const playerCount = await contract0.call('get_game_players', [GAME_ID]);
  log('JOIN', `Players joined: ${playerCount} (expected ${NUM_PLAYERS})`);

  // ── Phase 3: Start game ─────────────────────────────────

  log('START', 'Computing aggregate public key...');
  const apk = computeAggregateKey(pks);

  log('START', 'Encrypting initial deck (52 cards)...');
  const { deck: initialDeck, randomness: deckRandomness } = encryptDeck(DECK_SIZE, apk);

  log('START', 'Starting game (with deck verification)...');
  const startResult = await contract0.invoke('start_game', [
    GAME_ID,
    toFelt(apk.x),
    toFelt(apk.y),
    initialDeck.map((c) => toFelt(c.c1.x)),
    initialDeck.map((c) => toFelt(c.c1.y)),
    initialDeck.map((c) => toFelt(c.c2.x)),
    initialDeck.map((c) => toFelt(c.c2.y)),
    deckRandomness.map((r) => toFelt(r)),
  ]);
  await waitTx(provider, startResult.transaction_hash, 'start_game');

  // ── Phase 4: Shuffle (both players) ─────────────────────

  for (let p = 0; p < NUM_PLAYERS; p++) {
    log('SHUFFLE', `Player ${p} reading deck from contract...`);
    const currentDeck = await readDeckFromContract(contracts[p], GAME_ID, DECK_SIZE);

    log('SHUFFLE', `Player ${p} generating shuffle permutation + re-encryption...`);
    const perm = randomPermutation(DECK_SIZE);
    const { newDeck, randomness } = shuffleAndRemask(currentDeck, perm, apk);

    log('SHUFFLE', `Player ${p} generating shuffle proof (this may take a while)...`);
    const t = Date.now();
    const shuffleProof = await prover.proveShuffle(currentDeck, newDeck, apk, perm, randomness, DECK_SIZE);
    log('SHUFFLE', `  Proof generated in ${((Date.now() - t) / 1000).toFixed(1)}s`);

    const shuffleCalldata = await proofToCalldata(shuffleProof, vkSe);

    log('SHUFFLE', `Player ${p} submitting shuffle...`);
    const shuffleResult = await contracts[p].invoke('submit_shuffle', [
      GAME_ID,
      newDeck.map((c) => toFelt(c.c1.x)),
      newDeck.map((c) => toFelt(c.c1.y)),
      newDeck.map((c) => toFelt(c.c2.x)),
      newDeck.map((c) => toFelt(c.c2.y)),
      shuffleCalldata,
    ]);
    await waitTx(provider, shuffleResult.transaction_hash, `submit_shuffle P${p}`);
  }

  log('SHUFFLE', 'Both players shuffled. Game should be in Deal state.');

  // ── Phase 5: Start hand ─────────────────────────────────

  log('HAND', 'Starting hand (deals hole cards, posts blinds)...');
  const startHandResult = await contract0.invoke('start_hand', [GAME_ID]);
  await waitTx(provider, startHandResult.transaction_hash, 'start_hand');

  const pokerPhase = Number(await contract0.call('get_poker_phase', [GAME_ID]));
  log('HAND', `Poker phase: ${pokerPhase} (expected 1 = PreFlop)`);

  const pot = BigInt(await contract0.call('get_pot', [GAME_ID]) as any);
  const curBet = BigInt(await contract0.call('get_current_bet', [GAME_ID]) as any);
  log('HAND', `Pot: ${pot}, Current bet: ${curBet}`);

  // Card assignment: P0 gets [0,1], P1 gets [2,3], community starts at 4
  // For 2 players with dealer=0: SB=player1, BB=player0 (UTG=player1 in heads-up preflop)
  // Actually: dealer=0, sb=(0+1)%2=1, bb=(0+2)%2=0, utg=(0+3)%2=1
  // So in heads-up: dealer=P0, SB=P1, BB=P0, action on P1

  const actionPlayer = Number(await contract0.call('get_action_player', [GAME_ID]));
  log('HAND', `Action on player: ${actionPlayer}`);

  // ── Phase 6: Reveal tokens for hole cards ───────────────

  // C2 fix: ALL N players must reveal for every card (including the owner).
  // For private cards:
  //   P0's cards (0,1): BOTH P0 and P1 must reveal
  //   P1's cards (2,3): BOTH P0 and P1 must reveal

  const cardTable = buildCardTable(DECK_SIZE);
  const cardValues: number[] = []; // 1-indexed card values, ordered: [hole0_p0, hole1_p0, hole0_p1, hole1_p1, ...]

  for (let owner = 0; owner < NUM_PLAYERS; owner++) {
    for (let c = 0; c < 2; c++) {
      const cardIdx = owner * 2 + c;

      // ALL players reveal (including the card owner)
      for (let revealer = 0; revealer < NUM_PLAYERS; revealer++) {
        log('REVEAL', `Player ${revealer} revealing for card ${cardIdx} (owned by P${owner})...`);
        const cardResult = await contracts[revealer].call('get_deck_card', [GAME_ID, cardIdx]);
        const c1 = { x: BigInt(cardResult[0]), y: BigInt(cardResult[1]) };
        const token = computeRevealToken(sks[revealer], c1);

        const t = Date.now();
        const dcProof = await prover.proveDecrypt(sks[revealer], c1, token, pks[revealer]);
        log('REVEAL', `  Proof generated in ${Date.now() - t}ms`);

        const dcCalldata = await proofToCalldata(dcProof, vkDc);

        const revealResult = await contracts[revealer].invoke('submit_reveal_token', [
          GAME_ID, cardIdx, toFelt(token.x), toFelt(token.y), dcCalldata,
        ]);
        await waitTx(provider, revealResult.transaction_hash, `reveal card ${cardIdx} by P${revealer}`);
      }

      // Owner decrypts locally (collect all tokens from contract)
      log('UNMASK', `Player ${owner} decrypting card ${cardIdx}...`);
      const cardResult = await contracts[owner].call('get_deck_card', [GAME_ID, cardIdx]);
      const c2 = { x: BigInt(cardResult[2]), y: BigInt(cardResult[3]) };

      // Collect ALL players' tokens from contract (all stored on-chain now)
      const tokens: { x: bigint; y: bigint }[] = [];
      for (let r = 0; r < NUM_PLAYERS; r++) {
        const tok = await contracts[owner].call('get_reveal_token', [GAME_ID, cardIdx, r]);
        tokens.push({ x: BigInt(tok[0]), y: BigInt(tok[1]) });
      }

      const decryptedPoint = decryptWithTokens(c2, tokens);
      const cardIndex0Based = lookupCard(decryptedPoint, cardTable);
      assert(cardIndex0Based >= 0, `Card ${cardIdx} lookup failed!`);

      const cardValue = cardIndex0Based + 1; // 1-indexed for contract
      cardValues.push(cardValue);
      log('UNMASK', `  Card ${cardIdx} = ${cardName(cardIndex0Based)} (value ${cardValue})`);

      // Submit unmask on-chain
      const unmaskResult = await contracts[owner].invoke('unmask_card', [GAME_ID, cardIdx, cardValue]);
      await waitTx(provider, unmaskResult.transaction_hash, `unmask card ${cardIdx}`);
    }
  }

  log('HAND', `P0 hole cards: ${cardName(cardValues[0] - 1)} ${cardName(cardValues[1] - 1)}`);
  log('HAND', `P1 hole cards: ${cardName(cardValues[2] - 1)} ${cardName(cardValues[3] - 1)}`);

  // ── Phase 7: PreFlop betting ────────────────────────────
  //   In heads-up: dealer=P0, SB=P1, BB=P0. Action starts on P1 (UTG).
  //   P1 calls (matches BB), then P0 checks.

  log('BET', '--- PreFlop Betting ---');
  let curActionPlayer = Number(await contract0.call('get_action_player', [GAME_ID]));
  log('BET', `Action on P${curActionPlayer}`);

  // P1 (action player) calls the big blind
  log('BET', `P${curActionPlayer} calls...`);
  const callResult = await contracts[curActionPlayer].invoke('bet_call', [GAME_ID]);
  await waitTx(provider, callResult.transaction_hash, `P${curActionPlayer} call`);

  // P0 checks (BB can check after call)
  curActionPlayer = Number(await contract0.call('get_action_player', [GAME_ID]));
  log('BET', `Action on P${curActionPlayer}`);
  log('BET', `P${curActionPlayer} checks...`);
  const checkResult1 = await contracts[curActionPlayer].invoke('bet_check', [GAME_ID]);
  await waitTx(provider, checkResult1.transaction_hash, `P${curActionPlayer} check`);

  // ── Phase 8: Advance to Flop ────────────────────────────

  log('PHASE', 'Advancing to Flop...');
  const advFlopResult = await contract0.invoke('advance_phase', [GAME_ID]);
  await waitTx(provider, advFlopResult.transaction_hash, 'advance_phase → Flop');

  const phaseAfterFlop = Number(await contract0.call('get_poker_phase', [GAME_ID]));
  log('PHASE', `Poker phase: ${phaseAfterFlop} (expected 2 = Flop)`);

  // Reveal + unmask community cards for flop: cards 4, 5, 6
  const communityCardValues: number[] = [];
  const communityStart = NUM_PLAYERS * 2; // = 4
  const flopCards = [communityStart, communityStart + 1, communityStart + 2];

  for (const cardIdx of flopCards) {
    // ALL players reveal for community cards
    for (let revealer = 0; revealer < NUM_PLAYERS; revealer++) {
      log('REVEAL', `Player ${revealer} revealing community card ${cardIdx}...`);
      const cardResult = await contracts[revealer].call('get_deck_card', [GAME_ID, cardIdx]);
      const c1 = { x: BigInt(cardResult[0]), y: BigInt(cardResult[1]) };
      const token = computeRevealToken(sks[revealer], c1);

      const t = Date.now();
      const dcProof = await prover.proveDecrypt(sks[revealer], c1, token, pks[revealer]);
      log('REVEAL', `  Proof in ${Date.now() - t}ms`);

      const dcCalldata = await proofToCalldata(dcProof, vkDc);
      const revResult = await contracts[revealer].invoke('submit_reveal_token', [
        GAME_ID, cardIdx, toFelt(token.x), toFelt(token.y), dcCalldata,
      ]);
      await waitTx(provider, revResult.transaction_hash, `reveal community ${cardIdx} by P${revealer}`);
    }

    // Any player can unmask community cards
    const cardResult = await contract0.call('get_deck_card', [GAME_ID, cardIdx]);
    const c1 = { x: BigInt(cardResult[0]), y: BigInt(cardResult[1]) };
    const c2 = { x: BigInt(cardResult[2]), y: BigInt(cardResult[3]) };

    const tokens: { x: bigint; y: bigint }[] = [];
    for (let r = 0; r < NUM_PLAYERS; r++) {
      const tok = await contract0.call('get_reveal_token', [GAME_ID, cardIdx, r]);
      tokens.push({ x: BigInt(tok[0]), y: BigInt(tok[1]) });
    }

    const decryptedPoint = decryptWithTokens(c2, tokens);
    const cardIndex0Based = lookupCard(decryptedPoint, cardTable);
    assert(cardIndex0Based >= 0, `Community card ${cardIdx} lookup failed!`);

    const cardValue = cardIndex0Based + 1;
    communityCardValues.push(cardValue);
    log('UNMASK', `  Community card ${cardIdx} = ${cardName(cardIndex0Based)} (value ${cardValue})`);

    const unmaskResult = await contract0.invoke('unmask_card', [GAME_ID, cardIdx, cardValue]);
    await waitTx(provider, unmaskResult.transaction_hash, `unmask community ${cardIdx}`);
  }

  // Flop betting: both check
  log('BET', '--- Flop Betting ---');
  for (let i = 0; i < NUM_PLAYERS; i++) {
    curActionPlayer = Number(await contract0.call('get_action_player', [GAME_ID]));
    log('BET', `P${curActionPlayer} checks...`);
    const chk = await contracts[curActionPlayer].invoke('bet_check', [GAME_ID]);
    await waitTx(provider, chk.transaction_hash, `P${curActionPlayer} check (flop)`);
  }

  // ── Phase 9: Advance to Turn ────────────────────────────

  log('PHASE', 'Advancing to Turn...');
  const advTurnResult = await contract0.invoke('advance_phase', [GAME_ID]);
  await waitTx(provider, advTurnResult.transaction_hash, 'advance_phase → Turn');

  // Reveal + unmask turn card (card 7)
  const turnCardIdx = communityStart + 3;
  for (let revealer = 0; revealer < NUM_PLAYERS; revealer++) {
    log('REVEAL', `Player ${revealer} revealing turn card ${turnCardIdx}...`);
    const cardResult = await contracts[revealer].call('get_deck_card', [GAME_ID, turnCardIdx]);
    const c1 = { x: BigInt(cardResult[0]), y: BigInt(cardResult[1]) };
    const token = computeRevealToken(sks[revealer], c1);
    const t = Date.now();
    const dcProof = await prover.proveDecrypt(sks[revealer], c1, token, pks[revealer]);
    log('REVEAL', `  Proof in ${Date.now() - t}ms`);
    const dcCalldata = await proofToCalldata(dcProof, vkDc);
    const revResult = await contracts[revealer].invoke('submit_reveal_token', [
      GAME_ID, turnCardIdx, toFelt(token.x), toFelt(token.y), dcCalldata,
    ]);
    await waitTx(provider, revResult.transaction_hash, `reveal turn ${turnCardIdx} by P${revealer}`);
  }

  {
    const cardResult = await contract0.call('get_deck_card', [GAME_ID, turnCardIdx]);
    const c1 = { x: BigInt(cardResult[0]), y: BigInt(cardResult[1]) };
    const c2 = { x: BigInt(cardResult[2]), y: BigInt(cardResult[3]) };
    const tokens: { x: bigint; y: bigint }[] = [];
    for (let r = 0; r < NUM_PLAYERS; r++) {
      const tok = await contract0.call('get_reveal_token', [GAME_ID, turnCardIdx, r]);
      tokens.push({ x: BigInt(tok[0]), y: BigInt(tok[1]) });
    }
    const decryptedPoint = decryptWithTokens(c2, tokens);
    const cardIndex0Based = lookupCard(decryptedPoint, cardTable);
    assert(cardIndex0Based >= 0, `Turn card lookup failed!`);
    const cardValue = cardIndex0Based + 1;
    communityCardValues.push(cardValue);
    log('UNMASK', `  Turn card ${turnCardIdx} = ${cardName(cardIndex0Based)} (value ${cardValue})`);
    const unmaskResult = await contract0.invoke('unmask_card', [GAME_ID, turnCardIdx, cardValue]);
    await waitTx(provider, unmaskResult.transaction_hash, `unmask turn ${turnCardIdx}`);
  }

  // Turn betting: both check
  log('BET', '--- Turn Betting ---');
  for (let i = 0; i < NUM_PLAYERS; i++) {
    curActionPlayer = Number(await contract0.call('get_action_player', [GAME_ID]));
    log('BET', `P${curActionPlayer} checks...`);
    const chk = await contracts[curActionPlayer].invoke('bet_check', [GAME_ID]);
    await waitTx(provider, chk.transaction_hash, `P${curActionPlayer} check (turn)`);
  }

  // ── Phase 10: Advance to River ──────────────────────────

  log('PHASE', 'Advancing to River...');
  const advRiverResult = await contract0.invoke('advance_phase', [GAME_ID]);
  await waitTx(provider, advRiverResult.transaction_hash, 'advance_phase → River');

  // Reveal + unmask river card (card 8)
  const riverCardIdx = communityStart + 4;
  for (let revealer = 0; revealer < NUM_PLAYERS; revealer++) {
    log('REVEAL', `Player ${revealer} revealing river card ${riverCardIdx}...`);
    const cardResult = await contracts[revealer].call('get_deck_card', [GAME_ID, riverCardIdx]);
    const c1 = { x: BigInt(cardResult[0]), y: BigInt(cardResult[1]) };
    const token = computeRevealToken(sks[revealer], c1);
    const t = Date.now();
    const dcProof = await prover.proveDecrypt(sks[revealer], c1, token, pks[revealer]);
    log('REVEAL', `  Proof in ${Date.now() - t}ms`);
    const dcCalldata = await proofToCalldata(dcProof, vkDc);
    const revResult = await contracts[revealer].invoke('submit_reveal_token', [
      GAME_ID, riverCardIdx, toFelt(token.x), toFelt(token.y), dcCalldata,
    ]);
    await waitTx(provider, revResult.transaction_hash, `reveal river ${riverCardIdx} by P${revealer}`);
  }

  {
    const cardResult = await contract0.call('get_deck_card', [GAME_ID, riverCardIdx]);
    const c1 = { x: BigInt(cardResult[0]), y: BigInt(cardResult[1]) };
    const c2 = { x: BigInt(cardResult[2]), y: BigInt(cardResult[3]) };
    const tokens: { x: bigint; y: bigint }[] = [];
    for (let r = 0; r < NUM_PLAYERS; r++) {
      const tok = await contract0.call('get_reveal_token', [GAME_ID, riverCardIdx, r]);
      tokens.push({ x: BigInt(tok[0]), y: BigInt(tok[1]) });
    }
    const decryptedPoint = decryptWithTokens(c2, tokens);
    const cardIndex0Based = lookupCard(decryptedPoint, cardTable);
    assert(cardIndex0Based >= 0, `River card lookup failed!`);
    const cardValue = cardIndex0Based + 1;
    communityCardValues.push(cardValue);
    log('UNMASK', `  River card ${riverCardIdx} = ${cardName(cardIndex0Based)} (value ${cardValue})`);
    const unmaskResult = await contract0.invoke('unmask_card', [GAME_ID, riverCardIdx, cardValue]);
    await waitTx(provider, unmaskResult.transaction_hash, `unmask river ${riverCardIdx}`);
  }

  // River betting: both check
  log('BET', '--- River Betting ---');
  for (let i = 0; i < NUM_PLAYERS; i++) {
    curActionPlayer = Number(await contract0.call('get_action_player', [GAME_ID]));
    log('BET', `P${curActionPlayer} checks...`);
    const chk = await contracts[curActionPlayer].invoke('bet_check', [GAME_ID]);
    await waitTx(provider, chk.transaction_hash, `P${curActionPlayer} check (river)`);
  }

  // ── Phase 11: Showdown ──────────────────────────────────

  log('SHOWDOWN', '--- Showdown ---');
  log('SHOWDOWN', `P0 hole: ${cardName(cardValues[0] - 1)} ${cardName(cardValues[1] - 1)}`);
  log('SHOWDOWN', `P1 hole: ${cardName(cardValues[2] - 1)} ${cardName(cardValues[3] - 1)}`);
  log('SHOWDOWN', `Community: ${communityCardValues.map(v => cardName(v - 1)).join(' ')}`);

  // C2 fix: All reveal tokens (including owner's) were already submitted during
  // the hole card reveal phase above, so no additional reveals are needed here.
  // Card values are now fully verified on-chain (tamper-proof)
  log('SHOWDOWN', 'Submitting showdown (all card values cryptographically verified)...');

  const showdownResult = await contract0.invoke('showdown', [GAME_ID]);
  await waitTx(provider, showdownResult.transaction_hash, 'showdown');

  // ── Phase 12: Verify results ────────────────────────────

  const finalPhase = Number(await contract0.call('get_poker_phase', [GAME_ID]));
  log('VERIFY', `Final poker phase: ${finalPhase} (expected 5 = Showdown)`);

  const finalPot = BigInt(await contract0.call('get_pot', [GAME_ID]) as any);
  log('VERIFY', `Final pot: ${finalPot} (expected 0 — distributed to winner)`);

  const stack0 = BigInt(await contract0.call('get_player_stack', [GAME_ID, 0]) as any);
  const stack1 = BigInt(await contract0.call('get_player_stack', [GAME_ID, 1]) as any);
  log('VERIFY', `P0 stack: ${stack0}`);
  log('VERIFY', `P1 stack: ${stack1}`);

  const initialStack = BigInt(deployed.config.initial_stack);
  assert(stack0 + stack1 === initialStack * 2n, `Total chips mismatch: ${stack0} + ${stack1} != ${initialStack * 2n}`);
  assert(finalPot === 0n, `Pot should be 0 after showdown, got ${finalPot}`);

  // One player should have won the pot
  const bigBlind = BigInt(deployed.config.big_blind);
  const winnerStack = initialStack + bigBlind; // winner gets the pot (2 * BB for check-down)
  const loserStack = initialStack - bigBlind;
  assert(
    (stack0 === winnerStack && stack1 === loserStack) ||
    (stack1 === winnerStack && stack0 === loserStack) ||
    (stack0 === initialStack && stack1 === initialStack), // tie
    `Unexpected stacks: P0=${stack0}, P1=${stack1}`,
  );

  if (stack0 > stack1) {
    log('VERIFY', 'Player 0 wins!');
  } else if (stack1 > stack0) {
    log('VERIFY', 'Player 1 wins!');
  } else {
    log('VERIFY', 'It\'s a tie!');
  }

  // ── Done ──────────────────────────────────────────────

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('');
  console.log('============================================');
  console.log(' TEXAS HOLD\'EM E2E TEST PASSED!');
  console.log(`  Total time: ${elapsed}s`);
  console.log(`  P0: ${cardName(cardValues[0] - 1)} ${cardName(cardValues[1] - 1)} | P1: ${cardName(cardValues[2] - 1)} ${cardName(cardValues[3] - 1)}`);
  console.log(`  Board: ${communityCardValues.map(v => cardName(v - 1)).join(' ')}`);
  console.log(`  P0 stack: ${stack0} | P1 stack: ${stack1}`);
  console.log('============================================');
  console.log('');

  await prover.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error('E2E POKER TEST FAILED:', err);
  process.exit(1);
});
