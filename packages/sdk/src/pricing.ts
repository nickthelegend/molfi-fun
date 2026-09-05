/**
 * Exact TypeScript mirror of packages/contracts/src/lib/Pricing.sol.
 *
 * Every operation is BigInt so the truncating integer division matches Solidity step
 * for step. The desk quotes from this file; the chain quotes from the Solidity one;
 * test/parity.ts diffs the two over thousands of inputs so the number a player sees
 * before firing is provably the number they get charged.
 */

export const BPS = 10_000n;
export const PROB_ONE = 1_000_000n; // probabilities are 1e6 fixed point
export const Z_STEP = 2_500n; // 0.25 sigma, 1e4 fixed point
export const Z_MAX = 40_000n; // 4.00 sigma
export const TABLE_LEN = 17;

/** T(z) = P(|move| <= z*sigma) on z = 0, 0.25 .. 4.00, in 1e6 fixed point. */
export type ProbTable = readonly bigint[];

/**
 * T(z) = 2*Phi(z) - 1 for the standard normal.
 *
 * The fallback for a market with no measured tape. Real markets ship their own table:
 * over a three-second round BTC closes exactly where it opened about a third of the
 * time, and a normal puts zero probability on that.
 */
export const NORMAL_TABLE: ProbTable = [
  0n, 197_413n, 382_925n, 546_746n, 682_689n, 788_700n, 866_386n, 919_882n,
  954_500n, 975_551n, 987_581n, 994_040n, 997_300n, 998_845n, 999_535n,
  999_823n, 999_937n,
];

/** A table is usable only if it is a real CDF: non-decreasing and bounded by one. */
export function validateTable(t: ProbTable): void {
  if (t.length !== TABLE_LEN) throw new Error(`table must have ${TABLE_LEN} points`);
  let prev = 0n;
  for (const v of t) {
    if (v < prev || v > PROB_ONE) throw new Error("TableNotMonotonic");
    prev = v;
  }
}

/** T(z) interpolated from the supplied table. z is 1e4 fp, result is 1e6 fp. */
export function halfProb(t: ProbTable, z1e4: bigint): bigint {
  if (z1e4 >= Z_MAX) return t[TABLE_LEN - 1];
  const i = z1e4 / Z_STEP;
  const rem = z1e4 - i * Z_STEP;
  const lo = t[Number(i)];
  const hi = t[Number(i) + 1];
  return lo + ((hi - lo) * rem) / Z_STEP;
}

/** Babylonian integer square root, matching the Solidity implementation exactly. */
export function sqrt(x: bigint): bigint {
  if (x === 0n) return 0n;
  let z = x;
  let y = (x >> 1n) + 1n;
  while (y < z) {
    z = y;
    y = (x / y + y) >> 1n;
  }
  return z;
}

/**
 * Scale a reference-horizon sigma by sqrt(time), at 1e4 precision.
 *
 * Only used to interpolate between calibrated round tiers and by the calibration
 * tooling. Each sellable round carries its own measured sigma, because measured on
 * real tape sqrt-scaling does not hold at these horizons.
 */
export function sigmaBps1e4(volBps: bigint, blocks: bigint, refBlocks: bigint): bigint {
  return volBps * sqrt((blocks * 100_000_000n) / refBlocks);
}

/**
 * Probability the cutoff print lands inside [low, high], 1e6 fp.
 *
 * For ANY symmetric distribution with CDF F, writing T(z) = P(|move| <= z*sigma):
 *
 *   P(inside) = F(zHigh) - F(-zLow) = ( T(zLow) + T(zHigh) ) / 2
 *
 * Exact, not an approximation. It is what stops a band pinned at spot on one side
 * from being mistaken for a tight band and paid out at the cap.
 */
export function probInside(
  t: ProbTable,
  spot: bigint,
  low: bigint,
  high: bigint,
  sig1e4: bigint,
): bigint {
  if (sig1e4 === 0n) throw new Error("ZeroSigma");
  if (low >= spot || high <= spot) throw new Error("SpotOutsideBand");
  const zLow = (((spot - low) * 100_000_000n) / spot) * BPS / sig1e4;
  const zHigh = (((high - spot) * 100_000_000n) / spot) * BPS / sig1e4;
  return (halfProb(t, zLow) + halfProb(t, zHigh)) / 2n;
}

export interface Quote {
  /** Offered multiplier in bps. 10_000 = 1.00x */
  multiplierBps: bigint;
  /** Win probability, 1e6 fp */
  prob1e6: bigint;
}

/** The multiplier XORR offers: 1/p less the house edge. No clamping happens here. */
export function quote(
  t: ProbTable,
  spot: bigint,
  low: bigint,
  high: bigint,
  sig1e4: bigint,
  houseEdgeBps: bigint,
): Quote {
  const prob1e6 = probInside(t, spot, low, high, sig1e4);
  if (prob1e6 === 0n) return { multiplierBps: 0n, prob1e6: 0n };
  const gross = (PROB_ONE * BPS) / prob1e6;
  return { multiplierBps: (gross * (BPS - houseEdgeBps)) / BPS, prob1e6 };
}

