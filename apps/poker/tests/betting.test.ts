import { describe, it, expect } from "vitest";
import { potOdds, formatPotOdds, clampRaise } from "../src/game/betting";

describe("potOdds", () => {
  it("declines to answer when there is nothing to call", () => {
    // Zero percent would read as advice. The honest answer is that the question is moot.
    expect(potOdds(0n, 100n)).toBeNull();
    expect(potOdds(-5n, 100n)).toBeNull();
  });

  it("calling the size of the pot needs a third of the equity", () => {
    // 100 into a 100 pot makes the final pot 200, of which the call is half... of the pot,
    // but a third of what is on the table after it lands. 33.33%.
    expect(potOdds(100n, 200n)).toBeCloseTo(33.33, 1);
  });

  it("a cheap call into a big pot needs almost nothing", () => {
    expect(potOdds(10n, 990n)).toBeCloseTo(1, 2);
  });

  it("keeps a tiny call into a huge pot above zero", () => {
    // 0.001%. At two digits of scale this truncated to exactly 0, and a betting panel
    // printing 0% is telling the player the call is free.
    const odds = potOdds(1n, 100_000n);
    expect(odds).not.toBeNull();
    expect(odds!).toBeGreaterThan(0);
    expect(odds!).toBeCloseTo(0.001, 4);
  });

  it("handles stacks larger than a double holds exactly", () => {
    const huge = 10n ** 30n;
    const odds = potOdds(huge, huge);
    expect(odds).toBeCloseTo(50, 1);
  });
});

describe("clampRaise", () => {
  it("raises a short amount to the minimum", () => {
    expect(clampRaise(5n, 20n, 100n)).toBe(20n);
  });

  it("caps a raise at the stack", () => {
    expect(clampRaise(500n, 20n, 100n)).toBe(100n);
  });

  it("leaves a legal raise alone", () => {
    expect(clampRaise(50n, 20n, 100n)).toBe(50n);
  });
});

describe("formatPotOdds", () => {
  it("never prints a non zero call as zero", () => {
    // The display half of the same problem. Rounding 0.001 to one decimal gives "0.0",
    // which is the claim the scaling above exists to avoid making.
    expect(formatPotOdds(0.001)).toBe("<0.1");
    expect(formatPotOdds(0.09)).toBe("<0.1");
  });

  it("prints ordinary values plainly", () => {
    expect(formatPotOdds(33.33)).toBe("33.3");
    expect(formatPotOdds(50)).toBe("50");
    expect(formatPotOdds(25.0)).toBe("25");
  });
});
