/**
 * The direction kernel against the Cairo one, operand for operand.
 *
 * The desk quotes a ticket before anyone commits to it. If this and `updown.cairo` disagree by
 * a single unit, the price on screen is not the price charged — and the whole argument for
 * showing a multiplier up front collapses. The figures below are the ones pinned in
 * `cairo/tests/test_updown.cairo`, so a change to either side breaks both.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DOWN,
  UP,
  directionFelt,
  directionMultiplierBps,
  directionPayout,
  directionSettlement,
  outcomeOf,
} from "../src/direction.ts";
import { commitmentOf, commitmentOfDirection } from "../src/positions.ts";

test("the multiplier is two, less the edge, exactly", () => {
  // The same three the contract asserts.
  assert.equal(directionMultiplierBps(0n), 20_000n);
  assert.equal(directionMultiplierBps(400n), 19_200n);
  assert.equal(directionMultiplierBps(1_000n), 18_000n);
});

test("each basis point of edge takes exactly two off the multiplier", () => {
  for (let bps = 0n; bps < 2_000n; bps += 37n) {
    assert.equal(directionMultiplierBps(bps), 20_000n - 2n * bps);
  }
});

test("an edge of 100% is refused rather than quoted at zero", () => {
  assert.throws(() => directionMultiplierBps(10_000n));
  assert.throws(() => directionMultiplierBps(12_000n));
});

test("the payout truncates the way the contract does", () => {
  // 1000 * 19200 / 10000 = 1920, and 7 * 19200 / 10000 = 13.44 -> 13.
  assert.equal(directionPayout(1_000n, 400n), 1_920n);
  assert.equal(directionPayout(7n, 400n), 13n);
});

test("both directions are worth the same, which is what hides the bit", () => {
  const stake = 1_234n;
  const up = directionSettlement(stake, 400n, "up", "up");
  const down = directionSettlement(stake, 400n, "down", "down");
  assert.equal(up, down);
  // If these ever differ, the reserve says which side a ticket is on and the direction is
  // public — the reserve being the one number an observer can always read.
  assert.equal(up, 2_369n); // 1234 * 19200 / 10000 = 2369.28, floored
});

test("a tie returns the stake to either side", () => {
  assert.equal(directionSettlement(1_000n, 400n, "up", "tie"), 1_000n);
  assert.equal(directionSettlement(1_000n, 400n, "down", "tie"), 1_000n);
});

test("the wrong side is paid nothing", () => {
  assert.equal(directionSettlement(1_000n, 400n, "up", "down"), 0n);
  assert.equal(directionSettlement(1_000n, 400n, "down", "up"), 0n);
});

test("the outcome is read off the two prices, with equality its own case", () => {
  assert.equal(outcomeOf(100n, 101n), "up");
  assert.equal(outcomeOf(100n, 99n), "down");
  assert.equal(outcomeOf(100n, 100n), "tie");
});

test("the felts match the contract's encoding", () => {
  assert.equal(directionFelt("up"), UP);
  assert.equal(directionFelt("down"), DOWN);
  assert.equal(UP, 0n);
  assert.equal(DOWN, 1n);
});

test("a direction commitment can never be replayed as a range commitment", () => {
  // Same secret, same id, same everything the two hashes share. Only the domain tag differs,
  // and both contracts number their markets from one — so without distinct tags a preimage
  // valid on the range market would be valid on the direction market.
  const secret = "0x1234";
  const direction = commitmentOfDirection({ secret, roundId: 1, direction: "up" });
  const range = commitmentOf({ secret, marketId: 1, bandLow: 0n, bandHigh: 0n });
  assert.notEqual(direction, range);
});

test("up and down are different commitments under the same secret", () => {
  const secret = "0xbeef";
  const up = commitmentOfDirection({ secret, roundId: 7, direction: "up" });
  const down = commitmentOfDirection({ secret, roundId: 7, direction: "down" });
  assert.notEqual(up, down);
  // And neither is guessable from the other without the secret, which is the whole point of
  // hashing one bit alongside 31 bytes of entropy.
  assert.match(up, /^0x[0-9a-f]+$/);
});

test("the commitment is stable — the same preimage always resolves to the same ticket", () => {
  const a = commitmentOfDirection({ secret: "0xa", roundId: 3, direction: "down" });
  const b = commitmentOfDirection({ secret: "0xa", roundId: 3, direction: "down" });
  assert.equal(a, b);
});
