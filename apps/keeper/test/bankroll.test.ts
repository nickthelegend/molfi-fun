/**
 * The arithmetic that has taken the desk offline twice.
 *
 * Both incidents were the keeper emptying itself and then refusing to list anything, which is
 * the worst failure this product has: no open market means nobody can trade, and the health
 * endpoint reported a process that was running perfectly well. Neither incident was caught by
 * a test because this arithmetic lived inline in the cycle and could not be called without
 * starting a server.
 *
 * These are the two shapes it failed in, written as tests so it cannot fail in them again.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { affordableCount, bankrollFor } from "../src/bankroll.ts";

const STRK = (n: number) => BigInt(Math.round(n * 1e18));
const FLOOR = STRK(15);
const CEILING = STRK(20);

test("a flat amount per market is what emptied the keeper the first time", () => {
  // Nine markets at the ceiling is 180 STRK. The keeper held 143, so a constant would have
  // committed to more than it had and stopped only when a transfer failed — which is what
  // happened. The share caps it at what is actually spendable.
  const per = bankrollFor(STRK(143), 9, FLOOR, CEILING);
  assert.ok(per < CEILING, "the ceiling must not apply when it cannot be afforded");
  assert.equal(per * 9n <= STRK(143) - FLOOR, true, "nine of them fit above the floor");
});

test("the total spent never crosses the floor", () => {
  // The second drain: a share is not a budget. Funding every market at its share spends the
  // whole spendable amount, and any drift takes it past the floor. The count has to be
  // derived from the same balance and floor, and this is that check.
  for (const [bal, n] of [[143, 9], [94, 13], [50, 4], [16, 1], [15.5, 3]] as const) {
    const per = bankrollFor(STRK(bal), n, FLOOR, CEILING);
    const count = affordableCount(STRK(bal), per, FLOOR);
    const spent = per * BigInt(count);
    assert.ok(
      STRK(bal) - spent >= FLOOR,
      `balance ${bal} over ${n} markets: spending ${spent} would leave less than the floor`,
    );
  }
});

test("below the floor nothing is spendable, so nothing is listed", () => {
  // The keeper sat at 12.4 STRK against a 15 floor for hours and correctly listed nothing.
  // Zero here is the signal the caller turns into "do not list" — a desk that is short is a
  // real state, and pretending otherwise is what sells positions that cannot be paid.
  assert.equal(bankrollFor(STRK(12.4), 9, FLOOR, CEILING), 0n);
  assert.equal(affordableCount(STRK(12.4), STRK(1), FLOOR), 0);
});

test("the ceiling still applies when there is plenty", () => {
  // A rich keeper should not put its whole balance behind four markets.
  const per = bankrollFor(STRK(10_000), 4, FLOOR, CEILING);
  assert.equal(per, CEILING, "capped at the ceiling");
});

test("zero markets asks for nothing, and cannot divide by zero", () => {
  assert.equal(bankrollFor(STRK(100), 0, FLOOR, CEILING), 0n);
  assert.equal(affordableCount(STRK(100), 0n, FLOOR), 0);
});

test("an exactly-at-the-floor balance spends nothing", () => {
  // Boundary: `>` not `>=` here decides whether a keeper sitting exactly on its floor spends
  // its last usable STRK. It must not.
  assert.equal(bankrollFor(FLOOR, 3, FLOOR, CEILING), 0n);
});
