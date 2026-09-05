import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteBand, sellableHalfWidths } from "../src/quote.ts";
import { MARKETS, marketByKey, marketByPair } from "../src/markets.ts";
import { CALIBRATIONS, HOUSE_EDGE_BPS } from "../src/generated/tables.ts";
import { pairId } from "../src/pragma.ts";

const btc = marketByKey("btc")!;
const SPOT = 79_751_52500000n; // BTC in Pragma's 8dp fixed point
const STAKE = 1_000_000n;

test("markets are keyed by the pair label the oracle uses", () => {
  for (const m of MARKETS) {
    assert.equal(m.pairId, pairId(m.pair), `${m.key} pair id`);
  }
  assert.equal(marketByPair("BTC/USD")?.key, "btc");
});

test("no market survives from the Monad build", () => {
  // MON does not exist on Starknet and Pragma does not publish it.
  assert.ok(!MARKETS.some((m) => /MON/i.test(m.pair)));
});

test("every listed market has a calibration for every horizon it offers", () => {
  for (const m of MARKETS) {
    for (const h of m.horizons) {
      const found = CALIBRATIONS.some((c) => c.marketKey === m.key && c.horizonKey === h.key);
      assert.ok(found, `${m.key} has no table for ${h.key}`);
    }
  }
});

/**
 * Half-widths are scaled to the market's own sigma, not to round percentages.
 *
 * BTC's fifteen-minute sigma is about 0.18%, so a "reasonable looking" band of half a percent
 * is nearly three sigma and prices below the sellable floor. A test that hard-codes percentages
 * ends up asserting the desk is broken when it is working.
 */
const sigmaOf = (horizon: string) =>
  CALIBRATIONS.find((c) => c.marketKey === "btc" && c.horizonKey === horizon)!.sigma1e4;

const bandAt = (zTimes100: bigint, horizon = "15m") => {
  const half = (SPOT * sigmaOf(horizon) * zTimes100) / (100_000_000n * 100n);
  return [SPOT - half, SPOT + half] as const;
};

test("a band straddling spot quotes above one", () => {
  const [lo, hi] = bandAt(100n); // one sigma
  const r = quoteBand(CALIBRATIONS, btc, "15m", SPOT, lo, hi, STAKE, HOUSE_EDGE_BPS);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(r.multiplierBps > 10_000n, "pays more than the stake");
    assert.ok(r.payout > STAKE, "a win beats the stake");
  }
});

test("a tighter band pays more than a wider one", () => {
  const [wLo, wHi] = bandAt(150n); // 1.5 sigma
  const [tLo, tHi] = bandAt(60n); // 0.6 sigma
  const wide = quoteBand(CALIBRATIONS, btc, "15m", SPOT, wLo, wHi, STAKE, HOUSE_EDGE_BPS);
  const tight = quoteBand(CALIBRATIONS, btc, "15m", SPOT, tLo, tHi, STAKE, HOUSE_EDGE_BPS);
  assert.equal(wide.ok, true);
  assert.equal(tight.ok, true);
  if (wide.ok && tight.ok) assert.ok(tight.multiplierBps > wide.multiplierBps);
});

test("a band that does not contain spot is refused by name", () => {
  const r = quoteBand(CALIBRATIONS, btc, "15m", SPOT, SPOT + 1n, SPOT + 100n, STAKE, HOUSE_EDGE_BPS);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, "band-not-straddling");
});

test("an inverted band is refused by name", () => {
  const r = quoteBand(CALIBRATIONS, btc, "15m", SPOT, SPOT + 100n, SPOT - 100n, STAKE, HOUSE_EDGE_BPS);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, "band-inverted");
});

test("an unknown horizon is refused rather than silently priced", () => {
  const r = quoteBand(CALIBRATIONS, btc, "7y", SPOT, SPOT - 100n, SPOT + 100n, STAKE, HOUSE_EDGE_BPS);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, "no-calibration");
});

test("a band so wide the fee eats the edge is refused", () => {
  const r = quoteBand(CALIBRATIONS, btc, "15m", SPOT, SPOT / 10n, SPOT * 10n, STAKE, HOUSE_EDGE_BPS);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, "too-cheap");
});

test("the sellable window is ordered and positive", () => {
  const w = sellableHalfWidths(CALIBRATIONS, btc, "15m", SPOT, HOUSE_EDGE_BPS);
  assert.ok(w);
  assert.ok(w!.minHalfWidth1e4 > 0n);
  assert.ok(w!.maxHalfWidth1e4 >= w!.minHalfWidth1e4, "widest is not tighter than tightest");
});

test("an uncalibrated market has no sellable window rather than a made-up one", () => {
  assert.equal(sellableHalfWidths(CALIBRATIONS, btc, "7y", SPOT, HOUSE_EDGE_BPS), null);
});
