import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HAIRCUT,
  QUIET_PERCENTILE,
  ROUND_SAFETY,
  fitSigma,
  quietSigma,
  remarkSigmas1e4,
} from "../src/remark.ts";
import { ROUND_BLOCKS, sigmaOver, tierSeconds } from "../src/termstructure.ts";

/**
 * A deterministic tape with a deliberate regime change: a calm first half and a
 * violent second half. The estimator's whole job is to come back closer to the calm
 * half than to the average, because that is the side the vault is exposed on.
 */
function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648 - 0.5;
  };
}

/** A price series, which is what sigmaOver reads — not a series of returns. */
function walk(n: number, seed: number, volAt: (i: number) => number): number[] {
  const next = lcg(seed);
  const closes: number[] = [];
  let px = 100_000;
  for (let i = 0; i < n; i++) {
    px *= Math.exp(next() * volAt(i));
    closes.push(px);
  }
  return closes;
}

function twoRegimeTape(n: number): number[] {
  return walk(n, 42, (i) => (i > n / 2 ? 40e-5 : 4e-5));
}

test("the sigma estimate sits at the quiet end, not the middle", () => {
  const tape = twoRegimeTape(12_000);
  const seconds = 30;
  const sub = Math.max(600, seconds * 10);

  // Every sub-window's realised sigma, the population the estimator draws from.
  const observed: number[] = [];
  const stride = Math.max(1, Math.floor(sub / 4));
  for (let s = 0; s + sub <= tape.length; s += stride) {
    const v = sigmaOver(tape.slice(s, s + sub), seconds);
    if (v > 0) observed.push(v);
  }
  observed.sort((a, b) => a - b);
  const median = observed[Math.floor(observed.length / 2)];

  const fitted = quietSigma(tape, seconds, sub);

  assert.ok(observed.length > 4, "needs a population to reason about");
  assert.ok(
    fitted < median,
    `estimate ${fitted} must sit below the median ${median} — pricing off the middle ` +
      `loses the one-sided guarantee`,
  );
  // And it must not collapse onto the single quietest window either.
  assert.ok(fitted >= observed[0] * HAIRCUT, "must not undercut the quietest window seen");
});

test("the haircut is actually applied", () => {
  const tape = twoRegimeTape(8_000);
  const seconds = 30;
  const sub = Math.max(600, seconds * 10);

  const observed: number[] = [];
  const stride = Math.max(1, Math.floor(sub / 4));
  for (let s = 0; s + sub <= tape.length; s += stride) {
    const v = sigmaOver(tape.slice(s, s + sub), seconds);
    if (v > 0) observed.push(v);
  }
  observed.sort((a, b) => a - b);
  const raw = observed[Math.min(observed.length - 1, Math.floor(QUIET_PERCENTILE * observed.length))];

  assert.ok(Math.abs(quietSigma(tape, seconds, sub) - raw * HAIRCUT) < 1e-12);
});

test("the short round is shaded harder than the long ones", () => {
  assert.equal(ROUND_SAFETY.length, ROUND_BLOCKS.length);
  assert.ok(ROUND_SAFETY[0] < ROUND_SAFETY[ROUND_SAFETY.length - 1]);
  for (const s of ROUND_SAFETY) assert.ok(s > 0 && s <= 1, "shading only ever reduces sigma");
});

test("remarkSigmas1e4 returns one positive integer per round, shaded", () => {
  const tape = twoRegimeTape(20_000);
  const out = remarkSigmas1e4(tape);

  assert.equal(out.length, ROUND_BLOCKS.length);
  for (const v of out) {
    assert.ok(Number.isInteger(v) && v >= 1, "the contract stores a positive integer");
  }
  // Each is the shaded fit, not the raw one.
  ROUND_BLOCKS.forEach((b, i) => {
    const raw = fitSigma(tape, tierSeconds(b));
    assert.ok(
      out[i] <= Math.round(raw * 1e8),
      "a published sigma must never exceed the unshaded fit",
    );
  });
});


test("a longer round carries more volatility than a shorter one", () => {
  /**
   * Asserted on a single-regime tape on purpose. Across a regime change the quiet-end
   * estimator can read a long horizon as calmer than a short one — the long windows
   * straddle both regimes while the short ones can sit entirely inside the calm half —
   * and that is the estimator behaving correctly, not a monotonicity violation.
   */
  const tape = walk(30_000, 7, () => 12e-5);

  const raw = ROUND_BLOCKS.map((b) => fitSigma(tape, tierSeconds(b)));
  for (let i = 1; i < raw.length; i++) {
    assert.ok(raw[i] > raw[i - 1], `round ${i} must carry more sigma than round ${i - 1}`);
  }
});
