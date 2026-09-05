#!/usr/bin/env node
/**
 * Everything worth knowing before spending real money, and nothing that spends any.
 *
 * Read-only by construction: it makes no transaction and holds no key. A mainnet deploy is
 * irreversible and costs STRK, and most of the ways it goes wrong are visible beforehand —
 * a pool that is not where the config says, an oracle too thin to settle the pairs about to
 * be listed, a deployer with no balance, a contract too large to declare.
 *
 * Usage: node --experimental-strip-types scripts/preflight.mjs [--network mainnet]
 */

import { readFileSync } from "node:fs";
import { hash } from "starknet";
import { MARKETS, ROUND_SECONDS, decodePrint, freshness, pairId } from "../packages/sdk/src/index.ts";
import { NETWORKS } from "../packages/sdk/src/networks.ts";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") === false ? all[i + 1] : true]] : [],
  ),
);

const network = String(args.network ?? "mainnet");
const config = NETWORKS[network];
if (!config) {
  console.error(`unknown network: ${network}`);
  process.exit(1);
}

const RPC =
  process.env.STARKNET_RPC_URL ??
  (network === "mainnet" ? process.env.MAINNET_RPC : process.env.SEPOLIA_RPC) ??
  config.rpcUrl;

let problems = 0;
let warnings = 0;

const ok = (what, detail = "") => console.log(`  ✓ ${what}${detail ? ` — ${detail}` : ""}`);
const warn = (what, detail = "") => {
  console.log(`  ! ${what}${detail ? ` — ${detail}` : ""}`);
  warnings += 1;
};
const bad = (what, detail = "") => {
  console.log(`  ✗ ${what}${detail ? ` — ${detail}` : ""}`);
  problems += 1;
};

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message ?? JSON.stringify(body.error));
  return body.result;
}

const call = (to, fn, calldata = []) =>
  rpc("starknet_call", [
    { contract_address: to, entry_point_selector: hash.getSelectorFromName(fn), calldata },
    "latest",
  ]);

const u256 = (lo, hi) => (BigInt(hi) << 128n) | BigInt(lo);

console.log(`\nmolfi preflight · ${network}`);
console.log(`  rpc ${RPC.replace(/\/v2\/.*$/, "/v2/…")}\n`);

// ---- the chain ---------------------------------------------------------------------------
console.log("chain");
let head = null;
try {
  const chainId = await rpc("starknet_chainId");
  if (chainId.toLowerCase() === config.chainId.toLowerCase()) {
    ok("the node is on the network we think it is", chainId);
  } else {
    bad("the node is on a DIFFERENT network", `${chainId}, expected ${config.chainId}`);
  }
  head = await rpc("starknet_blockNumber");
  ok("and it is answering", `block ${head}`);
} catch (e) {
  bad("the node could not be reached", e.message.slice(0, 140));
}

// ---- the pool ----------------------------------------------------------------------------
console.log("\nprivacy pool");
if (!config.privacyPool) {
  bad("no pool address is configured");
} else {
  try {
    const cls = await rpc("starknet_getClassHashAt", ["latest", config.privacyPool]);
    ok("the pool is deployed where the config says", `class ${cls.slice(0, 14)}…`);
  } catch (e) {
    bad("nothing is deployed at the pool address", e.message.slice(0, 120));
  }
}

// ---- the token ---------------------------------------------------------------------------
console.log("\nsettlement token");
if (!config.stakeToken) {
  bad("no token address is configured");
} else {
  try {
    await rpc("starknet_getClassHashAt", ["latest", config.stakeToken]);
    ok("STRK is deployed where the config says");
  } catch (e) {
    bad("nothing is deployed at the token address", e.message.slice(0, 120));
  }
}

// ---- the oracle --------------------------------------------------------------------------
//
// The one that actually decides whether this is worth doing. A pair molfi cannot settle is a
// pair molfi must not list, and the failure is not visible until the first settlement.
console.log("\noracle");
if (!config.oracle) {
  bad("no oracle address is configured");
} else {
  for (const m of MARKETS) {
    try {
      const r = await call(config.oracle, "get_data_median", [
        "0x0",
        "0x" + pairId(m.label).toString(16),
      ]);
      const print = decodePrint(r);
      const check = freshness(print);
      const line = `${print.sources} publishers, ${check.ageSeconds}s old`;
      if (!check.fresh) bad(`${m.label} cannot be settled against`, check.reason);
      else if (print.sources < 5) warn(`${m.label} is thin`, line);
      else ok(`${m.label} is settleable`, line);
    } catch (e) {
      bad(`${m.label} could not be read`, e.message.slice(0, 100));
    }
  }
}

// ---- the deployer ------------------------------------------------------------------------
console.log("\ndeployer");
const deployer = process.env.DEPLOYER_ADDRESS;
if (!deployer) {
  warn("DEPLOYER_ADDRESS is not set, so its balance cannot be checked");
} else {
  try {
    await rpc("starknet_getClassHashAt", ["latest", deployer]);
    ok("the account is deployed");
    if (config.stakeToken) {
      const b = await call(config.stakeToken, "balance_of", [deployer]);
      const strk = u256(b[0], b[1]);
      const whole = Number(strk / 10n ** 15n) / 1000;
      // Fees, plus a bankroll for every market about to be listed. A deploy that runs out
      // halfway leaves markets listed and unfunded, which is worse than not starting.
      const listings = MARKETS.length * ROUND_SECONDS.length;
      if (strk === 0n) bad("but it holds no STRK, so it cannot pay a fee");
      else if (whole < 5) warn(`it holds ${whole} STRK`, `${listings} markets to list and fund`);
      else ok(`it holds ${whole} STRK`, `${listings} markets to list and fund`);
    }
  } catch (e) {
    bad("the deployer account is not deployed on this network", e.message.slice(0, 100));
  }
}

// ---- the contract ------------------------------------------------------------------------
console.log("\ncontract");
try {
  const sierra = JSON.parse(
    readFileSync("cairo/target/dev/molfi_MolfiMarket.contract_class.json", "utf8"),
  );
  const felts = sierra.sierra_program.length;
  const LIMIT = 81_290;
  if (felts >= LIMIT) bad("too large to declare", `${felts} felts, limit ${LIMIT}`);
  else ok("small enough to declare", `${felts} felts, ${Math.round((felts / LIMIT) * 100)}% of the limit`);
} catch {
  warn("no build to measure", "run `scarb build` in cairo/ first");
}

if (config.market) {
  try {
    const [count] = await call(config.market, "market_count");
    warn("a molfi market is ALREADY deployed here", `${config.market} with ${BigInt(count)} markets`);
  } catch {
    bad("the configured molfi market address holds no contract", config.market);
  }
} else {
  ok("no molfi contract is deployed here yet", "a deploy would be the first");
}

// ---- verdict -----------------------------------------------------------------------------
console.log("");
if (problems > 0) {
  console.log(`${problems} problem(s) and ${warnings} warning(s). Do not deploy.\n`);
  process.exit(1);
}
console.log(
  warnings > 0
    ? `Clear, with ${warnings} warning(s). Read them before deciding.\n`
    : "Clear.\n",
);
