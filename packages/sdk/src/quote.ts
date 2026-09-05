/**
 * What a band costs, for the desk.
 *
 * A thin layer over `pricing.ts`: pick the calibrated table for a market and horizon, scale
 * sigma, and quote. The arithmetic lives in `pricing.ts` because that file is mirrored by the
 * contract; this one only decides which inputs to hand it.
 *
 * The engine this replaces was Monad-shaped — rounds indexed by 300ms blocks, tiers, a
 * stacking rule tied to block numbers. None of those concepts survive the move to a chain
 * where the constraint is how often the oracle publishes rather than how fast blocks close.
 */

import {
  BPS,
  PROB_ONE,
  bandLimits,
  payoutFor,
  quote as priceQuote,
  zForProb,
  type ProbTable,
} from "./pricing.ts";
import {
  MAX_MULTIPLIER_BPS,
  MIN_MULTIPLIER_BPS,
  type MarketDef,
} from "./markets.ts";

/** A calibrated table plus the sigma it was fitted with, for one market and horizon. */
export interface Calibration {
  marketKey: string;
  horizonKey: string;
  sigma1e4: bigint;
  table: ProbTable;
}

export type QuoteFailure =
  | { kind: "no-calibration"; detail: string }
  | { kind: "band-not-straddling"; detail: string }
  | { kind: "band-inverted"; detail: string }
  | { kind: "too-cheap"; detail: string }
  | { kind: "too-rich"; detail: string };

export interface QuoteOk {
  ok: true;
  multiplierBps: bigint;
  prob1e6: bigint;
  /** What a stake would pay if the band holds. */
  payout: bigint;
}

export interface QuoteErr {
  ok: false;
  error: QuoteFailure;
}

export type QuoteResult = QuoteOk | QuoteErr;

/**
 * Price a band.
 *
 * Every refusal is named rather than collapsed into a null. A desk that cannot say why it
 * will not quote is a desk nobody can debug, and the four reasons here need four different
 * responses from the caller: recalibrate, move the band, widen it, narrow it.
 */
export function quoteBand(
  calibrations: readonly Calibration[],
  market: MarketDef,
  horizonKey: string,
  spot: bigint,
  low: bigint,
  high: bigint,
  stake: bigint,
  houseEdgeBps: bigint,
): QuoteResult {
  const cal = calibrations.find(
    (c) => c.marketKey === market.key && c.horizonKey === horizonKey,
  );
  if (!cal) {
    return {
      ok: false,
      error: {
        kind: "no-calibration",
        detail: `${market.pair} has no fitted table for ${horizonKey}`,
      },
    };
  }

  if (low >= high) {
    return { ok: false, error: { kind: "band-inverted", detail: `${low} is not below ${high}` } };
  }
  if (low >= spot || high <= spot) {
    return {
      ok: false,
      error: {
        kind: "band-not-straddling",
        detail: "a band that does not contain the current price is a claim it already moved",
      },
    };
  }

  const q = priceQuote(cal.table, spot, low, high, cal.sigma1e4, houseEdgeBps);

  if (q.multiplierBps < MIN_MULTIPLIER_BPS) {
    return {
      ok: false,
      error: {
        kind: "too-cheap",
        detail: "band is so wide the fee eats the whole edge; narrow it",
      },
    };
  }
  if (q.multiplierBps > MAX_MULTIPLIER_BPS) {
    return {
      ok: false,
      error: {
        kind: "too-rich",
        detail: "band is so tight the model has lost its footing; widen it",
      },
    };
  }

  return {
    ok: true,
    multiplierBps: q.multiplierBps,
    prob1e6: q.prob1e6,
    payout: payoutFor(stake, q.multiplierBps),
  };
}

/**
 * The half-widths worth offering at a given spot, as basis points of it.
 *
 * Used by the console to bound the drag handles, so a trader cannot paint a band the desk
 * would only refuse. Returned in the same units the pricing library speaks, because
 * converting to prices here would round twice and put the boundary a unit inside the range
 * the desk actually accepts.
 */
export function sellableHalfWidths(
  calibrations: readonly Calibration[],
  market: MarketDef,
  horizonKey: string,
  spot: bigint,
  houseEdgeBps: bigint,
): { minHalfWidth1e4: bigint; maxHalfWidth1e4: bigint } | null {
  const cal = calibrations.find(
    (c) => c.marketKey === market.key && c.horizonKey === horizonKey,
  );
  if (!cal) return null;

  const limits = bandLimits(
    cal.table,
    spot,
    cal.sigma1e4,
    houseEdgeBps,
    MIN_MULTIPLIER_BPS,
    // The probability the tightest sellable band corresponds to.
    (PROB_ONE * (BPS - houseEdgeBps)) / MAX_MULTIPLIER_BPS,
  );
  return {
    minHalfWidth1e4: limits.minHalfWidth1e4,
    maxHalfWidth1e4: limits.maxHalfWidth1e4,
  };
}

export { zForProb };
