#!/usr/bin/env node
/**
 * Open a real position on a live molfi deployment, from an ordinary account.
 *
 * Not a test. This is the trade itself: pick the market closing soonest, paint a band around
 * the current mark, approve the stake, and call `open_position`. Then read the position back
 * from the chain and print what a block explorer would show — which is a commitment, two
 * width ratios and a stake, and no band.
 *
 * `--claim <commitment>` does the other half once the market has settled, revealing the band
 * for the first time and paying the position back to the address that opened it.
 *
 * Usage:
 *   node --experimental-strip-types scripts/trade.mjs --network sepolia --account ghost_deployer --stake 1
 *   node --experimental-strip-types scripts/trade.mjs --network sepolia --account ghost_deployer --claim 0x…
 *
 * Secrets are written to `positions/<commitment>.json`. That file is the only way to claim;
 * losing it loses the payout, exactly as it would in the browser.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hash, num } from "starknet";
import { commitmentOf, u256Parts } from "../packages/sdk/src/positions.ts";
import { offsetsOf, payoutFor } from "../packages/sdk/src/pricing.ts";
import { NETWORKS } from "../packages/sdk/src/networks.ts";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") === false ? all[i + 1] : true]] : [],
  ),
);

const network = String(args.network ?? "sepolia");
const account = String(args.account ?? "ghost_deployer");
const config = NETWORKS[network];
if (!config) throw new Error(`unknown network ${network}`);

const RPC = process.env.STARKNET_RPC_URL ?? config.rpcUrl;
const say = (s) => process.stdout.write(`${s}\n`);
const hex = (v) => num.toHex(BigInt(v));
const sel = (n) => hash.getSelectorFromName(n);

const deployment = JSON.parse(readFileSync(`deployments/${network}.json`, "utf8"));
const MARKET = deployment.market;
const TOKEN = deployment.token;

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await r.json();
  if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 300));
  return body.result;
}

const call = (to, selector, calldata = []) =>
  rpc("starknet_call", [{ contract_address: to, entry_point_selector: selector, calldata }, "latest"]);

const u256 = (lo, hi) => (BigInt(hi) << 128n) | BigInt(lo);

/**
 * sncast, with the failure reason pulled out.
 *
 * A contract refusal arrives buried three levels of nesting deep in an error string; the
 * short-string name is the only part worth showing, and finding it is the difference between
 * a message someone can act on and a wall of hex.
 */
function sncast(...a) {
  const r = spawnSync("sncast", ["--json", "--account", account, ...a, "--url", RPC], {
    cwd: "cairo",
    encoding: "utf8",
  });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const named = text.match(/'([A-Z0-9_]{4,})'/);
  if (named) throw new Error(`${named[1]} (the contract refused)`);
  for (const line of text.split("\n")) {
    try {
      const o = JSON.parse(line);
      if (o.error) throw new Error(String(o.error).slice(0, 300));
      if (o.transaction_hash) return o;
    } catch (e) {
      if (e instanceof Error && e.message.length && !(e instanceof SyntaxError)) throw e;
    }
  }
  throw new Error(`sncast ${a[0]} did not report a transaction: ${text.trim().slice(-300)}`);
}

const invoke = (to, fn, calldata, label) => {
  const r = sncast("invoke", "--contract-address", to, "--function", fn, "--calldata", ...calldata);
  say(`  ${label} → ${r.transaction_hash}`);
  return r.transaction_hash;
};

/** The address this script trades from. Read from sncast rather than assumed. */
function accountAddress() {
  const r = spawnSync("sncast", ["--json", "account", "list"], { cwd: "cairo", encoding: "utf8" });
  const m = String(r.stdout ?? "").match(
    new RegExp(`"${account}"\\s*:\\s*\\{[^}]*"address"\\s*:\\s*"(0x[0-9a-fA-F]+)"`),
  );
  if (!m) throw new Error(`could not read ${account}'s address from sncast`);
  return m[1];
}

