/**
 * Exact TypeScript mirror of cairo/src/pricing.cairo.
 *
 * Every operation is BigInt so the truncating integer division matches Cairo's u256
 * arithmetic step for step. The desk quotes from this file; the chain quotes from the Cairo
 * one; `test/parity.ts` generates vectors from here that `cairo/tests/test_parity.cairo`
 * asserts to the unit, so the number a trader sees before committing is provably the number
 * they get charged.
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

/** Babylonian integer square root, matching `sqrt_u256` in the Cairo library exactly. */
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
  const [lowOff, highOff] = offsetsOf(spot, low, high);
  return probInsideOff(t, lowOff, highOff, sig1e4);
}

/**
 * How far each edge of a band reaches from spot, as a fraction of spot times 1e8.
 *
 * The absolute price cancels out of `probInside` — every use of it is a ratio to spot — so
 * this pair is the whole of what pricing needs from a band. molfi's public trading route
 * sends only these two numbers on chain, which is what lets a position be priced and paid
 * for without anybody being told where the band sits until it is claimed.
 */
export function offsetsOf(spot: bigint, low: bigint, high: bigint): [bigint, bigint] {
  if (low >= spot || high <= spot) throw new Error("SpotOutsideBand");
  return [((spot - low) * 100_000_000n) / spot, ((high - spot) * 100_000_000n) / spot];
}

/**
 * Probability from the band's reach rather than its place, 1e6 fp.
 *
 * No zero check on the offsets: `offsetsOf` truncates, so a band one unit wide around a big
 * spot legitimately reaches zero on a side, and the spot-based form priced that at zero
 * rather than refusing it. The multiplier bounds turn a degenerate band away instead.
 */
export function probInsideOff(
  t: ProbTable,
  lowOff1e8: bigint,
  highOff1e8: bigint,
  sig1e4: bigint,
): bigint {
  if (sig1e4 === 0n) throw new Error("ZeroSigma");
  const zLow = (lowOff1e8 * BPS) / sig1e4;
  const zHigh = (highOff1e8 * BPS) / sig1e4;
  return (halfProb(t, zLow) + halfProb(t, zHigh)) / 2n;
}

export interface Quote {
  /** Offered multiplier in bps. 10_000 = 1.00x */
  multiplierBps: bigint;
  /** Win probability, 1e6 fp */
  prob1e6: bigint;
}

/** The multiplier molfi offers: 1/p less the house edge. No clamping happens here. */
export function quote(
  t: ProbTable,
  spot: bigint,
  low: bigint,
  high: bigint,
  sig1e4: bigint,
  houseEdgeBps: bigint,
): Quote {
  const [lowOff, highOff] = offsetsOf(spot, low, high);
  return quoteOff(t, lowOff, highOff, sig1e4, houseEdgeBps);
}

/** The same multiplier, from the band's reach. What the public trading route is charged. */
export function quoteOff(
  t: ProbTable,
  lowOff1e8: bigint,
  highOff1e8: bigint,
  sig1e4: bigint,
  houseEdgeBps: bigint,
): Quote {
  const prob1e6 = probInsideOff(t, lowOff1e8, highOff1e8, sig1e4);
  if (prob1e6 === 0n) return { multiplierBps: 0n, prob1e6: 0n };
  const gross = (PROB_ONE * BPS) / prob1e6;
  return { multiplierBps: (gross * (BPS - houseEdgeBps)) / BPS, prob1e6 };
}

/** Invert T(z) by bisecting the same table the forward direction reads. z is 1e4 fp. */
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
 * The widest, or tightest, half-width whose quoted multiplier is still on the right side of
 * a bound.
 *
 * Bisected against `quote` itself rather than against a probability derived from the bound.
 * The two are not inverses: `quote` floors twice — once turning a probability into a gross
 * multiplier, once applying the edge — so the width whose probability equals the analytic
 * target quotes a basis point or two below it. That gap is what made the painter offer a band
 * the desk then refused, which is the single most confusing thing a market can do.
 *
 * The multiplier falls as the band widens, so both directions are plain bisections.
 */
function solveHalfWidth(
  t: ProbTable,
  spot: bigint,
  sig1e4: bigint,
  boundBps: bigint,
  houseEdgeBps: bigint,
  /** true: the tightest width quoting at or below the bound. false: the widest at or above. */
  tightest: boolean,
): bigint {
  let lo = 1n;
  let hi = 100_000_000n; // 1e8 is a band 100% of spot wide on each side

  const multiplierAt = (width: bigint): bigint => {
    const half = (spot * width) / 100_000_000n;
    if (half === 0n) return MAX_SAFE_MULTIPLIER;
    if (half >= spot) return 0n;
    return quote(t, spot, spot - half, spot + half, sig1e4, houseEdgeBps).multiplierBps;
  };

  for (let i = 0; i < 40 && lo < hi; i += 1) {
    const mid = tightest ? (lo + hi) / 2n : (lo + hi + 1n) / 2n;
    const m = multiplierAt(mid);
    if (tightest) {
      // Narrower pays more, so a multiplier still above the cap means widen.
      if (m <= boundBps) hi = mid;
      else lo = mid + 1n;
    } else {
      if (m >= boundBps) lo = mid;
      else hi = mid - 1n;
    }
  }
  return lo > hi ? hi : lo;
}

