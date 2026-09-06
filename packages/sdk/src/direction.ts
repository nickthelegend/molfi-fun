/**
 * The direction game, mirrored from `cairo/src/updown.cairo`.
 *
 * Same relationship as `pricing.ts` has to `pricing.cairo`: the desk must be able to quote a
 * ticket before anyone commits to it, and the number it shows has to be the number the
 * contract charges. Integer arithmetic throughout, with the same operands in the same order,
 * so the two cannot drift by a rounding step.
 */

import { BPS, payoutFor } from "./pricing.ts";

/** Up settles above the reference, Down below it. The felt values the contract expects. */
export const UP = 0n;
export const DOWN = 1n;

export type Direction = "up" | "down";

export const directionFelt = (d: Direction): bigint => (d === "up" ? UP : DOWN);

/**
 * What both sides of a round are sold at.
 *
 * Two times the fair odds of a coin flip, less the edge, identically for up and down. The
 * symmetry is not a simplification — it is what stops the reserve leaking which side a ticket
 * is on, since the reserve is public and the payout is what determines it.
 *
 * Mirrors `(2 * BPS * (BPS - house_edge_bps)) / BPS` exactly, including the order of
 * operations: multiplying before dividing is what keeps the result exact at every edge.
 */
export function directionMultiplierBps(houseEdgeBps: bigint): bigint {
  if (houseEdgeBps >= BPS) throw new Error("an edge of 100% or more leaves nothing to sell");
  return (2n * BPS * (BPS - houseEdgeBps)) / BPS;
}

/** What a stake returns if it is on the right side. Truncating, like the contract. */
export function directionPayout(stake: bigint, houseEdgeBps: bigint): bigint {
  return payoutFor(stake, directionMultiplierBps(houseEdgeBps));
}

/**
 * Which way a round resolved, from the two prices anyone can read off it.
 *
 * A tie is its own outcome rather than a loss for both sides: the round asked which way the
 * price would move and it did not move, so the stake comes back. Folding a tie into "the house
 * wins" would be an edge that appears nowhere in the quoted multiplier.
 */
export type Outcome = "up" | "down" | "tie";

export function outcomeOf(reference: bigint, settled: bigint): Outcome {
  if (settled > reference) return "up";
  if (settled < reference) return "down";
  return "tie";
}

/** What a ticket is owed once the round has resolved. */
export function directionSettlement(
  stake: bigint,
  houseEdgeBps: bigint,
  picked: Direction,
  outcome: Outcome,
): bigint {
  if (outcome === "tie") return stake;
  return outcome === picked ? directionPayout(stake, houseEdgeBps) : 0n;
}
