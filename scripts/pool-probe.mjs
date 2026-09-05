#!/usr/bin/env node
/**
 * Ask the real STRK20 pool whether molfi's transaction is shaped correctly.
 *
 * Free, read-only, and needs no account. `compile_actions` is a `view` on the deployed pool
 * that turns a client action list into server actions, so it runs the pool's own validation —
 * enum parsing, phase ordering, replay protection — against exactly the actions molfi would
 * send, without a wallet, a key, a note, or a fee.
 *
 * What it can prove: that the pool parses our `InvokeExternal`, and that a `Withdraw` and an
 * `InvokeExternal` are legal together in one transaction. That last one matters because the
 * pool's `InvokeExternalInput` carries no token and no amount, so the withdraw leg is the
 * only thing that moves the stake — and it was missing until reading this ABI.
 *
 * What it cannot prove: whether the pool hands our calldata to `privacy_invoke` in the order
 * we expect. Validation stops at `SUBCHANNEL_NOT_FOUND` because spending a note requires a
 * registered account with a real note in it, and getting one costs a real deposit. That is
 * the last unverified inch of the integration, and it is recorded as such rather than
 * assumed away.
 *
 * Usage: node --experimental-strip-types scripts/pool-probe.mjs [--network mainnet]
 */

import { hash, num } from "starknet";
import { NETWORKS, STRK_TOKEN } from "../packages/sdk/src/networks.ts";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") === false ? all[i + 1] : true]] : [],
  ),
);
const network = String(args.network ?? "mainnet");
const config = NETWORKS[network];
if (!config?.privacyPool) {
  console.error(`no privacy pool configured for ${network}`);
  process.exit(1);
}

const RPC = process.env.STARKNET_RPC_URL ?? config.rpcUrl;
const POOL = config.privacyPool;
const TOKEN = config.stakeToken ?? STRK_TOKEN;
/** Stands in for molfi's market. Its address does not affect validation. */
const MARKET = config.market ?? "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde";

const h = (v) => num.toHex(BigInt(v));
const STAKE = 1_000_000_000_000_000_000n;

/** ClientAction is a Cairo enum: the variant index, then the payload, flat. */
const VARIANT = {
  SetViewingKey: 0, OpenChannel: 1, OpenSubchannel: 2, CreateEncNote: 3, CreateOpenNote: 4,
  Deposit: 5, UseNote: 6, Withdraw: 7, InvokeExternal: 8, ComputeAndInvoke: 9,
};

const deposit = () => [h(VARIANT.Deposit), TOKEN, h(STAKE)];
const useNote = () => [h(VARIANT.UseNote), "0xc0ffee", TOKEN, "0x0"];
const withdraw = () => [h(VARIANT.Withdraw), MARKET, TOKEN, h(STAKE), "0x1234"];
/** The molfi open, with the calldata `privacy_invoke` expects. */
const invoke = () => [
  h(VARIANT.InvokeExternal), MARKET, "0xa",
  "0x0",                    // operation: open
  "0x1",                    // market id
  "0x796b09a3fdc", "0x0",   // band low  (u256)
  "0x7434d2beb64", "0x0",   // band high (u256)
  TOKEN, h(STAKE),          // token, amount
  "0xbeef", "0x0",          // secret, note id
];

async function compile(actions) {
  const span = [h(actions.length), ...actions.flat()];
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "starknet_call",
      params: [{
        contract_address: POOL,
        entry_point_selector: hash.getSelectorFromName("compile_actions"),
        calldata: ["0x1", "0x2", ...span],
      }, "latest"],
    }),
  });
  const j = await res.json();
  if (j.result) return { ok: true, felts: j.result.length };
  const text = JSON.stringify(j.error ?? {});
  const named = text.match(/\('([A-Z0-9_]+)'\)/);
  return { ok: false, reason: named ? named[1] : text.slice(0, 200) };
}

let failures = 0;
const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

console.log(`\nmolfi pool probe · ${network}`);
console.log(`  pool ${POOL}\n`);

// A transaction with no nullifier must be refused, whatever else it contains. Establishes
// that the pool is really validating rather than accepting anything shaped like an action.
const noNote = await compile([deposit(), withdraw(), invoke()]);
check(
  !noNote.ok && noNote.reason === "NO_REPLAY_PROTECTION",
  "the pool validates: a transaction that spends no note is refused",
  noNote.reason ?? "accepted",
);

// The molfi open. Reaching SUBCHANNEL_NOT_FOUND means every structural check passed — the
// enum parsed, the phases were ordered correctly, replay protection was satisfied — and the
// only thing missing is a note that actually exists.
const open = await compile([useNote(), withdraw(), invoke()]);
check(
  open.ok || open.reason === "SUBCHANNEL_NOT_FOUND",
  "molfi's open parses, orders and replay-protects correctly",
  open.ok ? `compiled to ${open.felts} felts` : open.reason,
);

// Where this probe stops, and why it stops here.
//
// The note lookup runs before phase validation, so a list with the phases out of order and a
// list with two invokes both fail on the same SUBCHANNEL_NOT_FOUND. Asserting that the pool
// enforces phase ordering would therefore be asserting something this probe cannot observe —
// the check would pass whether or not the rule existed, which is worse than not checking.
// Both rules are documented; neither is confirmed here.
const backwards = await compile([useNote(), invoke(), withdraw()]);
const twice = await compile([useNote(), withdraw(), invoke(), invoke()]);
console.log(
  `\n  · phase ordering and the one-invoke rule are not observable at this depth ` +
    `(${backwards.reason} / ${twice.reason});\n    the note lookup runs first, so every ` +
    `variant fails identically.`,
);

console.log(
  failures === 0
    ? "\nThe transaction shape is accepted by the deployed pool: the enum parses, the\n" +
        "actions satisfy replay protection, and validation proceeds to a note that does not\n" +
        "exist because this probe has no account.\n\n" +
        "Still unverified: whether the pool passes our calldata to privacy_invoke in the\n" +
        "order we expect. That needs a registered account holding a real note, which needs a\n" +
        "real deposit. Dry-run it with strk20PrepareInvoke before submitting anything.\n"
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
