/**
 * What a band costs, for the desk.
 *
 * A thin layer over `pricing.ts`: pick the calibrated table for a market and round length,
 * and quote. The arithmetic lives in `pricing.ts` because that file is mirrored by the
 * contract; this one only decides which inputs to hand it, and names every refusal.
 *
 * The engine this replaces was Monad-shaped — rounds indexed by 300ms blocks, a stacking rule
 * tied to block numbers. None of those concepts survive the move to a chain where the
 * constraint is how often the oracle publishes rather than how fast blocks close.
 */

import { bandLimits, payoutFor, quote as priceQuote, zForProb } from "./pricing.ts";
import {
  MAX_MULTIPLIER_BPS,
  MIN_MULTIPLIER_BPS,
  type CalibratedRound,
  type MarketDef,
} from "./markets.ts";
import { HOUSE_EDGE_BPS } from "./generated/markets.ts";

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

/** The calibrated round a market runs at a tier, or nothing if it does not run one. */
export function roundOf(market: MarketDef, tier: number): CalibratedRound | undefined {
  return market.rounds[tier];
}

/**
 * Price a band.
 *
 * Every refusal is named rather than collapsed into a null. A desk that cannot say why it
 * will not quote is a desk nobody can debug, and these reasons need different responses from
 * the caller: recalibrate, move the band, widen it, narrow it.
 */
export function quoteBand(
  market: MarketDef,
  tier: number,
  spot: bigint,
  low: bigint,
  high: bigint,
  stake: bigint,
  houseEdgeBps: bigint = HOUSE_EDGE_BPS,
): QuoteResult {
  const round = roundOf(market, tier);
  if (!round) {
    return {
      ok: false,
      error: {
        kind: "no-calibration",
        detail: `${market.label} has no fitted table for tier ${tier}`,
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

  const q = priceQuote(round.probTable, spot, low, high, round.sigma1e4, houseEdgeBps);

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
 * The half-widths worth offering at a given spot, as a fraction of it times 1e8.
 *
 * Used by the console to bound the drag handles, so a trader cannot paint a band the desk
 * would only refuse. Returned in the units the pricing library speaks, because converting to
 * prices here would round twice and put the boundary a unit inside the range the desk
 * actually accepts.
 */
export function sellableHalfWidths(
  market: MarketDef,
  tier: number,
  spot: bigint,
  houseEdgeBps: bigint = HOUSE_EDGE_BPS,
): { minHalfWidth1e4: bigint; maxHalfWidth1e4: bigint } | null {
  const round = roundOf(market, tier);
  if (!round) return null;

  const limits = bandLimits(
    round.probTable,
    spot,
    round.sigma1e4,
    houseEdgeBps,
    MIN_MULTIPLIER_BPS,
    round.maxMultiplierBps < MAX_MULTIPLIER_BPS ? round.maxMultiplierBps : MAX_MULTIPLIER_BPS,
  );
  return {
    minHalfWidth1e4: limits.minHalfWidth1e4,
    maxHalfWidth1e4: limits.maxHalfWidth1e4,
  };
}

export { zForProb };
