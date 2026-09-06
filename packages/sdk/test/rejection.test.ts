/**
 * Telling "the user said no" apart from "we don't know what happened".
 *
 * This predicate decides whether molfi deletes a position's secret. Get it wrong in the
 * permissive direction and a dropped connection erases the only key to a stake sitting in
 * the contract — which is exactly what happened before it existed. So the cases wallets
 * actually produce are pinned here rather than trusted to a regex nobody re-reads.
 *
 * Mirrors `isUserRejection` in apps/web/src/lib/pool.ts. Kept here because it is pure and
 * the web app has no test runner of its own.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

/** The predicate under test, kept identical to the console's. */
function isUserRejection(e: unknown): boolean {
  const err = e as { code?: number | string; message?: string; data?: { message?: string } };
  if (err?.code === 113 || String(err?.code) === "113") return true;
  const text = `${err?.message ?? ""} ${err?.data?.message ?? ""}`;
  return /user (abort|reject|denied|cancel)|rejected by user|request rejected|user closed/i.test(text);
}

test("SNIP-9 code 113 is a rejection, as a number or a string", () => {
  assert.equal(isUserRejection({ code: 113 }), true);
  assert.equal(isUserRejection({ code: "113" }), true);
});

test("the wordings wallets actually send are rejections", () => {
  for (const message of [
    "User abort",
    "User rejected request",
    "User denied transaction signature",
    "Request rejected",
    "user cancelled",
    "User closed the window",
  ]) {
    assert.equal(isUserRejection({ message }), true, message);
  }
  assert.equal(isUserRejection({ data: { message: "User abort" } }), true);
});

test("everything else is NOT a rejection, because the transaction may have landed", () => {
  // The permissive direction is the dangerous one. Each of these can occur *after* the
  // wallet has taken the request, so treating any of them as "nothing was sent" would
  // discard a secret for a position that exists on chain.
  for (const e of [
    { message: "Failed to fetch" },
    { message: "The user's network dropped" },
    { message: "timeout of 30000ms exceeded" },
    { message: "Invalid transaction nonce" },
    { message: "reverted: MARKET_CLOSED" },
    { message: "" },
    {},
    null,
    undefined,
  ]) {
    assert.equal(isUserRejection(e), false, JSON.stringify(e));
  }
});

test("a revert that merely mentions a user is not a rejection", () => {
  // "user" appears in plenty of chain errors. Only the rejection phrasings count.
  assert.equal(isUserRejection({ message: "Account validation failed: user balance too low" }), false);
  assert.equal(isUserRejection({ message: "NOT_YOUR_POSITION" }), false);
});