/** Stand-in for "infinitely rich", used only where the band has collapsed to nothing. */
const MAX_SAFE_MULTIPLIER = 1n << 64n;

/**
 * The window the band painter may move inside.
 *
 * Both endpoints are solved against the same `quote` the desk charges with, so every width
 * the painter offers is a width the desk will actually sell. Deriving them from a target
 * probability instead looks equivalent and is not — see `solveHalfWidth`.
 */
export function bandLimits(
  t: ProbTable,
  spot: bigint,
  sig1e4: bigint,
  houseEdgeBps: bigint,
  minMultiplierBps: bigint,
  maxMultiplierBps: bigint,
): BandLimits {
  let min = solveHalfWidth(t, spot, sig1e4, maxMultiplierBps, houseEdgeBps, true);
  let max = solveHalfWidth(t, spot, sig1e4, minMultiplierBps, houseEdgeBps, false);

  // Never sell inside the first measured knot. The table is sampled every 0.25 sigma, so
  // below that this is interpolating between "the price did not move at all" and the first
  // real observation — a straight line that is not a measurement, and is wrong in the
  // trader's favour.
  const firstKnot = sig1e4 / 4n; // z = 0.25
  if (min < firstKnot) min = firstKnot;
  if (max < min) max = min;

  return { sig1e4, minHalfWidth1e4: min, maxHalfWidth1e4: max };
}

/** Payout for a stake at a multiplier, in token units. Mirrors `payout_for` in Cairo. */
export function payoutFor(stake: bigint, multiplierBps: bigint): bigint {
  return (stake * multiplierBps) / BPS;
}

/**
 * Sigma for a round with `remaining` seconds left, interpolated between calibrated tiers.
 *
 * Interpolating between measured points rather than sqrt-scaling one of them, and taking the
 * table shape from the lower bracketing tier. Square-root scaling is the textbook move and it
 * does not hold on real tape at these horizons — measured sigma over four hours is not four
 * times the fifteen minute figure, it is closer to three and a half. Scaling would misprice
 * every band that is not exactly on a calibrated tier.
 *
 * Used when topping up an open position: the top-up is quoted against the time actually left,
 * not against the round it was originally sold for.
 */
export function sigmaForSeconds(
  roundSeconds: readonly number[],
  sigmas: readonly bigint[],
  remaining: number,
): { sigma1e4: bigint; tableTier: number } {
  const n = roundSeconds.length;
  if (n === 0) throw new Error("RoundsNotSet");
  if (remaining <= roundSeconds[0]) return { sigma1e4: sigmas[0], tableTier: 0 };
  if (remaining >= roundSeconds[n - 1]) return { sigma1e4: sigmas[n - 1], tableTier: n - 1 };

  for (let i = 0; i + 1 < n; i += 1) {
    const lo = roundSeconds[i];
    const hi = roundSeconds[i + 1];
    if (remaining >= lo && remaining <= hi) {
      const sigma1e4 =
        sigmas[i] + ((sigmas[i + 1] - sigmas[i]) * BigInt(remaining - lo)) / BigInt(hi - lo);
      return { sigma1e4, tableTier: i };
    }
  }
  return { sigma1e4: sigmas[0], tableTier: 0 };
}

/**
 * The largest stake a market can still sell at a given multiplier.
 *
 * `open_position` reserves the whole payout up front and refuses anything the market cannot
 * already cover: `reserved + payout <= staked + amount + bankroll`. Solved for `amount`,
 * with `payout = amount * multiplier / 10_000`, that is
 *
 *   amount * (multiplier - 10_000) / 10_000 <= staked + bankroll - reserved
 *
 * so the answer is the free backing scaled by how much of the payout the trader is not
 * funding themselves. A multiplier at or below 1x is refused elsewhere for being a losing
 * proposition, and is treated here as unbounded rather than dividing by zero.
 *
 * This existed only in Cairo, which meant the console cheerfully offered a 50 STRK stake
 * into a market holding a 0.05 STRK bankroll and let the chain deliver the news as
 * `MARKET_CANNOT_COVER_PAYOUT` after the user had signed. The rule belongs where the size is
 * chosen, not only where it is enforced.
 */
export function maxStakeFor(
  m: { staked: bigint; bankroll: bigint; reserved: bigint },
  multiplierBps: bigint,
): bigint {
  const free = m.staked + m.bankroll - m.reserved;
  if (free <= 0n) return 0n;
  if (multiplierBps <= BPS) return free * BPS; // effectively unbounded; nothing to reserve
  return (free * BPS) / (multiplierBps - BPS);
}
