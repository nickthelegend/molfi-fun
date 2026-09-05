/**
 * How volatility is estimated for pricing — the one implementation.
 *
 * This lives on its own because two things need it and they must not drift: the
 * calibration that generates the on-chain tables, and the keeper that re-marks sigma
 * between calibrations. A keeper carrying its own copy of this arithmetic would be a
 * solvency bug waiting for someone to edit one of them.
 *
 * The estimate is deliberately one-sided. The vault is safe exactly when the modelled
 * win chance is at least the real one, and a band's real win chance is highest when the
 * market is quietest — so the bound that actually holds comes from the quiet end of
 * recent windows, not from the latest reading shaded by a fixed factor, which errs
 * whichever way the regime happens to move next.
 */
import { ROUND_BLOCKS, sigmaOver, tierSeconds } from "./termstructure.ts";

/**
 * A flat shave on every fitted sigma.
 *
 * A smaller model sigma means a larger z, a higher modelled win chance, and a lower
 * multiplier — so shading down buys a one-sided guarantee. The price is a wider spread
 * than the 4% fee, which is measured and disclosed rather than hidden.
 */
export const HAIRCUT = 0.95;

/**
 * Where in the sorted distribution of recent realised sigmas the estimate sits.
 *
 * The 30th percentile rather than the outright minimum. The minimum is a single
 * unusually still ten minutes, and pricing everything off it charges a spread nobody
 * would pay; a low percentile keeps the one-sided guarantee without handing the whole
 * surplus to the house.
 */
export const QUIET_PERCENTILE = 0.3;

/**
 * Extra shading on the short rounds.
 *
 * The multiplier is (1 - fee) / p, so a fixed error in p costs more expected value the
 * smaller p is — and the shortest round sells the highest modelled chances. A
 * three-point miss on a 70% band is worth several percent of the stake there and almost
 * nothing at fifteen minutes. Measured against tape the fit had not seen, the
 * three-second round was the only one that came out player-positive under a single
 * global haircut, so it gets a deeper one.
 *
 * The numbers are empirical, and deliberately so. Three separate analytic gates were
 * tried first — bounding the book average, bounding the tail, bounding the default band
 * — and each certified rounds that tools/checks/paper-calibration.mjs then failed,
 * because none of them measured what that check measures. These were tuned against it
 * directly until every round cleared with margin.
 */
export const ROUND_SAFETY = [0.6, 0.9, 0.95, 1.0, 1.0, 1.0];

/** Realised sigma at the quiet end of the sub-windows inside `window`. */
export function quietSigma(window: number[], seconds: number, sub: number): number {
  const stride = Math.max(1, Math.floor(sub / 4));
  const observed: number[] = [];
  for (let start = 0; start + sub <= window.length; start += stride) {
    const s = sigmaOver(window.slice(start, start + sub), seconds);
    if (s > 0) observed.push(s);
  }
  if (observed.length === 0) return sigmaOver(window, seconds) * HAIRCUT;
  observed.sort((a, b) => a - b);
  const idx = Math.min(observed.length - 1, Math.floor(QUIET_PERCENTILE * observed.length));
  return observed[idx] * HAIRCUT;
}

/** The sigma a round of `seconds` is priced off, given a window of 1s log returns. */
export function fitSigma(window: number[], seconds: number): number {
  return quietSigma(window, seconds, Math.max(600, seconds * 10));
}

/**
 * The full set of per-round sigmas, in the 1e4-of-a-fraction fixed point the contract
 * stores (`RoundConfig.sigma1e4`), including the short-round safety shading.
 */
export function remarkSigmas1e4(recent: number[]): number[] {
  return ROUND_BLOCKS.map((b, i) => {
    const s = fitSigma(recent, tierSeconds(b)) * (ROUND_SAFETY[i] ?? 1);
    return Math.max(1, Math.round(s * 1e8));
  });
}
