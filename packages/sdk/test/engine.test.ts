import { test } from "node:test";
import assert from "node:assert/strict";
import { PaperEngine, PaperFeed } from "../src/engine.ts";
import { MARKETS } from "../src/markets.ts";

const BTC = MARKETS.find((m) => m.key === "BTC")!;
const SPOT = 77_300_00000000n;
const TIER = 2; // 100 blocks, ~30s

function midBand(engine: PaperEngine, tier = TIER) {
  const l = engine.limitsFor(BTC, tier, SPOT);
  const half = (l.minHalfWidth1e4 + l.maxHalfWidth1e4) / 2n;
  return {
    low: SPOT - (SPOT * half) / 100_000_000n,
    high: SPOT + (SPOT * half) / 100_000_000n,
  };
}

test("firing opens a ticket and reserves the full payout", () => {
  const e = new PaperEngine();
  const { low, high } = midBand(e);
  const r = e.fire(BTC, SPOT, low, high, 5_000_000n, TIER);
  assert.ok(r.ok, `fire failed: ${JSON.stringify(!r.ok && r.error)}`);
  if (!r.ok) return;

  assert.equal(r.ticket.stake, 5_000_000n);
  assert.equal(e.reserved, r.ticket.payout, "the whole payout is reserved, not the delta");
  assert.equal(e.balance, 250_000_000n - 5_000_000n);
});

test("stake caps match the contract", () => {
  const e = new PaperEngine();
  const { low, high } = midBand(e);
  const under = e.fire(BTC, SPOT, low, high, 500_000n, TIER);
  assert.ok(!under.ok && under.error.kind === "stake");
  const over = e.fire(BTC, SPOT, low, high, 11_000_000n, TIER);
  assert.ok(!over.ok && over.error.kind === "stake");
});

test("a band wider than the floor is refused rather than sold below 1.2x", () => {
  const e = new PaperEngine();
  const l = e.limitsFor(BTC, TIER, SPOT);
  const half = l.maxHalfWidth1e4 * 4n;
  const r = e.fire(
    BTC,
    SPOT,
    SPOT - (SPOT * half) / 100_000_000n,
    SPOT + (SPOT * half) / 100_000_000n,
    2_000_000n,
    TIER,
  );
  assert.ok(!r.ok && r.error.kind === "band-too-wide");
});

test("a band tighter than the round can price is refused", () => {
  const e = new PaperEngine();
  const l = e.limitsFor(BTC, TIER, SPOT);
  const half = l.minHalfWidth1e4 / 8n;
  const r = e.fire(
    BTC,
    SPOT,
    SPOT - (SPOT * half) / 100_000_000n,
    SPOT + (SPOT * half) / 100_000_000n,
    2_000_000n,
    TIER,
  );
  assert.ok(!r.ok && r.error.kind === "band-too-tight");
});

test("the spot must sit inside the band", () => {
  const e = new PaperEngine();
  const r = e.fire(BTC, SPOT, SPOT + 1n, SPOT + 100n, 2_000_000n, TIER);
  assert.ok(!r.ok && r.error.kind === "bad-band");
});

test("a ticket settles at its cutoff block and pays when inside", () => {
  const e = new PaperEngine();
  const { low, high } = midBand(e);
  const r = e.fire(BTC, SPOT, low, high, 5_000_000n, TIER);
  assert.ok(r.ok);
  if (!r.ok) return;

  const before = e.balance;
  for (let i = 0; i < BTC.rounds[TIER].blocks; i++) e.tick(SPOT); // never moves
  assert.equal(r.ticket.status, "won");
  assert.equal(e.balance, before + r.ticket.payout);
  assert.equal(e.reserved, 0n);
});

