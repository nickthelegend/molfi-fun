import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PRICE_AGE_SECONDS,
  SETTLEMENT_MAX_PRICE_AGE_SECONDS,
  decodePrint,
  freshness,
  pairId,
  toDisplay,
  type Print,
} from "../src/pragma.ts";

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

/**
 * Two limits, two questions.
 *
 * These exist because /api/health asked the desk's question and labelled the answer
 * `settleable`, and reported the oracle `down` for a 646-second print the contract would
 * have settled against without complaint. The API contradicting the chain is the failure
 * mode this whole repo is organised against, so the distinction is pinned rather than
 * described.
 */
test("a print past the desk's limit but inside the contract's is settleable, not quotable", () => {
  const now = 1_800_000_000;
  const print = { raw: 7_900_000_000_000n, decimals: 8, updatedAt: now - 700, sources: 10 };

  const quote = freshness(print, now, MAX_PRICE_AGE_SECONDS);
  const settle = freshness(print, now, SETTLEMENT_MAX_PRICE_AGE_SECONDS);

  assert.equal(quote.fresh, false, "the desk will not sell a band around a 700s-old number");
  assert.equal(settle.fresh, true, "the contract settles anything under 900s");
  assert.equal(settle.ageSeconds, 700);
});

test("past the contract's limit, both refuse", () => {
  const now = 1_800_000_000;
  const print = { raw: 7_900_000_000_000n, decimals: 8, updatedAt: now - 1_000, sources: 10 };
  assert.equal(freshness(print, now, MAX_PRICE_AGE_SECONDS).fresh, false);
  assert.equal(freshness(print, now, SETTLEMENT_MAX_PRICE_AGE_SECONDS).fresh, false);
});

test("a thin median is refused however fresh it is", () => {
  // Age and breadth are independent ways a feed goes bad. A one-publisher median is one
  // opinion wearing a median's clothes, and no amount of freshness fixes that.
  const now = 1_800_000_000;
  const print = { raw: 7_900_000_000_000n, decimals: 8, updatedAt: now - 5, sources: 2 };
  assert.equal(freshness(print, now, SETTLEMENT_MAX_PRICE_AGE_SECONDS).fresh, false);
});

test("the second argument is now, not the limit", () => {
  // `freshness(print, 900)` reads like "allow 900 seconds" and means "pretend it is 1970",
  // which dates every print to the future and makes everything look fresh. One call site
  // nearly shipped that.
  const now = 1_800_000_000;
  const print = { raw: 1n, decimals: 8, updatedAt: now - 700, sources: 10 };
  const wrong = freshness(print, SETTLEMENT_MAX_PRICE_AGE_SECONDS);
  assert.ok(wrong.ageSeconds < 0, "passing the limit as `now` produces a negative age");
  assert.notEqual(wrong.ageSeconds, 700);
});
