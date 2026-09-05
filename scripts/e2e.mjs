#!/usr/bin/env node
/**
 * Drive one position from open to claim against a real deployment.
 *
 * Not a unit test — those exist and run in-process. This runs the actual deployed contract
 * over a real RPC with a real account, which is the only way to catch the things a test
 * harness cannot: a calldata order that is wrong on the wire, a struct read back at the
 * wrong offsets, a commitment the browser derives differently from the chain.
 *
 * Devnet only. The account stands in for the pool locally, so `privacy_invoke` can be driven
 * directly; on a public network only the pool may call it, and this script would be refused.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { commitmentOf, u256Parts } from "../packages/sdk/src/positions.ts";
import { CALIBRATED_MARKETS } from "../packages/sdk/src/generated/markets.ts";

const RPC = process.env.RPC ?? "http://127.0.0.1:5050";
const account = process.env.ACCOUNT ?? "devnet0";
const d = JSON.parse(readFileSync("deployments/devnet.json", "utf8"));

const hex = (v) => "0x" + BigInt(v).toString(16);
const say = (s) => process.stdout.write(`${s}\n`);

function sncast(...a) {
  const r = spawnSync("sncast", ["--json", "--account", account, ...a, "--url", RPC], {
    cwd: "cairo",
    encoding: "utf8",
  });
  const lines = [...String(r.stdout ?? "").split("\n"), ...String(r.stderr ?? "").split("\n")];
  const objects = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    try {
      objects.push(JSON.parse(l));
    } catch {
      /* progress lines */
    }
  }
  const failed = objects.find((o) => o.error);
  if (failed) {
    const named = String(failed.error).match(/\('([A-Z0-9_]+)'\)/);
    throw new Error(named ? `${named[1]} (contract refused)` : String(failed.error).slice(0, 300));
  }
  const result = objects.reverse().find((o) => o.command);
  if (!result) {
    // sncast reports some failures — a malformed felt, a bad flag — as plain text on stderr
    // with no JSON at all. Returning an empty object there made a command that never ran
    // look like one that succeeded, which is how a refusal test passed by not testing
    // anything. Anything unreadable is a failure.
    const text = (String(r.stderr ?? "") || String(r.stdout ?? "")).trim();
    throw new Error(`sncast ${a[0]} did not run: ${text.slice(-300)}`);
  }
  return result;
}

const invoke = (to, fn, calldata) =>
  sncast("invoke", "--contract-address", to, "--function", fn, "--calldata", ...calldata);

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 300));
  return body.result;
}

const chainNow = async () =>
  (await rpc("starknet_getBlockWithTxHashes", { block_id: "latest" })).timestamp;

const call = (to, selector, calldata = []) =>
  rpc("starknet_call", [{ contract_address: to, entry_point_selector: selector, calldata }, "latest"]);

// Selectors, computed the same way the app does.
const { hash } = await import("starknet");
const sel = (n) => hash.getSelectorFromName(n);

