/**
 * The markets molfi runs, keyed the way Starknet and Pragma key them.
 *
 * The ported version of this file was Monad-shaped: rounds counted in 300ms blocks, a MON
 * market, and a Kuru order book behind the price. None of that exists here. Rounds are
 * measured in seconds because Starknet's block time is neither fixed nor the constraint —
 * the constraint is how often Pragma publishes, and a round shorter than that cannot be
 * settled against a price that means anything.
 */

import { HORIZONS } from "./calibrate.ts";
import { pairId } from "./pragma.ts";

/** Below this a band is not worth selling; the fee eats the whole edge. */
export const MIN_MULTIPLIER_BPS = 10_500n;

/** Backstop only. A quote above this means the model has lost its footing, not found value. */
export const MAX_MULTIPLIER_BPS = 80_000n;

export interface Horizon {
  key: string;
  seconds: number;
  label: string;
}

export interface MarketDef {
  key: string;
  label: string;
  /** Pragma pair label, and the short string the oracle is keyed by. */
  pair: string;
  /** The same label as the felt the contract stores. */
  pairId: bigint;
  /** Binance symbol used to calibrate, and only to calibrate. */
  tape: string;
  horizons: readonly Horizon[];
}

/**
 * Three markets, chosen because Pragma actually aggregates them from enough publishers to
 * settle against. A pair with one publisher is a pair molfi will not list, however much
 * anyone would like to trade it.
 */
export const MARKETS: MarketDef[] = [
  { key: "btc", label: "Bitcoin", pair: "BTC/USD", pairId: pairId("BTC/USD"), tape: "BTCUSDT", horizons: HORIZONS },
  { key: "eth", label: "Ether", pair: "ETH/USD", pairId: pairId("ETH/USD"), tape: "ETHUSDT", horizons: HORIZONS },
  { key: "strk", label: "Starknet", pair: "STRK/USD", pairId: pairId("STRK/USD"), tape: "STRKUSDT", horizons: HORIZONS },
];

export const marketByKey = (key: string): MarketDef | undefined =>
  MARKETS.find((m) => m.key === key);

export const marketByPair = (pair: string): MarketDef | undefined =>
  MARKETS.find((m) => m.pair === pair);

/** The horizon labels, in the order the dial cycles them. */
export const HORIZON_LABELS = HORIZONS.map((h) => h.label);
