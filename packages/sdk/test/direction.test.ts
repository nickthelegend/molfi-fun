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
import { claimDirectionCalls, openDirectionCalls } from "../src/trade.ts";

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

test("the direction calls send a commitment and a stake, and nothing else", () => {
  // The whole privacy claim for this game, asserted on the bytes that go to the chain.
  const a = { pool: "0x1", token: "0x2", market: "0x3", upDownMarket: "0x4" };
  const s = { secret: "0xabc", roundId: 5, direction: "up" as const };
  const calls = openDirectionCalls(a, s, 2n * 10n ** 18n);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].entrypoint, "approve");
  assert.equal(calls[1].entrypoint, "open_ticket");

  const sent = (calls[1].calldata as string[]).map(String);
  // round id, commitment, stake low, stake high. Four felts, and not one of them is the
  // direction — a fifth felt here would be the bit going to the chain in the clear.
  assert.equal(sent.length, 4);
  assert.equal(sent[0], "5");
  assert.equal(sent[1], BigInt(commitmentOfDirection(s)).toString());

  // The same round and stake with the other direction differs only in the commitment, so an
  // observer comparing two opens learns nothing but that they are different tickets.
  const down = openDirectionCalls(a, { ...s, direction: "down" }, 2n * 10n ** 18n);
  const sentDown = (down[1].calldata as string[]).map(String);
  assert.equal(sentDown[0], sent[0]);
  assert.equal(sentDown[2], sent[2]);
  assert.notEqual(sentDown[1], sent[1]);
});

test("the claim reveals the direction, and only then", () => {
  const s = { secret: "0xabc", roundId: 5, direction: "down" as const };
  const [call] = claimDirectionCalls({ upDownMarket: "0x4" }, s);
  assert.equal(call.entrypoint, "claim_ticket");
  const sent = (call.calldata as string[]).map(String);
  assert.equal(sent[0], "5");
  assert.equal(sent[1], String(BigInt("0xabc")));
  assert.equal(sent[2], "1", "down is felt 1, matching direction_felt in updown.cairo");
});
