#!/usr/bin/env node
/**
 * Deploy molfi's market contract, and list its markets.
 *
 * One script for every network, because a devnet run that takes a different path from the
 * mainnet one proves nothing about the mainnet one. What differs is only what it refuses:
 * the stub oracle and stub token exist for local runs and this will not put them on a public
 * chain, and a mainnet run has to be asked for explicitly.
 *
 * Usage:
 *   node scripts/deploy.mjs --network devnet
 *   node scripts/deploy.mjs --network sepolia --account my-account
 *   node scripts/deploy.mjs --network mainnet --account my-account --yes-spend-real-money
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { CALIBRATED_MARKETS, ROUND_SECONDS } from "../packages/sdk/src/generated/markets.ts";
import { NETWORKS, STRK_TOKEN } from "../packages/sdk/src/networks.ts";
import { PRAGMA } from "../packages/sdk/src/pragma.ts";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") === false ? all[i + 1] : true]] : [],
  ),
);

const network = String(args.network ?? "devnet");
const account = String(args.account ?? "devnet0");
const isLocal = network === "devnet";

const RPC = {
  devnet: "http://127.0.0.1:5050",
  sepolia: NETWORKS.sepolia.rpcUrl,
  mainnet: NETWORKS.mainnet.rpcUrl,
}[network];

if (!RPC) {
  console.error(`unknown network: ${network}`);
  process.exit(1);
}

if (network === "mainnet" && args["yes-spend-real-money"] !== true) {
  console.error(
    "Refusing to deploy to mainnet without --yes-spend-real-money.\n" +
      "This spends real STRK on declare, deploy, and every market listed.",
  );
  process.exit(1);
}

/**
 * Run sncast and return its result object.
 *
 * `--json` emits one object per line: build progress on stdout, and the result — or an
 * error — on **stderr**. It also exits 0 on some failures, so neither the exit code nor
 * stdout alone is enough to tell success from failure. Both streams are read, and an
 * `error` field anywhere in them is treated as the failure it is.
 *
 * This is worth the paragraph: reading only stdout made an "already declared" look like a
 * successful declare with an undefined class hash, and the deploy that followed failed
 * three steps later with a message about a malformed felt.
 */
function sncast(...a) {
  const argv = ["--json", "--account", account, ...a, "--url", RPC];
  const r = spawnSync("sncast", argv, { cwd: "cairo", encoding: "utf8" });
  const objects = [
    ...jsonLines(String(r.stdout ?? "")),
    ...jsonLines(String(r.stderr ?? "")),
  ];

  const failed = objects.find((o) => o.error);
  if (failed) {
    const err = new Error(reason(failed.error));
    err.sncast = failed;
    throw err;
  }

  const result = objects.reverse().find((o) => o.command || o.class_hash || o.contract_address);
  if (!result) {
    throw new Error(
      `sncast ${a[0]} returned nothing readable: ${(String(r.stderr ?? "") || String(r.stdout ?? "")).slice(-300)}`,
    );
  }
  return result;
}

/**
 * The one line worth reading out of a Starknet revert.
 *
 * A failed invoke comes back as several hundred characters of nested contract addresses and
 * class hashes wrapped around a single quoted felt — the actual reason. Printing the whole
 * envelope buries it; printing just the felt loses nothing anyone needs.
 */
function reason(error) {
  const text = String(error);
  const named = text.match(/\('([A-Z0-9_]+)'\)/);
  if (named) return `${named[1]} (contract refused)`;
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function jsonLines(text) {
  const out = [];
  for (const line of text.trim().split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* not every line is JSON; skip it */
    }
  }
  return out;
}

const say = (s) => process.stderr.write(`${s}\n`);

/**
 * Declare a class, treating "already declared" as the success it is.
 *
 * Re-running a deploy is normal — a listing loop that fails halfway has to be resumable —
 * and a class hash is content-addressed, so a second declare of identical code is a no-op
 * rather than a conflict.
 */
function declare(contract) {
  try {
    const r = sncast("declare", "--contract-name", contract);
    say(`  declared ${contract} → ${r.class_hash}`);
    return r.class_hash;
  } catch (e) {
    const known = String(e.message).match(/0x[0-9a-fA-F]{40,64}/);
    if (/already declared/i.test(e.message) && known) {
      say(`  ${contract} already declared → ${known[0]}`);
      return known[0];
    }
    throw new Error(`declare ${contract}: ${e.message}`);
  }
}

function deploy(classHash, calldata, label) {
  const r = sncast("deploy", "--class-hash", classHash, ...(calldata.length ? ["--constructor-calldata", ...calldata] : []));
  say(`  deployed ${label} → ${r.contract_address}`);
  return r.contract_address;
}

function invoke(address, entrypoint, calldata, label) {
  const r = sncast(
    "invoke",
    "--contract-address",
    address,
    "--function",
    entrypoint,
    "--calldata",
    ...calldata,
  );
  say(`  ${label} → ${r.transaction_hash}`);
  return r.transaction_hash;
}

const hex = (v) => "0x" + BigInt(v).toString(16);
/** A u256 as the two felts Cairo's calldata expects, low limb first. */
const u256 = (v) => [hex(BigInt(v) & ((1n << 128n) - 1n)), hex(BigInt(v) >> 128n)];
/** A Cairo short string as the felt it encodes. */
const short = (t) => {
  let o = 0n;
  for (const c of t) o = (o << 8n) | BigInt(c.charCodeAt(0));
  return "0x" + o.toString(16);
};

