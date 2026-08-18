export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
/**
 * Rank order, and it has to be this one.
 *
 * A card value is 0-51, rank is value % 13, and the protocol counts from the two: 0 is a two
 * and 12 is an ace. This table used to start at the ace, which shifted every rank by one and
 * put the ace at the bottom where the two belongs. The table showed you A-spades while the
 * evaluator, which reads the same value correctly, scored it as a two - so the winner
 * announced at showdown disagreed with the cards on screen. Not one of the thirteen ranks
 * matched.
 *
 * Pinned against the SDK's own mapping by tests/card-encoding.test.ts, which is what makes
 * this comment enforceable rather than a warning nobody reads.
 */
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

export const SUIT_SYMBOLS: Record<string, string> = {
  spades: '\u2660',
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
};

export const SUIT_COLORS: Record<string, string> = {
  spades: 'text-gray-900',
  hearts: 'text-red-600',
  diamonds: 'text-red-600',
  clubs: 'text-gray-900',
};

export const PLAYER_COLORS = [
  'border-blue-400',
  'border-amber-400',
  'border-emerald-400',
  'border-purple-400',
];

export const PLAYER_BG_COLORS = [
  'bg-blue-400/10',
  'bg-amber-400/10',
  'bg-emerald-400/10',
  'bg-purple-400/10',
];

export const PLAYER_TEXT_COLORS = [
  'text-blue-400',
  'text-amber-400',
  'text-emerald-400',
  'text-purple-400',
];

export const DECK_SIZE = 52;

export const TABLE_PRESETS = [
  { id: 'low',  label: 'Low Stakes',  smallBlind: 5n,   bigBlind: 10n,  initialStack: 1000n,  maxPlayers: 2 },
  { id: 'mid',  label: 'Mid Stakes',  smallBlind: 25n,  bigBlind: 50n,  initialStack: 5000n,  maxPlayers: 4 },
  { id: 'high', label: 'High Stakes', smallBlind: 100n, bigBlind: 200n, initialStack: 20000n, maxPlayers: 4 },
] as const;

// Deterministic secret keys for testing (same as e2e)
export const SECRET_KEYS: bigint[] = [42n, 77n, 99n, 55n];

// Polling interval in ms
export const POLL_INTERVAL = 3000;

// Max supported players in the frontend
export const MAX_PLAYERS = 4;

/**
 * Get hole card deck indices for a given player.
 * Each player gets 2 consecutive cards: player 0 → [0,1], player 1 → [2,3], etc.
 */
export function getHoleCardIndices(playerIdx: number): number[] {
  return [playerIdx * 2, playerIdx * 2 + 1];
}

/**
 * Get all hole card indices for all players.
 */
export function getAllHoleCardIndices(numPlayers: number): number[] {
  const indices: number[] = [];
  for (let i = 0; i < numPlayers; i++) {
    indices.push(i * 2, i * 2 + 1);
  }
  return indices;
}

/**
 * Get community card indices based on number of active players in the hand.
 * Community cards start after all hole cards: numActive * 2.
 * @param numActive Number of active players in this hand (use numPlayers for first hand)
 */
export function getCommunityCardIndices(numActive: number) {
  const start = numActive * 2;
  return {
    flop: [start, start + 1, start + 2],
    turn: [start + 3],
    river: [start + 4],
  };
}

/**
 * Get hole card indices for a player using compact active index.
 * In multi-hand mode, active players get consecutive indices.
 */
export function getActiveHoleCardIndices(activeIdx: number): number[] {
  return [activeIdx * 2, activeIdx * 2 + 1];
}
