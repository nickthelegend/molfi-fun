import {
  CALIBRATED_MARKETS,
  HOUSE_EDGE_BPS,
  ROUND_BLOCKS,
  ROUND_SECONDS,
  type CalibratedMarket,
  type CalibratedRound,
} from "./generated/markets.ts";

export { CALIBRATED_MARKETS, HOUSE_EDGE_BPS, ROUND_BLOCKS, ROUND_SECONDS };
export type { CalibratedMarket, CalibratedRound };

export const PRICE_DECIMALS = 8;
export const MIN_MULTIPLIER_BPS = 12_000n; // 1.20x floor: wider bands are not sellable
export const MAX_MULTIPLIER_BPS = 80_000n; // 8.00x hard ceiling, backstop only

/** ~300ms blocks on Monad mainnet. A 10-block round is about three seconds. */
export const BLOCK_MS = 300;

export interface MarketDef extends CalibratedMarket {
  symbol: string;
  /** display decimals for the price */
  dp: number;
  /** Where the desk's live mark comes from. Settlement is always the on-chain oracle. */
  markSource: "chainlink" | "pyth" | "kuru";
}

const DISPLAY: Record<string, Pick<MarketDef, "symbol" | "dp" | "markSource">> = {
  BTC: { symbol: "BTC", dp: 2, markSource: "chainlink" },
  ETH: { symbol: "ETH", dp: 2, markSource: "chainlink" },
  MON: { symbol: "MON", dp: 5, markSource: "kuru" },
};

export const MARKETS: MarketDef[] = CALIBRATED_MARKETS.map((m) => ({
  ...m,
  ...(DISPLAY[m.key] ?? { symbol: m.key, dp: 2, markSource: "chainlink" as const }),
}));

export const marketByKey = (k: string): MarketDef | undefined => MARKETS.find((m) => m.key === k);

/**
 * Human label for a round tier, e.g. "3s" or "15m".
 * Seconds up to two minutes, then whole minutes — a 100-second round reads as "100s",
 * not "1.6666666666666667m".
 */
export function roundLabel(tier: number): string {
  const s = ROUND_SECONDS[tier];
  if (s === undefined) return "?";
  if (s < 120) return `${s}s`;
  const m = s / 60;
  return Number.isInteger(m) ? `${m}m` : `${m.toFixed(1)}m`;
}

export const ROUND_LABELS = ROUND_BLOCKS.map((_, i) => roundLabel(i));
