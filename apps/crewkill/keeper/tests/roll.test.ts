import { describe, it, expect } from "vitest";
import { roll } from "../src/game/strategies.js";

/**
 * The agents' dice.
 *
 * Seeded from a role secret so a match replays identically, which is the property that makes
 * a disputed match checkable afterwards. If this stopped being deterministic, replays would
 * silently diverge from what actually happened and nobody would notice until it mattered.
 */
describe("roll", () => {
  const secret = 0x1234abcdn;

  it("gives the same answer for the same inputs", () => {
    expect(roll(secret, 3, "move")).toBe(roll(secret, 3, "move"));
  });

  it("stays inside [0, 1)", () => {
    for (let round = 0; round < 50; round += 1) {
      const value = roll(secret, round, "move");
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("separates rounds, salts and secrets", () => {
    // Two agents rolling in the same round must not roll alike, or they move as one.
    expect(roll(secret, 1, "move")).not.toBe(roll(secret, 2, "move"));
    expect(roll(secret, 1, "move")).not.toBe(roll(secret, 1, "kill"));
    expect(roll(secret, 1, "move")).not.toBe(roll(secret + 1n, 1, "move"));
  });

  it("spreads across the range rather than clustering", () => {
    // A hash that produced a narrow band would make every agent behave the same way while
    // still passing the determinism tests above.
    const buckets = new Array(10).fill(0);
    for (let round = 0; round < 400; round += 1) {
      buckets[Math.floor(roll(secret, round, "move") * 10)] += 1;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(0);
    }
  });
});
