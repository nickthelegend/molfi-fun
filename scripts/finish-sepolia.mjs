#!/usr/bin/env node
/**
 * Put the two finished-but-undeployed contract features on Sepolia, in one command.
 *
 * `privacy_invoke` on the direction game and `defund_market` on the range market are written,
 * tested and shipped — dormant behind probes that read the deployed class and correctly find
 * neither. The only thing between them and being live is a declare each, and a declare pays
 * for the whole Sierra program: about 62 STRK apiece on Sepolia today.
 *
 * That is the whole of it. There is no code left to write, which is why this exists as a
 * script rather than a checklist: funding arrives, this runs, both features are live. It is
 * idempotent — it reads what is deployed before it spends anything, and a second run against a
 * finished chain does nothing but say so.
 *
 * Usage:
 *   node --experimental-strip-types scripts/finish-sepolia.mjs --check     # spend nothing, report
 *   node --experimental-strip-types scripts/finish-sepolia.mjs             # do it
 *   node --experimental-strip-types scripts/finish-sepolia.mjs --only updown
 */

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { chain, declareCost, say } from "./lib/chain.mjs";
import { NETWORKS, STRK_TOKEN } from "../packages/sdk/src/networks.ts";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") === false ? all[i + 1] : true]] : [],
  ),
);

const account = String(args.account ?? "ghost_deployer");
const only = args.only ? String(args.only) : null;
const checkOnly = args.check === true;
const RPC = process.env.STARKNET_RPC_URL ?? process.env.SEPOLIA_RPC ?? NETWORKS.sepolia.rpcUrl;
const RECORD = "deployments/sepolia.json";

const { rpcCall, declare, deploy, transactions, accountAddress } = chain({ account, rpc: RPC });

/**
 * What each contract is for, what proves it is already done, and what its constructor wants.
 *
 * The constructor argument *order* differs between the two and always has — `UpDownMarket`
 * takes (owner, oracle, pool) and `MolfiMarket` takes (pool, oracle, owner). Both are three
 * addresses, so getting it wrong deploys cleanly and produces a contract whose owner is the
 * privacy pool: every listing refused with CALLER_NOT_OWNER, and nothing anywhere says why.
 * They are written out per contract rather than shared for exactly that reason.
 */
const JOBS = [
  {
    key: "updown",
    contract: "UpDownMarket",
    /** The entrypoint that proves the deployed class is the new one. */
    proves: "privacy_invoke",
    gives: "the direction game's pool route — betting a side without revealing size or identity",
    addressField: "upDownMarket",
    classField: "upDownClassHash",
    record: "MOLFI_UPDOWN",
    calldata: (d) => [d.owner, d.oracle, d.pool],
    sierra: "cairo/target/dev/molfi_UpDownMarket.contract_class.json",
  },
  {
    key: "market",
    contract: "MolfiMarket",
    proves: "defund_market",
    gives: "the keeper's sweep — bankroll returning from settled markets instead of being spent for ever",
    addressField: "market",
    classField: "classHash",
    record: "MOLFI_MARKET",
    calldata: (d) => [d.pool, d.oracle, d.owner],
    sierra: "cairo/target/dev/molfi_MolfiMarket.contract_class.json",
  },
].filter((j) => !only || j.key === only);

const deployed = JSON.parse(readFileSync(RECORD, "utf8"));

/** Does the class *actually on chain* at this address carry this entrypoint? */
async function hasEntrypoint(address, name) {
  try {
    const cls = await rpcCall("starknet_getClassAt", ["latest", address]);
    const abi = typeof cls.abi === "string" ? JSON.parse(cls.abi) : cls.abi;
    const found = (items) =>
      (items ?? []).some(
        (it) => (it.type === "function" && it.name === name) || (it.items && found(it.items)),
      );
    return found(abi);
  } catch (e) {
    say(`  ! could not read the class at ${address}: ${e.message}`);
    return false;
  }
}

