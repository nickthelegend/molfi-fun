import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NORMAL_TABLE,
  bandLimits,
  halfProb,
  probInside,
  quote,
  sigmaBps1e4,
  sigmaForBlocks,
  sqrt,
  validateTable,
  zForProb,
} from "../src/pricing.ts";
import { CALIBRATED_MARKETS, ROUND_BLOCKS } from "../src/generated/markets.ts";

const SPOT = 100_000_00000000n;

test("the normal table reproduces textbook values", () => {
  assert.equal(halfProb(NORMAL_TABLE, 10_000n), 682_689n); // 1 sigma
  assert.equal(halfProb(NORMAL_TABLE, 20_000n), 954_500n); // 2 sigma
  assert.equal(halfProb(NORMAL_TABLE, 30_000n), 997_300n); // 3 sigma
});

test("sigma scales with the square root of time", () => {
  assert.equal(sigmaBps1e4(12n, 100n, 100n), 120_000n);
  assert.equal(sigmaBps1e4(12n, 400n, 100n), 240_000n); // 4x blocks, 2x sigma
});

test("integer sqrt matches the Solidity implementation", () => {
  assert.equal(sqrt(0n), 0n);
  assert.equal(sqrt(1n), 1n);
  assert.equal(sqrt(99n), 9n);
  assert.equal(sqrt(100_000_000n), 10_000n);
});

test("a band pinned at spot on one side is priced as a coin flip", () => {
  // The case a "narrower band pays more" width rule gets catastrophically wrong.
  const sig = sigmaBps1e4(12n, 100n, 100n);
  const { multiplierBps, prob1e6 } = quote(NORMAL_TABLE, SPOT, SPOT - 1n, SPOT * 2n, sig, 400n);
  assert.equal(prob1e6, 499_968n);
  assert.equal(multiplierBps, 19_200n); // 1.92x, not 8x
});

test("widening a band never increases the multiplier", () => {
  const sig = sigmaBps1e4(12n, 100n, 100n);
  let prev = 1_000_000n;
  for (let halfBps = 5n; halfBps <= 200n; halfBps += 5n) {
    const half = (SPOT * halfBps) / 10_000n;
    const { multiplierBps } = quote(NORMAL_TABLE, SPOT, SPOT - half, SPOT + half, sig, 400n);
    assert.ok(multiplierBps <= prev, `multiplier rose at ${halfBps}bps`);
    prev = multiplierBps;
  }
});

test("zForProb inverts halfProb", () => {
  for (const p of [125_000n, 400_000n, 682_689n, 800_000n]) {
    const z = zForProb(NORMAL_TABLE, p);
    assert.ok(halfProb(NORMAL_TABLE, z) >= p, `T(z) below target at p=${p}`);
  }
});

test("band limits bracket a sellable window", () => {
  const round = CALIBRATED_MARKETS[0].rounds[2];
  const l = bandLimits(round.probTable, SPOT, round.sigma1e4, 400n, 12_000n, round.minProb1e6);
  assert.ok(l.maxHalfWidth1e4 > l.minHalfWidth1e4);
  assert.ok(l.minHalfWidth1e4 > 0n);
});

test("probInside rejects a spot outside the band", () => {
  assert.throws(() => probInside(NORMAL_TABLE, SPOT, SPOT + 1n, SPOT + 2n, 120_000n));
  assert.throws(() => probInside(NORMAL_TABLE, SPOT, SPOT - 2n, SPOT - 1n, 120_000n));
});

test("every calibrated table is a valid CDF", () => {
  for (const m of CALIBRATED_MARKETS) {
    for (const r of m.rounds) validateTable(r.probTable);
  }
});

test("validateTable rejects a table that dips or exceeds one", () => {
  const dip = [...NORMAL_TABLE];
  dip[5] = 1n;
  assert.throws(() => validateTable(dip), /TableNotMonotonic/);

  const over = [...NORMAL_TABLE];
  over[16] = 2_000_000n;
  assert.throws(() => validateTable(over), /TableNotMonotonic/);
});

test("sigmaForBlocks interpolates between measured rounds and clamps outside them", () => {
  const sigmas = CALIBRATED_MARKETS[0].rounds.map((r) => r.sigma1e4);

  const below = sigmaForBlocks(ROUND_BLOCKS, sigmas, 1);
  assert.equal(below.sigma1e4, sigmas[0]);

  const above = sigmaForBlocks(ROUND_BLOCKS, sigmas, 99_999);
  assert.equal(above.sigma1e4, sigmas[sigmas.length - 1]);

  const mid = sigmaForBlocks(ROUND_BLOCKS, sigmas, 66); // between 33 and 100
  assert.ok(mid.sigma1e4 > sigmas[1] && mid.sigma1e4 < sigmas[2]);
  assert.equal(mid.tableTier, 1, "shape comes from the lower, more conservative round");
});

/**
 * The measured tables have a real point mass at zero — the price often does not move
 * at all over a short round. If the probability floor sat below that mass, a
 * zero-width band would clear every gate and pay several times the stake on an event
 * that happens a quarter of the time. The floor must sit above it, which is what makes
 * the painter's minimum half-width positive.
 */
test("no round can sell a band tighter than the price standing still", () => {
  for (const m of CALIBRATED_MARKETS) {
    m.rounds.forEach((r, tier) => {
      assert.ok(
        r.minProb1e6 > r.probTable[0],
        `${m.key} tier ${tier}: floor ${r.minProb1e6} must exceed point mass ${r.probTable[0]}`,
      );
      const l = bandLimits(r.probTable, SPOT, r.sigma1e4, 400n, 12_000n, r.minProb1e6);
      assert.ok(
        l.minHalfWidth1e4 > 0n,
        `${m.key} tier ${tier}: minimum half-width collapsed to zero`,
      );
      assert.ok(l.maxHalfWidth1e4 > l.minHalfWidth1e4, `${m.key} tier ${tier}: empty band window`);
    });
  }
});

test("the measured short round carries mass a normal cannot", () => {
  // Over three seconds the price often does not move at all. T(0) captures that;
  // a normal is identically zero there and would misprice every tight band.
  const shortRound = CALIBRATED_MARKETS[0].rounds[0];
  assert.equal(halfProb(NORMAL_TABLE, 0n), 0n);
  assert.ok(shortRound.probTable[0] > 100_000n, "measured T(0) should be substantial");
});
