#!/usr/bin/env node
/**
 * Fill strk20.json from a real deployment, and refuse to fill it from anything else.
 *
 * The submission file is a set of claims a judge will check on chain. Writing an address
 * into it by hand is how one ends up pointing at a contract that was redeployed, or at a
 * transaction on the wrong network — so every field here comes from `deployments/<network>.json`,
 * which the deploy script writes, and every address is verified to hold a contract before it
 * is recorded.
 *
 * Usage: node --experimental-strip-types scripts/fill-submission.mjs --network mainnet
 */

import { readFileSync, writeFileSync } from "node:fs";
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

if (network === "devnet") {
  console.error(
    "Refusing to fill strk20.json from a devnet deployment.\n" +
      "Nobody can verify a local chain, so a submission pointing at one is a submission\n" +
      "that cannot be checked — which is worse than an empty file.",
  );
  process.exit(1);
}

let deployment;
try {
  deployment = JSON.parse(readFileSync(`deployments/${network}.json`, "utf8"));
} catch {
  console.error(
    `No deployments/${network}.json. Deploy first:\n` +
      `  node --experimental-strip-types scripts/deploy.mjs --network ${network}\n`,
  );
  process.exit(1);
}

const RPC = process.env.STARKNET_RPC_URL ?? config.rpcUrl;

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message ?? JSON.stringify(body.error));
  return body.result;
}

let problems = 0;
const ok = (s) => console.log(`  ✓ ${s}`);
const bad = (s) => {
  console.log(`  ✗ ${s}`);
  problems += 1;
};

console.log(`\nfilling strk20.json from deployments/${network}.json\n`);

// ---- the contract has to actually be there --------------------------------------------
try {
  await rpc("starknet_getClassHashAt", ["latest", deployment.market]);
  ok(`market contract is deployed at ${deployment.market}`);
} catch {
  bad(`nothing is deployed at ${deployment.market}`);
}

// ---- every transaction has to have actually succeeded ----------------------------------
//
// A reverted transaction still has a hash, so listing hashes without checking their receipts
// would let a failed run look like a successful one.
const hashes = [
  ...(deployment.transactions ?? []),
  ...(args.tx ? [String(args.tx)] : []),
];

const verified = [];
for (const h of hashes) {
  try {
    const receipt = await rpc("starknet_getTransactionReceipt", [h]);
    const status = receipt.execution_status ?? receipt.status;
    if (status === "SUCCEEDED" || status === "ACCEPTED_ON_L2" || status === "ACCEPTED_ON_L1") {
      verified.push(h);
      ok(`${h.slice(0, 18)}… ${status}`);
    } else {
      bad(`${h.slice(0, 18)}… ${status} — not recorded`);
    }
  } catch (e) {
    bad(`${h.slice(0, 18)}… could not be read: ${e.message.slice(0, 80)}`);
  }
}

if (verified.length < 3) {
  console.log(
    `\n  ! only ${verified.length} verified transaction(s); the submission asks for three.\n` +
      "    Pass more with --tx <hash>, or open, settle and claim a real position first.",
  );
}

const out = {
  transactions: verified,
  contracts: [deployment.market].filter(Boolean),
  demo_video: process.env.DEMO_VIDEO ?? "",
  demo_url: process.env.DEMO_URL ?? "",
};

if (problems > 0) {
  console.log(`\n${problems} problem(s). strk20.json not written.\n`);
  process.exit(1);
}

writeFileSync("strk20.json", JSON.stringify(out, null, 2) + "\n");
console.log(`\nwrote strk20.json\n${JSON.stringify(out, null, 2)}\n`);
if (!out.demo_video) console.log("  ! demo_video is empty — set DEMO_VIDEO once it is recorded.");
if (!out.demo_url) console.log("  ! demo_url is empty — set DEMO_URL once the console is hosted.");
