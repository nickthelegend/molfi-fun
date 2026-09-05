import { test } from "node:test";
import assert from "node:assert/strict";
import { PROB_ONE, TABLE_LEN } from "../src/pricing.ts";
import { buildTable, fitHorizon, returnsOver, stdev } from "../src/calibrate.ts";
import { CALIBRATED_MARKETS, HOUSE_EDGE_BPS } from "../src/generated/markets.ts";
import { roundLabel } from "../src/markets.ts";

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
  assert.ok(CALIBRATED_MARKETS.length > 0, "tables were generated");
  for (const m of CALIBRATED_MARKETS) {
    assert.ok(m.rounds.length > 0, `${m.key} has no rounds`);
    m.rounds.forEach((r, tier) => {
      const where = `${m.key}/${roundLabel(tier)}`;
      assert.ok(r.sigma1e4 > 0n, `${where} sigma`);
      assert.equal(r.probTable.length, TABLE_LEN, `${where} length`);
      assert.equal(r.probTable[0], 0n);
      for (let i = 1; i < TABLE_LEN; i += 1) {
        assert.ok(r.probTable[i] >= r.probTable[i - 1], `${where} dips at ${i}`);
        // No knot may read as certainty: the tail past four sigma is thin, not empty.
        assert.ok(r.probTable[i] < PROB_ONE, `${where} claims certainty at ${i}`);
      }
    });
  }
});

test("sigma grows with the round length on every market", () => {
  // Not by any particular law — measured sigma over four hours is not four times the
  // fifteen minute figure — but it cannot shrink, and a fit that says it does is broken.
  for (const m of CALIBRATED_MARKETS) {
    for (let i = 1; i < m.rounds.length; i += 1) {
      assert.ok(
        m.rounds[i].sigma1e4 > m.rounds[i - 1].sigma1e4,
        `${m.key} sigma does not grow from ${roundLabel(i - 1)} to ${roundLabel(i)}`,
      );
    }
  }
});

test("the fee is the disclosed one", () => {
  assert.equal(HOUSE_EDGE_BPS, 400n);
});
