import { test } from "node:test";
import assert from "node:assert/strict";
import { costToMoveMark, type Level } from "../src/orderbook.ts";

/** A book with even levels a penny apart, so the arithmetic is checkable by hand. */
const bids: Level[] = [
  { price: 100, size: 10 },
  { price: 99, size: 10 },
  { price: 98, size: 10 },
  { price: 97, size: 10 },
];
const asks: Level[] = [
  { price: 102, size: 10 },
  { price: 103, size: 10 },
  { price: 104, size: 10 },
  { price: 105, size: 10 },
];
// mid = 101

test("moving the mark up means eating the asks", () => {
  const c = costToMoveMark(bids, asks, 102);
  assert.equal(c.side, "asks");
  assert.ok(c.reachable);
  // To make the mid 102 the ask must reach 104, so 102 and 103 are consumed.
  assert.equal(c.levels, 2);
  assert.equal(c.size, 20);
  assert.equal(c.notional, 10 * 102 + 10 * 103);
});

test("moving the mark down means eating the bids", () => {
  const c = costToMoveMark(bids, asks, 100);
  assert.equal(c.side, "bids");
  assert.ok(c.reachable);
  assert.equal(c.levels, 2);
  assert.equal(c.notional, 10 * 100 + 10 * 99);
});

test("a target the ladder cannot reach is reported, not extrapolated", () => {
  const c = costToMoveMark(bids, asks, 200);
  assert.equal(c.reachable, false, "inventing depth would turn a measurement into a guess");
  assert.equal(c.levels, asks.length, "it walked everything it had");
});

test("an empty side has no answer", () => {
  const c = costToMoveMark([], asks, 105);
  assert.equal(c.reachable, false);
  assert.equal(c.notional, 0);
});

test("a bigger move costs strictly more", () => {
  const near = costToMoveMark(bids, asks, 101.6);
  const far = costToMoveMark(bids, asks, 103);
  assert.ok(far.notional > near.notional, "further is dearer");
  assert.ok(far.levels >= near.levels);
});
