/**
 * Betting arithmetic, kept out of the component that draws it.
 *
 * These are the numbers a player makes decisions on, so they are worth testing directly
 * rather than through a rendered panel. Everything is bigint: chip counts come off the chain
 * as felts and a stack large enough to lose precision as a double is entirely reachable.
 */

/** Precision the ratio is carried at internally. Well past anything a panel will display. */
const SCALE = 1_000_000n;

/**
 * The share of the final pot this call would represent, in percent.
 *
 * This is also the equity the hand needs for the call to break even, which is the reason to
 * show it. Returns null when there is nothing to call, because zero percent reads as advice
 * and the honest answer there is that the question does not apply.
 *
 * Carried at six digits of scale rather than the two a display needs. A call of 1 into a pot
 * of 100,000 is 0.001% and at two digits that truncates to exactly zero, which on a betting
 * panel reads as "this call is free" - a different claim from "this call is very cheap", and
 * the wrong one.
 */
export function potOdds(callAmount: bigint, pot: bigint): number | null {
  if (callAmount <= 0n) return null;
  const final = pot + callAmount;
  if (final <= 0n) return null;
  // Scaled before dividing so the ratio stays in bigint the whole way. Doing this in floating
  // point would overflow the mantissa on stacks the chain can legitimately hold.
  const scaled = (callAmount * 100n * SCALE) / final;
  return Number(scaled) / Number(SCALE);
}

/**
 * The same number as a panel should print it.
 *
 * Rounds to one decimal, except that a value which is genuinely non zero never rounds down
 * to "0". Below the display's resolution it says so rather than claiming zero.
 */
export function formatPotOdds(odds: number): string {
  if (odds > 0 && odds < 0.1) return "<0.1";
  return odds.toFixed(1).replace(/\.0$/, "");
}

/** Clamps a raise into the band the table actually allows. */
export function clampRaise(amount: bigint, min: bigint, max: bigint): bigint {
  if (amount < min) return min;
  if (amount > max) return max;
  return amount;
}