async function balance(address) {
  const r = await rpcCall("starknet_call", [
    {
      contract_address: STRK_TOKEN,
      // balanceOf
      entry_point_selector: "0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e",
      calldata: [address],
    },
    "latest",
  ]);
  return (BigInt(r[1]) << 128n) | BigInt(r[0]);
}

const strk = (v) => `${(Number(v / 10n ** 12n) / 1e6).toFixed(3)} STRK`;

say(`\nmolfi · finishing sepolia · account ${account}`);
say(`  rpc ${RPC}\n`);

const signer = accountAddress();
if (!signer) throw new Error(`sncast does not know an account called ${account}`);
const have = await balance(signer);
say(`  ${signer}`);
say(`  holding ${strk(have)}\n`);

// ---- what is already done ---------------------------------------------------------------
//
// Read from the chain, not from the record file. The file says what a script believed; the
// chain says what happened, and after a run that died halfway only one of those is true.
const todo = [];
for (const job of JOBS) {
  const address = deployed[job.addressField];
  const live = address ? await hasEntrypoint(address, job.proves) : false;
  if (live) {
    say(`  ✓ ${job.contract} at ${address.slice(0, 14)}… already carries ${job.proves}`);
  } else {
    say(`  · ${job.contract} needs a declare — ${job.gives}`);
    todo.push(job);
  }
}

if (todo.length === 0) {
  say(`\n  Nothing to do: both classes are live. Re-checking the product anyway.\n`);
  verify();
  process.exit(0);
}

if (checkOnly) {
  say("");
  let needed = 0n;
  const costs = [];
  for (const job of todo) {
    const { felts, fri } = await declareCost(job.sierra, rpcCall);
    needed += fri;
    costs.push({ job, fri });
    say(`  ${job.contract}: ${felts} felts, declare costs about ${strk(fri)}`);
  }

  /**
   * The two are independent, and the cheaper one is the one the sprint is about.
   *
   * `privacy_invoke` is the privacy claim for the direction game; `defund_market` is the
   * desk's economics. Presenting them as a single 113 STRK bill hides that 44 buys the first
   * of them outright — which matters when the money arrives 5 STRK a day.
   */
  const cheapest = costs.slice().sort((a, b) => (a.fri < b.fri ? -1 : 1))[0];
  if (costs.length > 1 && cheapest) {
    say(
      `\n  They are independent: --only ${cheapest.job.key} deploys ${cheapest.job.contract} alone` +
        ` for ${strk(cheapest.fri)}.`,
    );
  }
  // The deploy that follows each declare, and the fee on it, are small beside the declare —
  // but "about enough" is how a run dies between the two, having spent the expensive half.
  const margin = needed / 10n;
  say(
    have >= needed + margin
      ? `\n  ${strk(have)} against ${strk(needed)} needed. Enough — run it without --check.\n`
      : `\n  ${strk(have)} against ${strk(needed + margin)} needed (10% margin). Short by ${strk(needed + margin - have)}.\n`,
  );
  /**
   * Ask for more than the declares cost, because the declares are not the last thing to happen.
   *
   * A keeper that spends its final STRK on a declare comes back up below its own floor, lists
   * nothing, and the product is down at the exact moment its two new features go live. The
   * shortfall figure above is the declare bill; this is the number to actually send.
   */
  if (have < needed + margin) {
    say(`  Send ${strk(needed + margin + 40n * 10n ** 18n)} or so: the bill above, plus enough left`);
    say(`  over that the desk is still above its floor once the declares are paid.\n`);
  }
  process.exit(0);
}

/**
 * What redeploying costs beyond the fee, said out loud before it is paid.
 *
 * A new contract starts empty. The bankroll behind the old one does not follow it, and on the
 * class deployed today there is no way to call it back — which is the very hole `defund_market`
 * closes and cannot close retroactively. It is testnet STRK and the trade is worth making, but
 * it is a real consequence and a script that performs it silently is lying by omission.
 */
