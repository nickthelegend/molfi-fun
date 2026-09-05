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

test("probInside rejects a spot outside the band", () => {
  assert.throws(() => probInside(NORMAL_TABLE, SPOT, SPOT + 1n, SPOT + 2n, 120_000n));
  assert.throws(() => probInside(NORMAL_TABLE, SPOT, SPOT - 2n, SPOT - 1n, 120_000n));
});

test("validateTable rejects a table that dips or exceeds one", () => {
  const dip = [...NORMAL_TABLE];
  dip[5] = 1n;
  assert.throws(() => validateTable(dip), /TableNotMonotonic/);

  const over = [...NORMAL_TABLE];
  over[16] = 2_000_000n;
  assert.throws(() => validateTable(over), /TableNotMonotonic/);
});
