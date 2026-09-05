import { test } from "node:test";
import assert from "node:assert/strict";
import { decodePrint, freshness, pairId, toDisplay, type Print } from "../src/pragma.ts";

const NOW = 1_800_000_000;
const print = (over: Partial<Print> = {}): Print => ({
  raw: 7_975_152_500_000n,
  decimals: 8,
  updatedAt: NOW - 60,
  sources: 10,
  ...over,
});

test("a pair label encodes as the short string Pragma keys on", () => {
  // "ETH/USD" is the value the Cairo Book prints for this feed. If the encoding drifts, the
  // oracle silently answers about a different asset, so it is pinned to a known constant.
  assert.equal(pairId("ETH/USD"), 19_514_442_401_534_788n);
  assert.equal(pairId("BTC/USD"), 0x4254432f555344n);
});

test("a label that is not a pair is refused rather than encoded", () => {
  for (const bad of ["ETHUSD", "eth/usd", "ETH/USDT/X", ""]) {
    assert.throws(() => pairId(bad), /not a pair label/);
  }
});

test("a fresh multi-source print is quotable", () => {
  const f = freshness(print(), NOW);
  assert.equal(f.fresh, true);
  assert.equal(f.reason, "");
  assert.equal(f.ageSeconds, 60);
});

test("an old print is refused, and says how old", () => {
  const f = freshness(print({ updatedAt: NOW - 4000 }), NOW);
  assert.equal(f.fresh, false);
  assert.match(f.reason, /67 minutes old/);
});

test("a single-source print is refused even when it is seconds old", () => {
  // The Sepolia failure exactly: recent, and one publisher. A median of one is not a median,
  // and freshness alone would have waved it through.
  const f = freshness(print({ sources: 1, updatedAt: NOW - 5 }), NOW);
  assert.equal(f.fresh, false);
  assert.match(f.reason, /only 1 publisher/);
});

test("decoding follows the oracle's declaration order", () => {
  const p = decodePrint(["0x1d0e9c9e2d94", "0x8", "0x6b49d200", "0xa"]);
  assert.equal(p.decimals, 8);
  assert.equal(p.sources, 10);
  assert.equal(p.updatedAt, 0x6b49d200);
});

test("a short response is an error, not a partially filled print", () => {
  // A truncated read must not become a price of zero at time zero, which would look like a
  // legitimate crash to every band that priced against it.
  assert.throws(() => decodePrint(["0x1", "0x8"]), /short oracle response/);
});

test("display conversion respects the oracle's own decimals", () => {
  assert.equal(toDisplay(print()), 79_751.525);
  assert.equal(toDisplay(print({ raw: 100n, decimals: 2 })), 1);
});
