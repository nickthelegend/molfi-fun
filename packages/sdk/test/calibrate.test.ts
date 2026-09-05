import { test } from "node:test";
import assert from "node:assert/strict";
import { PROB_ONE, TABLE_LEN } from "../src/pricing.ts";
import { buildTable, fitHorizon, returnsOver, stdev } from "../src/calibrate.ts";
import { CALIBRATIONS, HOUSE_EDGE_BPS } from "../src/generated/tables.ts";

/** A deterministic walk, so the fit is checked against something with a known shape. */
function walk(n: number, step: number, seed = 1): number[] {
  let x = 100, s = seed;
  const out: number[] = [x];
  for (let i = 1; i < n; i += 1) {
    s = (s * 1103515245 + 12345) % 2147483648;
    x *= 1 + ((s / 2147483648) - 0.5) * step;
    out.push(x);
  }
  return out;
}

test("returns are measured over the horizon, not between adjacent candles", () => {
  const closes = [100, 110, 121, 133.1];
  // Step of 2 compares 100 to 121 and 110 to 133.1 — one horizon apart, not one candle.
  const r = returnsOver(closes, 2);
  assert.equal(r.length, 2);
  assert.ok(Math.abs(r[0] - Math.log(1.21)) < 1e-9);
});

test("a zero or negative close is skipped rather than producing NaN", () => {
  // One bad tick must not poison an entire fit with a NaN sigma.
  const r = returnsOver([100, 0, 110, -5, 120], 1);
  assert.ok(r.every((x) => Number.isFinite(x)));
});

test("stdev of a constant series is zero, and of one point is zero", () => {
  assert.equal(stdev([5, 5, 5, 5]), 0);
  assert.equal(stdev([5]), 0);
});

test("a built table is a valid CDF", () => {
  const closes = walk(5_000, 0.01);
  const returns = returnsOver(closes, 5);
  const table = buildTable(returns, stdev(returns));
  assert.equal(table.length, TABLE_LEN);
  assert.equal(table[0], 0n);
  for (let i = 1; i < TABLE_LEN; i += 1) {
    assert.ok(table[i] >= table[i - 1], `dips at ${i}`);
    assert.ok(table[i] <= PROB_ONE, `exceeds one at ${i}`);
  }
});

test("the last knot never reads as certainty", () => {
  // Beyond four sigma the contract clamps to the final sample, so a table claiming 100%
  // there would price a wide band as a sure thing when the tail is genuinely fatter.
  const closes = walk(5_000, 0.001);
  const returns = returnsOver(closes, 5);
  const table = buildTable(returns, stdev(returns));
  assert.ok(table[TABLE_LEN - 1] < PROB_ONE);
});

test("a fit refuses tape too short to measure the horizon", () => {
  assert.equal(fitHorizon(walk(50, 0.01), 14_400, "4h"), null);
});

test("a fit holds out the tail and reports both rates", () => {
  const fit = fitHorizon(walk(20_000, 0.01), 300, "5m");
  assert.ok(fit);
  assert.ok(fit!.samples > 0);
  assert.ok(fit!.modelSigma > 0 && fit!.modelSigma < fit!.measuredSigma, "sigma is shaded down");
  assert.ok(fit!.realisedWinRate >= 0 && fit!.realisedWinRate <= 1);
});

test("every shipped calibration is a usable CDF with a positive sigma", () => {
  assert.ok(CALIBRATIONS.length > 0, "tables were generated");
  for (const c of CALIBRATIONS) {
    assert.ok(c.sigma1e4 > 0n, `${c.marketKey}/${c.horizonKey} sigma`);
    assert.equal(c.table.length, TABLE_LEN, `${c.marketKey}/${c.horizonKey} length`);
    assert.equal(c.table[0], 0n);
    for (let i = 1; i < TABLE_LEN; i += 1) {
      assert.ok(c.table[i] >= c.table[i - 1], `${c.marketKey}/${c.horizonKey} dips at ${i}`);
      assert.ok(c.table[i] <= PROB_ONE);
    }
  }
});

test("the fee is the disclosed one", () => {
  assert.equal(HOUSE_EDGE_BPS, 400n);
});