test("a ticket that ends outside the band burns the stake", () => {
  const e = new PaperEngine();
  const { low, high } = midBand(e);
  const r = e.fire(BTC, SPOT, low, high, 5_000_000n, TIER);
  assert.ok(r.ok);
  if (!r.ok) return;

  const before = e.balance;
  for (let i = 0; i < BTC.rounds[TIER].blocks; i++) e.tick(SPOT * 2n);
  assert.equal(r.ticket.status, "lost");
  assert.equal(e.balance, before);
  assert.equal(e.reserved, 0n);
  assert.equal(e.pnl, -5_000_000n);
});

test("stacking reprices against the blocks actually left", () => {
  const e = new PaperEngine();
  const { low, high } = midBand(e);
  const parent = e.fire(BTC, SPOT, low, high, 2_000_000n, TIER);
  assert.ok(parent.ok);
  if (!parent.ok) return;

  for (let i = 0; i < 10; i++) e.tick(SPOT);

  const child = e.stack(BTC, parent.ticket.id, SPOT, 2_000_000n);
  assert.ok(child.ok, `stack failed: ${JSON.stringify(!child.ok && child.error)}`);
  if (!child.ok) return;

  assert.equal(child.ticket.expiryBlock, parent.ticket.expiryBlock, "same cutoff");
  assert.ok(
    child.ticket.multiplierBps < parent.ticket.multiplierBps,
    "less time left is a better bet, so it must pay less",
  );
});

test("stacking closes once under one round remains", () => {
  const e = new PaperEngine();
  const { low, high } = midBand(e);
  const parent = e.fire(BTC, SPOT, low, high, 2_000_000n, TIER);
  assert.ok(parent.ok);
  if (!parent.ok) return;

  for (let i = 0; i < 95; i++) e.tick(SPOT); // 5 blocks left, under the shortest round
  const r = e.stack(BTC, parent.ticket.id, SPOT, 2_000_000n);
  assert.ok(!r.ok && r.error.kind === "too-late-to-stack");
});

/** A short, fixed slice of real-shaped one-second log returns. */
const RETURNS = [
  0.000012, -0.000031, 0.0, 0.000044, -0.000008, 0.0, 0.0, -0.000052,
  0.000019, 0.000003, -0.000015, 0.0, 0.000061, -0.000027, 0.0, 0.000009,
];

test("the paper feed replays the same series identically from the same offset", () => {
  const a = new PaperFeed(BTC, SPOT, RETURNS, 0);
  const b = new PaperFeed(BTC, SPOT, RETURNS, 0);
  for (let i = 0; i < 50; i++) assert.equal(a.step(), b.step());
});

test("different offsets give different paths, so two desks do not run in lockstep", () => {
  const a = new PaperFeed(BTC, SPOT, RETURNS, 0);
  const b = new PaperFeed(BTC, SPOT, RETURNS, 5);
  let differed = false;
  for (let i = 0; i < 50; i++) {
    if (a.step() !== b.step()) differed = true;
  }
  assert.ok(differed);
});

test("the feed refuses to run without a real return series", () => {
  assert.throws(() => new PaperFeed(BTC, SPOT, [], 0), /real return series/);
  assert.throws(() => new PaperFeed(BTC, SPOT, [0.001], 0), /real return series/);
});

/**
 * Over a whole number of seconds the replayed move must equal the real move — that
 * equality is what makes the desk's win rate match the probability it quotes.
 */
test("replaying N seconds reproduces the real N-second move", () => {
  const feed = new PaperFeed(BTC, SPOT, RETURNS, 0);
  // 9 seconds is exactly 30 blocks at 300ms. Second counts that do not land on a block
  // boundary leave a partial second applied, which is why the check uses one that does.
  const SECONDS = 9;
  const blocks = SECONDS * (1000 / 300);
  for (let i = 0; i < blocks; i++) feed.step();

  const realLogMove = RETURNS.slice(0, SECONDS).reduce((a, b) => a + b, 0);
  const expected = Number(SPOT) * Math.exp(realLogMove);
  const actual = Number(feed.price);

  // Within a basis point of a basis point: the only loss is integer price rounding.
  assert.ok(
    Math.abs(actual - expected) / expected < 1e-6,
    `replayed ${actual} vs real ${expected}`,
  );
});