/** Invert T(z) the same way RangeMarket does: bisect the same table. z is 1e4 fp. */
export function zForProb(t: ProbTable, p1e6: bigint): bigint {
  if (p1e6 >= PROB_ONE) return Z_MAX;
  let lo = 0n;
  let hi = Z_MAX;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2n;
    if (halfProb(t, mid) < p1e6) lo = mid;
    else hi = mid;
  }
  return hi;
}

export interface BandLimits {
  sig1e4: bigint;
  /** Widest sellable half-width, in bps of spot scaled by 1e4 */
  maxHalfWidth1e4: bigint;
  /** Tightest payable half-width, in bps of spot scaled by 1e4 */
  minHalfWidth1e4: bigint;
}

/**
 * Widest band whose win probability is still <= target, or tightest band whose
 * probability is already >= target. Probability rises with width, so both are plain
 * bisections. Mirrors RangeMarket._solveHalfWidth.
 */
function solveHalfWidth(
  t: ProbTable,
  spot: bigint,
  sig1e4: bigint,
  targetProb: bigint,
  lowest: boolean,
): bigint {
  let lo = 1n;
  let hi = 100_000_000n; // 1e4-scaled bps; 1e8 is a 100% wide band

  for (let i = 0; i < 40 && lo < hi; i++) {
    const mid = lowest ? (lo + hi) / 2n : (lo + hi + 1n) / 2n;
    const half = (spot * mid) / 100_000_000n;

    let p: bigint;
    if (half === 0n || half >= spot) {
      p = half === 0n ? 0n : PROB_ONE;
    } else {
      p = probInside(t, spot, spot - half, spot + half, sig1e4);
    }

    if (lowest) {
      if (p >= targetProb) hi = mid;
      else lo = mid + 1n;
    } else {
      if (p <= targetProb) lo = mid;
      else hi = mid - 1n;
    }
  }
  return lo > hi ? hi : lo;
}

/**
 * The window the band painter may move inside. Mirrors RangeMarket.bandLimits.
 *
 * The endpoints are solved against the same arithmetic `fire` uses rather than derived
 * from a z analytically. The analytic route looks right and is not: the trip from z to
 * a 1e4-scaled width to an 8-decimal price and back loses a unit at each truncating
 * division, so the tightest band the painter offered came back one unit under the
 * probability floor — the market refusing a band it had just offered.
 */
export function bandLimits(
  t: ProbTable,
  spot: bigint,
  sig1e4: bigint,
  houseEdgeBps: bigint,
  minMultiplierBps: bigint,
  minProb1e6: bigint,
): BandLimits {
  const pAtFloor = (PROB_ONE * (BPS - houseEdgeBps)) / minMultiplierBps;
  let min = solveHalfWidth(t, spot, sig1e4, minProb1e6, true);
  let max = solveHalfWidth(t, spot, sig1e4, pAtFloor, false);

  // Never sell inside the first measured knot. The table is sampled every 0.25 sigma,
  // so below that this is interpolating between "the price did not move at all" and the
  // first real observation — a straight line that is not a measurement, and is wrong in
  // the player's favour. Mirrors RangeMarket.bandLimits.
  const firstKnot = sig1e4 / 4n; // z = 0.25
  if (min < firstKnot) min = firstKnot;
  if (max < min) max = min;

  return { sig1e4, minHalfWidth1e4: min, maxHalfWidth1e4: max };
}

/** Payout for a stake at a multiplier, in asset units. Mirrors RangeMarket._open. */
export function payoutFor(stake: bigint, multiplierBps: bigint): bigint {
  return (stake * multiplierBps) / BPS;
}

/**
 * Sigma for a horizon between two calibrated rounds. Mirrors
 * RangeMarket.sigmaForBlocks: interpolate between measured points rather than
 * sqrt-scaling one of them, and take the shape from the lower bracketing round.
 */
export function sigmaForBlocks(
  roundBlocks: readonly number[],
  sigmas: readonly bigint[],
  remaining: number,
): { sigma1e4: bigint; tableTier: number } {
  const n = roundBlocks.length;
  if (n === 0) throw new Error("RoundsNotSet");
  if (remaining <= roundBlocks[0]) return { sigma1e4: sigmas[0], tableTier: 0 };
  if (remaining >= roundBlocks[n - 1]) return { sigma1e4: sigmas[n - 1], tableTier: n - 1 };

  for (let i = 0; i + 1 < n; i++) {
    const lo = roundBlocks[i];
    const hi = roundBlocks[i + 1];
    if (remaining >= lo && remaining <= hi) {
      const sLo = sigmas[i];
      const sHi = sigmas[i + 1];
      const sigma1e4 = sLo + ((sHi - sLo) * BigInt(remaining - lo)) / BigInt(hi - lo);
      return { sigma1e4, tableTier: i };
    }
  }
  return { sigma1e4: sigmas[0], tableTier: 0 };
}
