import { describe, it, expect } from "vitest";
import { evaluateBestHand } from "../src/game/hand-evaluator";

/**
 * Card values are 0-51. Deriving them by name here rather than writing magic numbers, so a
 * failing test says which cards it meant.
 */
const RANKS = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"];
const SUITS = ["s", "h", "d", "c"];
function card(text: string): number {
  const rank = RANKS.indexOf(text[0].toUpperCase());
  const suit = SUITS.indexOf(text[1].toLowerCase());
  if (rank < 0 || suit < 0) throw new Error(`bad card ${text}`);
  // suit * 13 + rank, which is the protocol's layout. Getting this backwards is how the
  // first draft of this file produced a "pair of 4s" from a board holding a straight.
  return suit * 13 + rank;
}
const hand = (...names: string[]) => names.map(card);

describe("evaluateBestHand", () => {
  it("declines to name a hand before five cards are known", () => {
    // Preflop. The readout depends on this returning null rather than inventing a high card.
    expect(evaluateBestHand(hand("As", "Kd"), [])).toBeNull();
    expect(evaluateBestHand(hand("As", "Kd"), hand("2c", "7h"))).toBeNull();
  });

  it("names a hand as soon as the flop lands", () => {
    const result = evaluateBestHand(hand("As", "Kd"), hand("2c", "7h", "9s"));
    expect(result).not.toBeNull();
    expect(typeof result!.desc).toBe("string");
    expect(result!.desc.length).toBeGreaterThan(0);
  });

  it("finds a pair made across hole and board", () => {
    const result = evaluateBestHand(hand("As", "Kd"), hand("Ac", "7h", "9s"));
    expect(result!.desc.toLowerCase()).toContain("pair");
  });

  it("ranks a flush above a pair on the same board", () => {
    const board = hand("2h", "7h", "9h");
    const flush = evaluateBestHand(hand("Ah", "Kh"), board)!;
    const pair = evaluateBestHand(hand("As", "Ad"), board)!;
    expect(flush.rank).toBeGreaterThan(pair.rank);
  });

  it("plays the board when the hole cards add nothing", () => {
    // Both players hold rags against a made straight on the board; the evaluator must find
    // the straight rather than the rags.
    const board = hand("5c", "6d", "7h", "8s", "9c");
    const result = evaluateBestHand(hand("2h", "3d"), board)!;
    expect(result.desc.toLowerCase()).toContain("straight");
  });

  it("ignores slots that are still face down", () => {
    // Community cards arrive as nulls until they are revealed, and a null must not be read
    // as card zero, which would be the two of clubs.
    const result = evaluateBestHand(hand("As", "Kd"), [card("Ac"), null, null]);
    expect(result).toBeNull();
  });
});