say("");
for (const job of todo) {
  const address = deployed[job.addressField];
  if (!address) continue;
  const stranded = await balance(address).catch(() => 0n);
  if (stranded > 0n) {
    say(`  ! ${strk(stranded)} sits in the current ${job.contract} at ${address.slice(0, 14)}…`);
    say(`    A redeploy leaves it there. Open positions on it stay claimable at that address;`);
    say(`    the console will be pointed at the new one.`);
  }
}

// ---- declare, deploy, record --------------------------------------------------------------
const done = [];
for (const job of todo) {
  say(`\n${job.contract}`);
  const classHash = await declare(job.contract);
  const address = await deploy(
    classHash,
    job.calldata({ owner: deployed.owner, oracle: deployed.oracle, pool: deployed.pool }),
    job.contract,
  );
  done.push({ job, classHash, address });

  // Written after every contract rather than at the end: a run that dies on the second declare
  // must not lose the first deploy, or the next run pays for it again.
  const supersedes = deployed[`supersedes_${job.key}`] ?? [];
  Object.assign(deployed, {
    [job.classField]: classHash,
    [job.addressField]: address,
    [`supersedes_${job.key}`]: [
      ...supersedes,
      {
        classHash: deployed[job.classField],
        address: deployed[job.addressField],
        supersededAt: new Date().toISOString(),
        note: `replaced by a class carrying ${job.proves}`,
      },
    ],
    transactions: [...(deployed.transactions ?? []), ...transactions.map((t) => t.hash)],
    transactionLog: [...(deployed.transactionLog ?? []), ...transactions],
  });
  writeFileSync(RECORD, JSON.stringify(deployed, null, 2) + "\n");
  say(`  recorded in ${RECORD}`);
}

// ---- point the SDK at them ----------------------------------------------------------------
//
// `packages/sdk/src/networks.ts` is what the console, the API routes and the verifier all read.
// Leaving it to a hand edit means a deploy that succeeds completely and changes nothing anyone
// can see — a new contract on chain and an old one in the browser, which looks like a caching
// problem rather than a missed step.
const FILE = "packages/sdk/src/networks.ts";
let source = readFileSync(FILE, "utf8");
for (const { job, address } of done) {
  // Scoped to the record, not the whole file: `sepolia:` also appears in CHAIN_IDS and in
  // NETWORKS, and a file-wide replace rewrote the chain id — a deployment that then fails
  // every wallet check for a reason nothing points at.
  const open = source.indexOf(`export const ${job.record}`);
  const close = open >= 0 ? source.indexOf("\n};", open) : -1;
  const line = /(\n  sepolia: )(?:"0x[0-9a-fA-F]+"|null)(,)/;
  if (open < 0 || close < 0 || !line.test(source.slice(open, close))) {
    say(`  ! could not find ${job.record}.sepolia in ${FILE}; set it to ${address} by hand`);
    continue;
  }
  source = source.slice(0, open) + source.slice(open, close).replace(line, `$1"${address}"$2`) + source.slice(close);
  say(`  ${job.record}.sepolia → ${address}`);
}
writeFileSync(FILE, source);

// ---- and say what a machine cannot do -----------------------------------------------------
say(`\n  Done on chain. Three things left, none of them here:\n`);
say(`  1. Railway (service "keeper") — point it at the new contracts and release the reserve:`);
for (const { job, address } of done) say(`       ${job.record}=${address}`);
say(`       KEEPER_RESERVE=0`);
say(`     Until the reserve is cleared the desk holds its balance and lists nothing.`);
say(`  2. Commit ${FILE} and ${RECORD}, then redeploy the console so the browser follows.`);
say(`  3. The new market starts with no markets and no bankroll. The keeper lists and funds`);
say(`     them on its next cycle once step 1 lands — watch /api/keeper, not the clock.\n`);

verify();

function verify() {
  const r = spawnSync("node", ["--experimental-strip-types", "scripts/verify.mjs"], {
    stdio: "inherit",
  });
  process.exitCode = r.status ?? 0;
}