/** Every market on the contract, decoded. */
async function markets() {
  const count = Number(BigInt((await call(MARKET, sel("market_count")))[0]));
  const out = [];
  for (let id = 1; id <= count; id += 1) {
    const r = await call(MARKET, sel("get_market"), [hex(id)]);
    out.push({
      id,
      cutoffAt: Number(BigInt(r[1])),
      roundSeconds: Number(BigInt(r[2])),
      sigma1e4: u256(r[4], r[5]),
      isSettled: BigInt(r[13]) === 1n,
      settledPrice: u256(r[8], r[9]),
      staked: u256(r[14], r[15]),
      bankroll: u256(r[18], r[19]),
      reserved: u256(r[20], r[21]),
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────── claim
if (args.claim) {
  const file = `positions/${String(args.claim).toLowerCase()}.json`;
  const saved = JSON.parse(readFileSync(file, "utf8"));
  say(`\nclaiming ${saved.commitment} on ${network}`);
  say(`  revealing band ${saved.bandLow} – ${saved.bandHigh} for the first time`);
  invoke(
    MARKET,
    "claim_position",
    [hex(saved.marketId), saved.secret, ...u256Parts(BigInt(saved.bandLow)), ...u256Parts(BigInt(saved.bandHigh))],
    "claimed",
  );
  const p = await call(MARKET, sel("get_position"), [saved.commitment]);
  say(`  claimed: ${BigInt(p[8]) === 1n}`);
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────── open
const trader = accountAddress();
say(`\nmolfi · trading on ${network} as ${trader.slice(0, 12)}…`);
say(`  market contract ${MARKET}`);

const all = await markets();

// The chain's clock, not this machine's. `open_position` compares the cutoff against the
// block timestamp, so a market this script thinks has twelve minutes left can be closed
// already — which is exactly what happens on a devnet whose clock has been advanced, and
// what would happen here on any chain running ahead of or behind local time.
const now = (await rpc("starknet_getBlockWithTxHashes", ["latest"])).timestamp;
const open = all.filter((m) => !m.isSettled && m.cutoffAt > now + 60);
if (open.length === 0) {
  console.error("\nNo market is open far enough ahead to trade. The keeper opens the next round each cycle.\n");
  process.exit(1);
}
open.sort((a, b) => a.cutoffAt - b.cutoffAt);
const m = open[0];

/**
 * The mark to paint the band around.
 *
 * From the same route the console uses, so the band is centred on the price a trader would
 * actually have been shown. `--spot` overrides it for a local run, where there is no mark
 * service and the stub oracle is the only price that exists.
 */
const spot = args.spot
  ? BigInt(String(args.spot))
  : await (async () => {
      const base = process.env.MOLFI_URL ?? "https://molfi.fun";
      const j = await fetch(`${base}/api/price?market=${args.pair ?? "BTC"}`).then((r) => r.json());
      if (!j.price) throw new Error(`no mark available: ${JSON.stringify(j).slice(0, 200)}`);
      return BigInt(j.price);
    })();

// One sigma either side: the widest band the desk sells at a multiplier worth having, and
// the same shape the console paints by default.
const half = (spot * m.sigma1e4) / 100_000_000n;
const bandLow = spot - half;
const bandHigh = spot + half;
const [lowOff, highOff] = offsetsOf((bandLow + bandHigh) / 2n, bandLow, bandHigh);

const stake = args.stakeUnits
  ? BigInt(String(args.stakeUnits))
  : BigInt(Math.round(Number(args.stake ?? 1) * 1e18));

const secret = {
  secret: "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(31))).toString("hex"),
  marketId: m.id,
  bandLow,
  bandHigh,
};
const commitment = commitmentOf(secret);

const quoted = await call(MARKET, sel("quote_offsets"), [
  hex(m.id), ...u256Parts(lowOff), ...u256Parts(highOff),
]).then((r) => u256(r[0], r[1]));

say(`\n  market #${m.id}, closes in ${m.cutoffAt - now}s`);
say(`  mark   ${spot}`);
say(`  band   ${bandLow} – ${bandHigh}   (kept off chain until the claim)`);
say(`  reach  ${lowOff} / ${highOff}     (this is what the chain is told)`);
say(`  quote  ${Number(quoted) / 10_000}x  →  ${payoutFor(stake, quoted)} units on ${stake}`);

// Written before the transaction, not after. A file saved on success is a file that does not
// exist if the process dies at the wrong moment, and the position it would have claimed is
// then unreachable by anyone.
mkdirSync("positions", { recursive: true });
writeFileSync(
  `positions/${commitment.toLowerCase()}.json`,
  JSON.stringify(
    {
      note: "This file is the only way to claim this molfi position.",
      network,
      contract: MARKET,
      route: "direct",
      trader,
      marketId: m.id,
      secret: secret.secret,
      bandLow: bandLow.toString(),
      bandHigh: bandHigh.toString(),
      commitment,
      stake: stake.toString(),
      multiplierBps: quoted.toString(),
      openedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);
say(`\n  secret written to positions/${commitment.toLowerCase()}.json`);

say("\nopening");
invoke(TOKEN, "approve", [MARKET, ...u256Parts(stake)], "approved the stake");
invoke(
  MARKET,
  "open_position",
  [hex(m.id), commitment, ...u256Parts(lowOff), ...u256Parts(highOff), ...u256Parts(stake)],
  "opened",
);

const p = await call(MARKET, sel("get_position"), [commitment]);
if (BigInt(p[9]) !== 1n) throw new Error("the chain has no position under that commitment");
const after = (await markets()).find((x) => x.id === m.id);

say("\nwhat the chain now holds");
say(`  commitment    ${commitment}`);
say(`  stake         ${BigInt(p[5])}`);
say(`  multiplier    ${Number(u256(p[6], p[7])) / 10_000}x`);
say(`  reach         ${u256(p[1], p[2])} / ${u256(p[3], p[4])}`);
say(`  owner         ${p[10]}`);
say(`  band          — not stored, and not derivable from any of the above`);
say(`\n  market #${m.id} staked ${after.staked}, reserved ${after.reserved}\n`);
