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
import { offsetsOf } from "../packages/sdk/src/pricing.ts";
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

/** The address this script transacts from, read from sncast rather than assumed. */
function accountAddress() {
  const r = spawnSync("sncast", ["--json", "account", "list"], { cwd: "cairo", encoding: "utf8" });
  const m = String(r.stdout ?? "").match(
    new RegExp(`"${account}"\\s*:\\s*\\{[^}]*"address"\\s*:\\s*"(0x[0-9a-fA-F]+)"`),
  );
  if (!m) throw new Error(`could not read ${account}'s address from sncast`);
  return m[1];
}

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

// ---------------------------------------------------------------- the public route
//
// The other way in, and the one that made molfi tradeable at all. No pool, no shielded
// balance, no wallet that speaks STRK20: an ordinary account approves the stake and calls
// `open_position` with a commitment and two ratios. The band never appears on chain until
// the claim, and this section is what proves that end to end rather than in a harness.
say("\nthe public route");
{
  const trader = accountAddress();
  const [lowOff, highOff] = offsetsOf((bandLow + bandHigh) / 2n, bandLow, bandHigh);
  const pubSecret = {
    secret: "0x0dec1a55ed0dec1a55ed0dec1a55ed0dec1a55ed0dec1a55ed0dec1a55ed",
    marketId: OPEN_MARKET,
    bandLow,
    bandHigh,
  };
  const pubCommitment = commitmentOf(pubSecret);

  // The reach is what the chain is told, and it is the whole of what it is told about the
  // band. Printed here so a reader can see for themselves that the band is not in the call.
  say(`  reach ${lowOff} / ${highOff} (1e8 of the band's midpoint) — the band itself is not sent`);

  const quoted = await call(d.market, sel("quote_offsets"), [
    hex(OPEN_MARKET), ...u256Parts(lowOff), ...u256Parts(highOff),
  ]).then((r) => (BigInt(r[1]) << 128n) | BigInt(r[0]));
  check(quoted > 10_000n, "the contract quotes the reach before anything is committed", `${Number(quoted) / 10_000}x`);

  invoke(d.token, "mint", [trader, ...u256Parts(stake)]);
  invoke(d.token, "approve", [d.market, ...u256Parts(stake)]);
  invoke(d.market, "open_position", [
    hex(OPEN_MARKET), pubCommitment, ...u256Parts(lowOff), ...u256Parts(highOff),
    ...u256Parts(stake),
  ]);

  const p = await call(d.market, sel("get_position"), [pubCommitment]);
  check(BigInt(p[9]) === 1n, "an ordinary account opened a position");
  check(BigInt(p[5]) === stake, "for the stake it actually paid", p[5]);
  const charged = (BigInt(p[7]) << 128n) | BigInt(p[6]);
  check(charged === quoted, "at exactly the multiplier it was quoted", `${Number(charged) / 10_000}x`);
  check(BigInt(p[10]) === BigInt(trader), "bound to the address that opened it");
  check(
    ((BigInt(p[2]) << 128n) | BigInt(p[1])) === lowOff && BigInt(p[3]) !== bandLow,
    "and the chain holds the reach, not the band",
  );

  // Settle the market the public position sits in.
  const m0 = await call(d.market, sel("get_market"), [hex(OPEN_MARKET)]);
  const cutoff2 = Number(BigInt(m0[1]));
  const now2 = await chainNow();
  if (now2 < cutoff2) await rpc("devnet_increaseTime", { time: cutoff2 - now2 + 30 });
  const at2 = await chainNow();
  invoke(d.oracle, "set", [hex(spot), hex(at2 - 60), "0xb"]);
  invoke(d.market, "settle", [hex(OPEN_MARKET)]);

  const before = await call(d.token, sel("balance_of"), [trader]).then(
    (r) => (BigInt(r[1]) << 128n) | BigInt(r[0]),
  );

  // A stranger holding the secret must not be able to take it. Run before the real claim,
  // because afterwards ALREADY_CLAIMED would mask whether the owner check works at all.
  //
  // A different account entirely, so this tests the owner check and not the secret. sncast
  // takes --account before the subcommand, which the shared helper hard-codes, so this one
  // call is spelled out rather than routed through it.
  {
    const r = spawnSync(
      "sncast",
      [
        "--json", "--account", "e2e-stranger", "invoke",
        "--contract-address", d.market, "--function", "claim_position",
        "--calldata", hex(OPEN_MARKET), pubSecret.secret,
        ...u256Parts(bandLow), ...u256Parts(bandHigh),
        "--url", RPC,
      ],
      { cwd: "cairo", encoding: "utf8" },
    );
    const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    check(
      /NOT_YOUR_POSITION/.test(text),
      "a stranger with the secret cannot claim it",
      /NOT_YOUR_POSITION/.test(text) ? "NOT_YOUR_POSITION (contract refused)" : text.slice(-120),
    );
  }

  // Claiming with a band that is not the one that was paid for must be refused. Same reach
  // would be a different attack; this is the cheap-wide-band-claimed-as-narrow one.
  try {
    invoke(d.market, "claim_position", [
      hex(OPEN_MARKET), pubSecret.secret,
      ...u256Parts(spot - half / 8n), ...u256Parts(spot + half / 8n),
    ]);
    check(false, "a band that was not paid for is refused", "it was accepted");
  } catch (e) {
    check(
      /NO_SUCH_POSITION|BAND_DOES_NOT_MATCH/.test(e.message),
      "a band that was not paid for is refused",
      e.message.slice(0, 60),
    );
  }

  invoke(d.market, "claim_position", [
    hex(OPEN_MARKET), pubSecret.secret, ...u256Parts(bandLow), ...u256Parts(bandHigh),
  ]);

  const after = await call(d.token, sel("balance_of"), [trader]).then(
    (r) => (BigInt(r[1]) << 128n) | BigInt(r[0]),
  );
  const won = after - before;
  check(won === (stake * charged) / 10_000n, "the trader was paid the multiplier they bought", won);
  check(won > stake, "which is more than they staked", `${won} > ${stake}`);

  const p2 = await call(d.market, sel("get_position"), [pubCommitment]);
  check(BigInt(p2[8]) === 1n, "and the position is marked claimed");
}

say(failures === 0 ? "\nall checks passed\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