say(`\nmolfi deploy · ${network} · account ${account}`);
say(`  rpc ${RPC}\n`);

// ---- what the market talks to ---------------------------------------------------------
let oracle;
let token;

if (isLocal) {
  // Local only. On a public chain these are the real StarkWare and Pragma contracts and
  // deploying a stand-in for either would be deploying a lie.
  say("devnet: deploying stand-ins for the oracle and the token");
  oracle = deploy(declare("StubOracle"), [], "StubOracle");
  token = deploy(declare("StubToken"), [], "StubToken");

  // A fresh, broad print so the market can actually settle.
  const now = Math.floor(Date.now() / 1000);
  invoke(oracle, "set", [hex(7_970_000_000_000n), hex(now), hex(11)], "seeded the stub oracle");
} else {
  oracle = PRAGMA[network];
  token = STRK_TOKEN;
  say(`  oracle  ${oracle}  (Pragma)`);
  say(`  token   ${token}  (STRK)`);
}

/**
 * Who the market accepts `privacy_invoke` from.
 *
 * On a public network this is the STRK20 pool, and nothing else may drive the contract. On
 * devnet there is no pool, so the deploying account stands in for it — which exercises the
 * open, settle and claim paths for real. What a local run does *not* exercise is the pool's
 * own proof, and that is StarkWare's code rather than molfi's.
 */
const pool = isLocal ? accountAddress() : NETWORKS[network].privacyPool;

function accountAddress() {
  if (process.env.DEVNET_ACCOUNT_ADDRESS) return process.env.DEVNET_ACCOUNT_ADDRESS;
  const r = spawnSync("sncast", ["--json", "account", "list"], {
    cwd: "cairo",
    encoding: "utf8",
  });
  for (const o of jsonLines(String(r.stdout ?? ""))) {
    const found = o?.[account]?.address ?? o?.accounts?.[account]?.address;
    if (found) return found;
  }
  // The listing shape has moved between sncast versions; fall back to the text form rather
  // than failing on a parse.
  const text = String(r.stdout ?? "") + String(r.stderr ?? "");
  const at = text.indexOf(account);
  const m = at >= 0 ? text.slice(at).match(/0x[0-9a-fA-F]{40,64}/) : null;
  return m?.[0];
}

if (!pool) throw new Error("no pool address; set DEVNET_ACCOUNT_ADDRESS for a local run");
say(`  pool    ${pool}\n`);

// ---- the market -----------------------------------------------------------------------
const owner = process.env.DEPLOYER_ADDRESS ?? pool;
const marketClass = declare("MolfiMarket");
const market = deploy(marketClass, [pool, oracle, owner], "MolfiMarket");

// ---- list one market per pair and round ------------------------------------------------
//
// The cutoff is compared against the *chain's* clock, not this machine's. On devnet they
// differ the moment the clock is advanced to test a settlement, and a cutoff computed from
// wall time then lands in the chain's past and is refused as already closed. On a public
// network the sequencer's clock is the one that decides, so reading it is right there too.
const now = await chainNow();

async function chainNow() {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "starknet_getBlockWithTxHashes",
      params: { block_id: "latest" },
    }),
  });
  const body = await res.json();
  const t = body?.result?.timestamp;
  if (typeof t !== "number") throw new Error("could not read the chain's clock");
  return t;
}
const listed = [];

for (const m of CALIBRATED_MARKETS) {
  m.rounds.forEach((round, tier) => {
    const cutoffAt = now + round.seconds;
    const calldata = [
      short(m.label),
      hex(cutoffAt),
      hex(round.seconds),
      token,
      ...u256(round.sigma1e4),
      ...u256(400n),
      // Span<u256>: length, then two felts per knot.
      hex(round.probTable.length),
      ...round.probTable.flatMap((k) => u256(k)),
    ];
    invoke(market, "create_market", calldata, `listed ${m.label} ${ROUND_SECONDS[tier]}s`);
    listed.push({ pair: m.label, seconds: round.seconds, cutoffAt });
  });
}

/**
 * Put the house's money behind each market.
 *
 * Not optional. A market pays winners more than they staked — that is what a multiplier is —
 * so an unfunded market can sell nothing at all: the contract refuses to open a position it
 * cannot already cover, which is the right refusal and a confusing one to hit at demo time.
 */
const bankroll = BigInt(process.env.BANKROLL ?? (isLocal ? "1000000000000" : "0"));
if (bankroll > 0n) {
  say("");
  for (let id = 1; id <= listed.length; id += 1) {
    if (isLocal) {
      // Local only: the stub token can mint. On a public network the funder transfers real
      // tokens to the contract before calling, and this script does not move anyone's money.
      invoke(token, "mint", [market, ...u256(bankroll)], `minted bankroll for market ${id}`);
    }
    invoke(market, "fund_market", [hex(id), ...u256(bankroll)], `funded market ${id}`);
  }
}

// ---- record it -------------------------------------------------------------------------
const out = {
  network,
  deployedAt: new Date().toISOString(),
  classHash: marketClass,
  market,
  oracle,
  token,
  pool,
  owner,
  bankrollPerMarket: bankroll.toString(),
  markets: listed,
};
writeFileSync(`deployments/${network}.json`, JSON.stringify(out, null, 2) + "\n");
say(`\nwrote deployments/${network}.json`);
say(`\n  market ${market}\n`);
