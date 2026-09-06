import { test } from "node:test";
import assert from "node:assert/strict";
import { reason, transient } from "../src/reason.ts";

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

/**
 * The shape starknet.js v10 actually throws, captured from a real failed send against
 * Sepolia: an `RpcError` whose own `message` is the request, with the explanation nested
 * under `baseError.data.execution_error` behind a stack of contract-address frames.
 */
const realRpcError = () =>
  Object.assign(new Error('RPC: starknet_estimateFee with params {\n  "request": [\n {"sender_address": "0x7"}\n]\n}'), {
    request: {},
    baseError: {
      code: 41,
      message: "Transaction execution error",
      data: {
        transaction_index: 0,
        execution_error:
          "Contract address= 0x788e6, Class hash= 0x5b4b5, Selector= 0x15d40, Nested error: Contract address= 0x788e6, Class hash= 0x5b4b5, Selector= 0x15d40, Nested error: Failed to deserialize param #4",
      },
    },
  });

test("the explanation comes from baseError, not from the request the outer error prints", () => {
  const got = reason(realRpcError());
  assert.equal(got, "Transaction execution error — Failed to deserialize param #4");
  assert.ok(!got.includes("starknet_estimateFee"), "the request must not become the explanation");
  assert.ok(!got.includes("Contract address"), "the call stack is not the reason");
});

test("reducing an already-reduced message leaves it alone", () => {
  // `send` reduces and rethrows as a plain Error, and its caller reduces again. The second
  // pass used to turn a good explanation into "unknown, and the node said nothing readable".
  const once = reason(realRpcError());
  assert.equal(reason(new Error(once)), once);
  assert.equal(reason(new Error("STALE_PRICE")), "STALE_PRICE");
});

test("a long explanation keeps its conclusion, not just its opening", () => {
  // The node's fee refusal puts three gas dictionaries between the subject and the verdict.
  // A head-only truncation kept the dictionaries and dropped "exceed balance".
  const long = Object.assign(new Error("RPC: starknet_estimateFee with params {}"), {
    baseError: {
      code: 55,
      message: "Account validation failed",
      data:
        "Resources bounds ({ l1_gas: { max_amount: 0, max_price_per_unit: 247147482888859 }, " +
        "l2_gas: { max_amount: 2118240, max_price_per_unit: 42477564169 }, " +
        "l1_data_gas: { max_amount: 672, max_price_per_unit: 689932455823 } }) exceed balance (80843186574050224).",
    },
  });
  const got = reason(long);
  assert.ok(got.length <= 220, `too long: ${got.length}`);
  assert.match(got, /^Account validation failed/, "the subject survives");
  assert.match(got, /exceed balance \(80843186574050224\)\.$/, "the verdict survives");
});

/**
 * `transient` decides whether a failure is retried. Getting it wrong in the permissive
 * direction wastes a nonce and three round trips on something that will never succeed.
 */
test("a permanent refusal is not retried because a balance happens to contain 502", () => {
  // The exact message the keeper produced on Sepolia: the digits of the balance end 4050224.
  const real =
    "cannot afford this: the fee alone is 93190680144747648 and the balance is 80843186574050224";
  assert.equal(transient(real), false);
});

test("a real gateway failure still is", () => {
  assert.equal(transient("RPC 502 Bad Gateway"), true);
  assert.equal(transient("upstream returned 503"), true);
  assert.equal(transient("Invalid transaction nonce"), true);
  assert.equal(transient("fetch failed"), true);
});

test("a Cairo revert is never transient", () => {
  assert.equal(transient("STALE_PRICE"), false);
  assert.equal(transient("MARKET_CANNOT_COVER_PAYOUT"), false);
});

test("a plain sentence with a node error hung off it is not mistaken for reduced text", () => {
  // What `bareEstimate` throws when the node refuses to simulate: a readable message, with
  // the reason nested underneath. The early "already reduced" exit used to swallow it whole
  // and report the wrapper, so a market waiting on a stale price read as an unexplained
  // failure.
  const e = new Error("the node would not estimate this") as Error & { baseError?: unknown };
  e.baseError = {
    code: 41,
    message: "Transaction execution error",
    data: { execution_error: "Error message: Execution failed. Failure reason: ('STALE_PRICE')." },
  };
  assert.equal(reason(e), "STALE_PRICE");
});

test("a plain sentence with nothing nested is still returned unchanged", () => {
  assert.equal(
    reason(new Error("cannot afford this: the fee alone is 5 and the balance is 4")),
    "cannot afford this: the fee alone is 5 and the balance is 4",
  );
});
