/**
 * The markets molfi runs, keyed the way Starknet and Pragma key them.
 *
 * The ported version of this file was Monad-shaped: rounds counted in 300ms blocks, a MON
 * market, and a Kuru order book behind the price. None of that exists here.
 *
 * ## Why the rounds got longer
 *
 * XORR's thesis was three-second rounds on a 300ms chain. That works when the mark and the
 * settlement price come from a book that updates continuously. molfi settles against
 * **Pragma's median, which republishes every few minutes**, so a round shorter than the
 * publish interval settles against a price that was already public when the round opened.
 * The shortest honest round here is therefore longer than one publish cycle, not shorter
 * than one block. This is not a preference; it is the only thing the data source supports,
 * and building the three-second UI anyway would be a demo that cannot settle.
 */

import {
  CALIBRATED_MARKETS,
  GENERATED_AT,
  HOUSE_EDGE_BPS,
  ROUND_KEYS,
  ROUND_SECONDS,
  type CalibratedMarket,
  type CalibratedRound,
} from "./generated/markets.ts";
import { pairId } from "./pragma.ts";

export { CALIBRATED_MARKETS, GENERATED_AT, HOUSE_EDGE_BPS, ROUND_KEYS, ROUND_SECONDS };
export type { CalibratedMarket, CalibratedRound };

/** Below this a band is not worth selling; the fee eats the whole edge. */
export const MIN_MULTIPLIER_BPS = 10_500n;

/** Backstop only. A quote above this means the model has lost its footing, not found value. */
export const MAX_MULTIPLIER_BPS = 80_000n;

export interface MarketDef extends CalibratedMarket {
  symbol: string;
  /** Display decimals for the price. */
  dp: number;
  /** The Pragma pair label as the felt the contract stores. */
  pairId: bigint;
  /**
   * Where the desk's live mark comes from. Settlement is always the same on-chain median,
   * so this is only ever about what the screen shows between publishes.
   */
  markSource: "pragma";
}

const DISPLAY: Record<string, Pick<MarketDef, "symbol" | "dp">> = {
  BTC: { symbol: "BTC", dp: 2 },
  ETH: { symbol: "ETH", dp: 2 },
  STRK: { symbol: "STRK", dp: 5 },
  WBTC: { symbol: "WBTC", dp: 2 },
  // Decimals follow the price, not a house style: a market quoted to two places when it
  // trades at nine cents shows every move as zero.
  SOL: { symbol: "SOL", dp: 2 },
  XRP: { symbol: "XRP", dp: 4 },
  DOGE: { symbol: "DOGE", dp: 5 },
  LINK: { symbol: "LINK", dp: 3 },
  AVAX: { symbol: "AVAX", dp: 3 },
};

/**
 * The markets, and the two different reasons a pair is on this list.
 *
 * Four settle against **Pragma mainnet's own median**, read straight off their aggregator.
 * Five settle against **molfi's median across five independent exchanges**, relayed on chain
 * with the count that actually answered. Pragma does not carry those five at all — the pair
 * id errors — so the choice was four markets or building the oracle, and `settle` on each
 * market says which one it got.
 *
 * Both clear the contract's three-publisher floor, and the floor is checked against a real
 * count either way. They are not the same trust assumption, and the desk says so rather than
 * flattening nine markets into one undifferentiated list.
 */
export const MARKETS: MarketDef[] = CALIBRATED_MARKETS.map((m) => ({
  ...m,
  ...(DISPLAY[m.key] ?? { symbol: m.key, dp: 2 }),
  pairId: pairId(m.label),
  markSource: "pragma" as const,
}));

export const marketByKey = (k: string): MarketDef | undefined =>
  MARKETS.find((m) => m.key === k);

export const marketByPair = (pair: string): MarketDef | undefined =>
  MARKETS.find((m) => m.label === pair);

/**
 * Human label for a round tier, e.g. "15m" or "4h".
 *
 * Whole units only where they are whole — a 90-minute round reads as "90m", not
 * "1.5000000000000002h", and an hour reads as "1h" rather than "60m".
 */
export function roundLabel(tier: number): string {
  return secondsLabel(ROUND_SECONDS[tier]);
}

export function secondsLabel(s: number | undefined): string {
  if (s === undefined) return "?";
  if (s < 120) return `${s}s`;
  if (s < 3_600) return `${s / 60}m`;
  const h = s / 3_600;
  return Number.isInteger(h) ? `${h}h` : `${(s / 60).toFixed(0)}m`;
}

export const ROUND_LABELS = ROUND_SECONDS.map((_, i) => roundLabel(i));

/** The tier whose length is closest to a number of seconds. */
export function tierForSeconds(seconds: number): number {
  let best = 0;
  for (let i = 1; i < ROUND_SECONDS.length; i += 1) {
    if (Math.abs(ROUND_SECONDS[i] - seconds) < Math.abs(ROUND_SECONDS[best] - seconds)) best = i;
  }
  return best;
}
