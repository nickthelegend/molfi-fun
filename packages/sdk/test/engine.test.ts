/**
 * A paper position settles against its own market, or it does not settle.
 *
 * The desk lets you change market with a position still riding, and `tick` used to be handed
 * one price for the whole book — whichever market was on screen. A STRK band left open while
 * the desk showed BTC was then settled against a number near eighty thousand: outside the
 * band by six orders of magnitude, recorded as a real loss on the tape, with a settled price
 * printed next to it that had nothing to do with STRK.
 *
 * These pin the two halves of the fix: the right price is used when it is available, and
 * nothing is settled when it is not.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MARKETS } from "../src/markets.ts";
import { PaperEngine } from "../src/engine.ts";

const strk = MARKETS.find((m) => m.key === "STRK")!;
const btc = MARKETS.find((m) => m.key === "BTC")!;

/**
 * A band the market will actually sell, for a given market's volatility.
 *
 * Reach is measured in sigmas, and sigma differs per market — ±0.5% is a fine band on STRK
 * and far too wide on BTC, where it quotes under the 1.05x floor and is refused.
 */
function bandAround(spot: bigint, perTenThousand: bigint) {
  const half = (spot * perTenThousand) / 10_000n;
  return [spot - half, spot + half] as const;
}
const STRK_HALF = 50n; // ±0.50%
const BTC_HALF = 15n; // ±0.15%

test("a position settles against the price of the market it was opened on", () => {
  const e = new PaperEngine();
  const spot = 3_000_000n; // STRK, 8dp-ish paper units
  const [low, high] = bandAround(spot, STRK_HALF);
  const r = e.fire(strk, spot, low, high, 1_000_000n, 0);
  assert.equal(r.ok, true, "the desk should sell this band");

  e.now = e.openTickets[0].expiresAt;
  // The desk has been switched to BTC, so both prices are on hand.
  const settled = e.tick({ STRK: spot, BTC: 7_900_000_000_000n }, 0);

  assert.equal(settled.length, 1);
  assert.equal(settled[0].marketKey, "STRK");
  assert.equal(settled[0].settledPrice, spot);
  assert.equal(settled[0].status, "won", "the STRK price is inside the STRK band");
});

test("a market with no price on hand settles nothing, rather than settling wrongly", () => {
  const e = new PaperEngine();
  const spot = 3_000_000n;
  const [low, high] = bandAround(spot, STRK_HALF);
  e.fire(strk, spot, low, high, 1_000_000n, 0);

  e.now = e.openTickets[0].expiresAt;
  const settled = e.tick({ BTC: 7_900_000_000_000n }, 0);

  assert.equal(settled.length, 0, "no STRK price was supplied");
  assert.equal(e.openTickets.length, 1, "the position waits rather than losing");
  assert.equal(e.openTickets[0].settledPrice, null);
});

test("two markets due on the same tick each get their own price", () => {
  const e = new PaperEngine();
  const s1 = 3_000_000n;
  const s2 = 7_900_000_000_000n;
  const [l1, h1] = bandAround(s1, STRK_HALF);
  const [l2, h2] = bandAround(s2, BTC_HALF);
  assert.equal(e.fire(strk, s1, l1, h1, 1_000_000n, 0).ok, true);
  assert.equal(e.fire(btc, s2, l2, h2, 1_000_000n, 0).ok, true);

  e.now = Math.max(...e.openTickets.map((t) => t.expiresAt));
  const settled = e.tick({ STRK: s1, BTC: s2 }, 0);

  assert.equal(settled.length, 2);
  for (const t of settled) {
    assert.equal(t.status, "won", `${t.marketKey} settled inside its own band`);
    assert.equal(t.settledPrice, t.marketKey === "STRK" ? s1 : s2);
  }
});

test("a single price still settles everything, so the old call shape keeps working", () => {
  const e = new PaperEngine();
  const spot = 3_000_000n;
  const [low, high] = bandAround(spot, STRK_HALF);
  e.fire(strk, spot, low, high, 1_000_000n, 0);
  e.now = e.openTickets[0].expiresAt;
  assert.equal(e.tick(spot, 0).length, 1);
});

test("a top-up moves the balance and leaves the tape alone", () => {
  const e = new PaperEngine();
  const spot = 3_000_000n;
  const [low, high] = bandAround(spot, STRK_HALF);
  e.fire(strk, spot, low, high, 1_000_000n, 0);
  const before = e.balance;
  const open = e.openTickets.length;

  e.topUp(50_000_000n);
  assert.equal(e.balance, before + 50_000_000n);
  assert.equal(e.openTickets.length, open, "a top-up is not a reset");

  e.topUp(-5n);
  assert.equal(e.balance, before + 50_000_000n, "a negative top-up is not a withdrawal");
});