let failures = 0;
const check = (ok, what, detail = "") => {
  say(`  ${ok ? "✓" : "✗"} ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

// ---------------------------------------------------------------- pick a market
//
// Devnet state persists between runs and this script advances the clock to settle, so
// market 1 is closed the second time through. Rather than requiring a fresh deploy every
// run, take the first market that is still open — and say so plainly if none are, because
// "everything is closed" and "the contract is broken" look identical from a stack trace.
const MARKET_COUNT = Number(BigInt((await call(d.market, sel("market_count")))[0]));
let MARKET_ID = 0;
let OPEN_MARKET = 0;
{
  const now = await chainNow();
  const open = [];
  for (let id = 1; id <= MARKET_COUNT; id += 1) {
    const m = await call(d.market, sel("get_market"), [hex(id)]);
    if (BigInt(m[13]) === 0n && Number(BigInt(m[1])) > now) {
      open.push({ id, cutoff: Number(BigInt(m[1])) });
    }
  }
  if (open.length === 0) {
    console.error(
      `\nNo market on ${d.market} is still open. Redeploy first: pnpm deploy:devnet\n`,
    );
    process.exit(1);
  }

  // Settle the earliest, and test refusals against one that outlives it.
  open.sort((a, b) => a.cutoff - b.cutoff);
  MARKET_ID = open[0].id;

  /**
   * The refusal tests need a market that is still open *after* the settlement.
   *
   * Settling advances the devnet clock past a cutoff, and a deployment lists every pair with
   * the same cutoff — so the obvious choice, "any other open market", is closed by the time
   * the refusals run and every one of them fails with MARKET_CLOSED instead of the rule
   * under test. The tests looked like contract failures and were a clock problem.
   *
   * So: prefer an existing market with a strictly later cutoff, and list one when there
   * isn't. Listing is owner-only and this script runs as the owner on devnet.
   */
  const later = open.find((m) => m.cutoff > open[0].cutoff);
  if (later) {
    OPEN_MARKET = later.id;
  } else {
    const round = CALIBRATED_MARKETS[0].rounds[0];
    const parts = (v) => u256Parts(BigInt(v));
    const short = (t) => {
      let o = 0n;
      for (const c of t) o = (o << 8n) | BigInt(c.charCodeAt(0));
      return "0x" + o.toString(16);
    };
    // Far enough out that settling the first market cannot close it.
    const cutoffAt = open[0].cutoff + round.seconds * 4;
    invoke(d.market, "create_market", [
      short(CALIBRATED_MARKETS[0].label),
      hex(cutoffAt),
      hex(round.seconds),
      d.token,
      ...parts(round.sigma1e4),
      ...parts(400n),
      hex(round.probTable.length),
      ...round.probTable.flatMap((k) => parts(k)),
    ]);
    OPEN_MARKET = Number(BigInt(await call(d.market, sel("market_count")).then((r) => r[0])));

    // It has to be able to cover what it sells, or the open below is refused for the wrong
    // reason — which is the same class of mistake this whole block exists to remove.
    const bankroll = 1_000_000_000_000n;
    invoke(d.token, "mint", [d.market, ...parts(bankroll)]);
    invoke(d.market, "fund_market", [hex(OPEN_MARKET), ...parts(bankroll)]);
    say(`  listed #${OPEN_MARKET} to test refusals against, cutoff ${cutoffAt}`);
  }
}
const spot = 7_970_000_000_000n; // matches what the stub oracle will print
const half = (spot * 171_077n) / 100_000_000n; // one sigma
const bandLow = spot - half;
const bandHigh = spot + half;
const stake = 1_000_000_000n;

const secret = {
  secret: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
  marketId: MARKET_ID,
  bandLow,
  bandHigh,
};
const commitment = commitmentOf(secret);

say(`\nmolfi end to end · market ${d.market}`);
say(`  settling #${MARKET_ID}, testing refusals against #${OPEN_MARKET}`);
say(`  band ${bandLow} – ${bandHigh}, stake ${stake}`);
say(`  commitment ${commitment}\n`);

say("open");
const [lowLo, lowHi] = u256Parts(bandLow);
const [highLo, highHi] = u256Parts(bandHigh);

// The stake arrives first, as a plain transfer — which is exactly what the pool's withdraw
// leg does in a real transaction. The contract measures what landed rather than believing
// the amount in the calldata, so an open with nothing behind it is refused.
invoke(d.token, "mint", [d.market, ...u256Parts(stake)]);

invoke(d.market, "privacy_invoke", [
  "0x0", // operation: open
  hex(MARKET_ID),
  lowLo,
  lowHi,
  highLo,
  highHi,
  d.token,
  hex(stake),
  secret.secret,
  "0x0", // note id, unused on open
]);

// Position: market_id (u64), band_low (u256), band_high (u256), stake (u128),
// multiplier_bps (u256), claimed, exists. u256 is two felts; u128 is one.
const position = await call(d.market, sel("get_position"), [commitment]);
check(BigInt(position[9]) === 1n, "the chain found the position under the browser's commitment");
check(BigInt(position[5]) === stake, "it recorded the stake", position[5]);
const multiplierBps = (BigInt(position[7]) << 128n) | BigInt(position[6]);
check(multiplierBps > 10_000n, "it fixed a multiplier at open", `${Number(multiplierBps) / 10_000}x`);

// Market: pair, cutoff_at, round_seconds, token, sigma_1e4 (u256), house_edge_bps (u256),
// settled_price (u256), settled_at, settled_block_at, settled_sources, is_settled,
// staked (u256), paid (u256), bankroll (u256), reserved (u256).
let market = await call(d.market, sel("get_market"), [hex(MARKET_ID)]);
check(BigInt(market[14]) === stake, "the market's staked total went up", market[14]);
check(BigInt(market[16]) === 0n, "and nothing has been paid out yet");
const reserved = (BigInt(market[21]) << 128n) | BigInt(market[20]);
check(reserved > stake, "and the whole payout was reserved", reserved);

