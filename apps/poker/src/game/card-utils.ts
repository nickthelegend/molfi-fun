import { SUITS, RANKS, SUIT_SYMBOLS } from '../constants';

export interface CardInfo {
  suit: typeof SUITS[number];
  rank: typeof RANKS[number];
  symbol: string;
  color: 'red' | 'black';
  label: string; // e.g. "A\u2660"
}

/**
 * Convert a 0-based card value (0-51) to card info.
 *
 * Layout: rank is value % 13 counting from the two, suit is value / 13. So 0-12 is 2 through
 * ace of spades, then hearts, diamonds, clubs. This is the protocol's encoding, not a choice
 * made here, and it is checked against the SDK in tests/card-encoding.test.ts.
 */
export function cardFromValue(value: number): CardInfo {
  const suitIdx = Math.floor(value / 13);
  const rankIdx = value % 13;
  const suit = SUITS[suitIdx];
  const rank = RANKS[rankIdx];
  const symbol = SUIT_SYMBOLS[suit];
  const color = suit === 'hearts' || suit === 'diamonds' ? 'red' : 'black';
  return { suit, rank, symbol, color, label: `${rank}${symbol}` };
}
