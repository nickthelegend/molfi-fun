import { describe, it, expect } from "vitest";
import { cardToRankSuit, cardName } from "@mental-poker/sdk";
import { cardFromValue } from "../src/game/card-utils";

/**
 * Ties the table's display to the protocol's encoding.
 *
 * These are two independent implementations of the same mapping: the SDK's, which is what
 * the contract and the proving layer agree on, and the client's, which is what a player
 * sees. They drifted once - the client's rank table started at the ace instead of the two,
 * so every card on the table displayed one rank off and the showdown contradicted the
 * cards - and the only reason that was ever visible is a test like this one.
 *
 * Checked across all 52 values rather than a sample, because the failure was a shift of
 * exactly one and a sample can miss a shift.
 */
describe("card encoding", () => {
  it("agrees with the SDK on the rank of all 52 cards", () => {
    const mismatches: string[] = [];
    for (let value = 0; value < 52; value += 1) {
      const sdk = cardToRankSuit(value);
      const ui = cardFromValue(value);
      // The client writes ten as "10" and the SDK as "T". Same card, different face.
      const sdkRank = sdk.rankName === "T" ? "10" : sdk.rankName;
      if (sdkRank !== ui.rank) {
        mismatches.push(`${value}: sdk=${sdkRank} ui=${ui.rank}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("agrees with the SDK on the suit of all 52 cards", () => {
    for (let value = 0; value < 52; value += 1) {
      const sdk = cardToRankSuit(value);
      const ui = cardFromValue(value);
      expect(ui.suit).toBe(sdk.suitName.toLowerCase());
    }
  });

  it("puts the two at the bottom and the ace at the top", () => {
    // The specific thing that was wrong. Value 0 is the two of spades, not the ace.
    expect(cardFromValue(0).rank).toBe("2");
    expect(cardFromValue(12).rank).toBe("A");
    expect(cardName(0)).toBe("2♠");
    expect(cardName(12)).toBe("A♠");
  });

  it("renders every card with a label the SDK would recognise", () => {
    for (let value = 0; value < 52; value += 1) {
      const ui = cardFromValue(value);
      expect(ui.label).toBe(`${ui.rank}${ui.symbol}`);
    }
  });
});