// ---------------------------------------------------------------- settle
say("\nsettle");
const cutoff = Number(BigInt(market[1]));
const now = await chainNow();
if (now < cutoff) {
  await rpc("devnet_increaseTime", { time: cutoff - now + 30 });
}
const at = await chainNow();
invoke(d.oracle, "set", [hex(spot), hex(at - 60), "0xb"]);
invoke(d.market, "settle", [hex(MARKET_ID)]);

market = await call(d.market, sel("get_market"), [hex(MARKET_ID)]);
check(BigInt(market[13]) === 1n, "the market settled");
const settledPrice = (BigInt(market[9]) << 128n) | BigInt(market[8]);
check(settledPrice === spot, "against the price the oracle published", settledPrice);
check(Number(BigInt(market[11])) >= cutoff, "and not before its cutoff");
check(Number(BigInt(market[12])) === 11, "recording how many publishers stood behind it");

// ---------------------------------------------------------------- claim
say("\nclaim");
invoke(d.market, "privacy_invoke", [
  "0x1", // operation: claim
  hex(MARKET_ID),
  lowLo,
  lowHi,
  highLo,
  highHi,
  d.token,
  "0x0", // nothing withdrawn on a claim
  secret.secret,
  "0xdeadbeef", // note id
]);

const claimed = await call(d.market, sel("get_position"), [commitment]);
check(BigInt(claimed[8]) === 1n, "the position is marked claimed");

// The pool pulls what the helper approved. Modelling only the approve leaves the helper
// still holding every payout it has released, and its balance drifts above its own ledger.
const payoutApproved = (BigInt(claimed[7]) << 128n) | BigInt(claimed[6]);
const owed = (BigInt(claimed[5]) * payoutApproved) / 10_000n;
invoke(d.token, "transfer_from", [d.market, d.pool, ...u256Parts(owed)]);
check(true, "the pool pulled the approved payout", owed);

market = await call(d.market, sel("get_market"), [hex(MARKET_ID)]);
const paid = (BigInt(market[17]) << 128n) | BigInt(market[16]);
const staked = (BigInt(market[15]) << 128n) | BigInt(market[14]);
const bankroll = (BigInt(market[19]) << 128n) | BigInt(market[18]);
check(paid > stake, "the market paid out more than the stake", paid);
check(
  paid <= staked + bankroll,
  "and never more than the stakes plus the bankroll behind it",
  `${paid} <= ${staked} + ${bankroll}`,
);
check(
  ((BigInt(market[21]) << 128n) | BigInt(market[20])) === 0n,
  "and released its reservation",
);

// A second claim must not pay twice.
say("\nrefusals");
try {
  invoke(d.market, "privacy_invoke", [
    "0x1", hex(MARKET_ID), lowLo, lowHi, highLo, highHi, d.token, "0x0", secret.secret, "0xdeadbeef",
  ]);
  check(false, "a second claim was refused", "it was accepted");
} catch (e) {
  check(/ALREADY_CLAIMED/.test(e.message), "a second claim was refused", e.message);
}

// A position backed by nothing must be refused.
//
// Against a market that is still open, so the refusal under test is the stake check rather
// than the closed-market check that would fire first on a settled one.
try {
  invoke(d.market, "privacy_invoke", [
    "0x0", hex(OPEN_MARKET), lowLo, lowHi, highLo, highHi, d.token, hex(stake),
    "0x00feed1", "0x0",
  ]);
  check(false, "a position backed by nothing is refused", "it was accepted");
} catch (e) {
  check(/STAKE_NOT_RECEIVED/.test(e.message), "a position backed by nothing is refused", e.message);
}

// And one that is backed does open, on the same market — so the refusal above is the stake
// check doing its job rather than the market being unusable for some other reason.
try {
  invoke(d.token, "mint", [d.market, ...u256Parts(stake)]);
  invoke(d.market, "privacy_invoke", [
    "0x0", hex(OPEN_MARKET), lowLo, lowHi, highLo, highHi, d.token, hex(stake),
    "0x00feed2", "0x0",
  ]);
  check(true, "and a position that is backed opens on the same market");
} catch (e) {
  check(false, "and a position that is backed opens on the same market", e.message);
}

// A wrong secret must find nothing.
try {
  invoke(d.market, "privacy_invoke", [
    "0x1", hex(MARKET_ID), lowLo, lowHi, highLo, highHi, d.token, "0x0", "0xbadbad", "0xdeadbeef",
  ]);
  check(false, "a wrong secret claims nothing", "it was accepted");
} catch (e) {
  check(/NO_SUCH_POSITION/.test(e.message), "a wrong secret claims nothing", e.message);
}

say(failures === 0 ? "\nall checks passed\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
