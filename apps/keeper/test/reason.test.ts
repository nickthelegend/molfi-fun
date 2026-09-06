import { test } from "node:test";
import assert from "node:assert/strict";
import { reason } from "../src/reason.ts";

/**
 * These are the shapes the node actually produced, not invented ones.
 *
 * The bug being pinned here reached the persisted ledger: starknet.js prints the *request*
 * before the failure, that request carries `message`-shaped keys of its own, and taking the
 * first `"message"` in the blob recorded a relay that could not pay its fee as
 * `"invoke_transaction": {`. An operator reading that row learns nothing.
 */
const paramsEcho =
  'RPC: starknet_addInvokeTransaction with params {\n"invoke_transaction": {\n"message": "not the error"\n}\n}';

test("a Cairo revert reduces to the felt it named itself with", () => {
  assert.equal(
    reason(new Error("Transaction reverted: Error in the called contract ('STALE_PRICE')")),
    "STALE_PRICE",
  );
});

test("a validation failure carries the sentence naming the fee and the balance", () => {
  const e = Object.assign(new Error(`${paramsEcho}\n55: Account validation failed`), {
    baseError: {
      code: 55,
      message: "Account validation failed",
      data: "Max fee (12345) exceeds balance (808).",
    },
  });
  assert.equal(reason(e), "Account validation failed — Max fee (12345) exceeds balance (808).");
});

test("the params echo is never mistaken for the failure", () => {
  const e = new Error(
    `${paramsEcho}\n{"code":55,"message":"Account validation failed","data":"insufficient balance"}`,
  );
  const got = reason(e);
  assert.equal(got, "Account validation failed — insufficient balance");
  assert.ok(!got.includes("invoke_transaction"), "the request must not become the explanation");
  assert.ok(!got.includes("not the error"));
});

test("an unreadable failure says so instead of persisting a JSON fragment", () => {
  const got = reason(new Error('{\n"invoke_transaction": {\n}\n}'));
  assert.ok(!/[{}[\]]/.test(got), `still JSON: ${got}`);
  assert.match(got, /unknown/);
});

test("a nonce collision is named", () => {
  assert.match(
    reason(new Error("Invalid transaction nonce. Expected: 41, got: 40")),
    /Invalid transaction nonce/,
  );
});

test("every explanation is one short line", () => {
  const noisy = new Error("a".repeat(900) + "\nline two");
  const got = reason(noisy);
  assert.ok(got.length <= 220, `too long: ${got.length}`);
  assert.ok(!got.includes("\n"));
});
