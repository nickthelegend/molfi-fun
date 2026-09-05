import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteBand, sellableHalfWidths } from "../src/quote.ts";
import { MARKETS, ROUND_SECONDS, marketByKey, marketByPair, roundLabel } from "../src/markets.ts";
import {
  CALIBRATED_MARKETS,
  HOUSE_EDGE_BPS,
  ROUND_KEYS,
} from "../src/generated/markets.ts";
import { HOUSE_EDGE_BPS as EDGE_AT_FIT, SIGMA_SHADE, HORIZONS } from "../src/calibrate.ts";
import { pairId } from "../src/pragma.ts";

const btc = marketByKey("BTC")!;
const SPOT = 79_751_52500000n; // BTC in Pragma's 8dp fixed point
const STAKE = 1_000_000n;
const FIFTEEN = 0; // tier index

test("markets are keyed by the pair label the oracle uses", () => {
  for (const m of MARKETS) {
    assert.equal(m.pairId, pairId(m.label), `${m.key} pair id`);
  }
  assert.equal(marketByPair("BTC/USD")?.key, "BTC");
});

test("no market survives from the Monad build", () => {
  // MON does not exist on Starknet and Pragma does not publish it.
  assert.ok(!MARKETS.some((m) => /MON/i.test(m.label)));
});

test("every listed market is calibrated for every round it offers", () => {
  for (const m of MARKETS) {
    assert.equal(m.rounds.length, ROUND_SECONDS.length, `${m.key} is missing a round`);
    m.rounds.forEach((r, i) => {
      assert.equal(r.seconds, ROUND_SECONDS[i], `${m.key} tier ${i} length`);
      assert.equal(r.probTable.length, 17, `${m.key} tier ${i} table length`);
      assert.ok(r.sigma1e4 > 0n, `${m.key} tier ${i} sigma`);
    });
  }
});

test("no round is shorter than one oracle publish cycle", () => {
  // A round that closes before Pragma has republished settles against a price that was
  // already public when it opened, which is the one thing a prediction market must not do.
  for (const seconds of ROUND_SECONDS) {
    assert.ok(seconds >= 900, `${seconds}s is inside a publish interval`);
  }
});

test("the shipped tables were fitted under the edge the desk quotes with", () => {
  // The drift that would otherwise be invisible: recalibrating under one house edge and
  // quoting under another. Both numbers look fine alone and the difference lands entirely
  // in the multiplier.
  assert.equal(HOUSE_EDGE_BPS, EDGE_AT_FIT);
  assert.equal(SIGMA_SHADE, 0.9);
  assert.deepEqual([...ROUND_KEYS], HORIZONS.map((h) => h.key));
});

/**
 * Half-widths are scaled to the market's own sigma, not to round percentages.
 *
 * BTC's fifteen-minute sigma is about 0.17%, so a "reasonable looking" band of half a percent
 * is nearly three sigma and prices below the sellable floor. A test that hard-codes
 * percentages ends up asserting the desk is broken when it is working.
 */
const sigmaOf = (tier: number) => btc.rounds[tier].sigma1e4;

const bandAt = (zTimes100: bigint, tier = FIFTEEN) => {
  const half = (SPOT * sigmaOf(tier) * zTimes100) / (100_000_000n * 100n);
  return [SPOT - half, SPOT + half] as const;
};

test("a band straddling spot quotes above one", () => {
  const [lo, hi] = bandAt(100n); // one sigma
  const q = quoteBand(btc, FIFTEEN, SPOT, lo, hi, STAKE);
  assert.ok(q.ok);
  assert.ok(q.multiplierBps > 10_000n);
  assert.equal(q.payout, (STAKE * q.multiplierBps) / 10_000n);
});

test("a tighter band pays more than a wider one", () => {
  const tight = quoteBand(btc, FIFTEEN, SPOT, ...bandAt(50n), STAKE);
  const wide = quoteBand(btc, FIFTEEN, SPOT, ...bandAt(150n), STAKE);
  assert.ok(tight.ok && wide.ok);
  assert.ok(tight.multiplierBps > wide.multiplierBps);
});

test("a band that does not contain spot is refused by name", () => {
  const q = quoteBand(btc, FIFTEEN, SPOT, SPOT + 1n, SPOT + 100n, STAKE);
  assert.ok(!q.ok);
  assert.equal(q.error.kind, "band-not-straddling");
});

test("an inverted band is refused by name", () => {
  const q = quoteBand(btc, FIFTEEN, SPOT, SPOT + 100n, SPOT - 100n, STAKE);
  assert.ok(!q.ok);
  assert.equal(q.error.kind, "band-inverted");
});

test("an unknown round is refused rather than silently priced", () => {
  const q = quoteBand(btc, 99, SPOT, ...bandAt(100n), STAKE);
  assert.ok(!q.ok);
  assert.equal(q.error.kind, "no-calibration");
});

test("a band so wide the fee eats the edge is refused", () => {
  const q = quoteBand(btc, FIFTEEN, SPOT, ...bandAt(400n), STAKE);
  assert.ok(!q.ok);
  assert.equal(q.error.kind, "too-cheap");
});

test("an uncalibrated round has no sellable window rather than a made-up one", () => {
  assert.equal(sellableHalfWidths(btc, 99, SPOT), null);
});

test("every width the painter offers is a width the desk will sell", () => {
  // The bug this exists to catch: the window was solved against a probability derived from
  // the multiplier floor, but `quote` truncates twice on the way from a probability to a
  // multiplier. So the widest offered band came back one basis point under the floor and was
  // refused — the market declining a band it had just drawn a handle for.
  const spots: Record<string, bigint> = {
    BTC: 7_967_722_750_000n,
    ETH: 245_703_500_000n,
    STRK: 2_853_000n,
  };

  for (const market of MARKETS) {
    for (let tier = 0; tier < market.rounds.length; tier += 1) {
      const spot = spots[market.key];
      const w = sellableHalfWidths(market, tier, spot);
      assert.ok(w, `${market.key}/${roundLabel(tier)} has no window`);
      assert.ok(
        w.minHalfWidth1e4 <= w.maxHalfWidth1e4,
        `${market.key}/${roundLabel(tier)} inverted`,
      );

      for (const width of [w.minHalfWidth1e4, w.maxHalfWidth1e4]) {
        const half = (spot * width) / 100_000_000n;
        const q = quoteBand(market, tier, spot, spot - half, spot + half, 10n ** 18n);
        assert.ok(
          q.ok,
          `${market.key}/${roundLabel(tier)} refused its own edge at ${width}: ${
            q.ok ? "" : q.error.kind
          }`,
        );
      }
    }
  }
});

test("round labels read as durations, not as decimals", () => {
  assert.equal(roundLabel(0), "15m");
  assert.equal(roundLabel(1), "60m");
  assert.equal(roundLabel(2), "4h");
  assert.equal(roundLabel(99), "?");
});

test("calibrated markets and display markets stay in step", () => {
  assert.equal(CALIBRATED_MARKETS.length, MARKETS.length);
});
