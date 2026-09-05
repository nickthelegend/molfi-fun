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

/**
 * The endpoint to deploy through.
 *
 * `STARKNET_RPC_URL` wins where it is set. A deploy is a long sequence of writes and the
 * public endpoints drop requests under load — losing one halfway leaves markets listed and
 * unfunded, which is worse than not starting.
 */
const RPC =
  process.env.STARKNET_RPC_URL ??
  (network === "mainnet" ? process.env.MAINNET_RPC : undefined) ??
  (network === "sepolia" ? process.env.SEPOLIA_RPC : undefined) ??
  {
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
/**
 * Transient, or the chain's answer?
 *
 * A dropped connection is not an answer and retrying it costs a few seconds. A revert is an
 * answer, and retrying it burns a fee to be told the same thing. The difference matters most
 * here, where a deploy is a long sequence of writes and losing one halfway leaves markets
 * listed and unfunded.
 */
function transient(text) {
  return /error sending request|Failed to fetch|timed out|connection|502|503|504|reset by peer|decoding response|Unknown RPC error|EOF|Gateway|rate.?limit|too many requests/i.test(
    text,
  );
}

function sncast(...a) {
  return sncastOnce(a, 0);
}

function sncastOnce(a, attempt) {
  const argv = ["--json", "--account", account, ...a, "--url", RPC];
  const r = spawnSync("sncast", argv, { cwd: "cairo", encoding: "utf8" });
  const objects = [
    ...jsonLines(String(r.stdout ?? "")),
    ...jsonLines(String(r.stderr ?? "")),
  ];

  const failed = objects.find((o) => o.error);
  if (failed) {
    if (transient(String(failed.error)) && attempt < 4) {
      say(`    transient (${reason(failed.error).slice(0, 60)}), retrying…`);
      spawnSync("sleep", [String(2 + attempt * 3)]);
      return sncastOnce(a, attempt + 1);
    }
    const err = new Error(reason(failed.error));
    err.sncast = failed;
    throw err;
  }

  const result = objects.reverse().find((o) => o.command || o.class_hash || o.contract_address);
  if (!result) {
    const text = (String(r.stderr ?? "") || String(r.stdout ?? "")).trim();
    if (transient(text) && attempt < 4) {
      say(`    transient, retrying…`);
      spawnSync("sleep", [String(2 + attempt * 3)]);
      return sncastOnce(a, attempt + 1);
    }
    throw new Error(`sncast ${a[0]} returned nothing readable: ${text.slice(-300)}`);
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

/**
 * Wait for a transaction to be accepted before doing anything that depends on it.
 *
 * On devnet a declare is visible to the very next call. On a public network it is not: the
 * declare returned a class hash and the deploy a moment later failed with "class is not
 * declared", which reads like a bug in the contract and is actually a bug in the assumption
 * that a returned hash means a finished transaction.
 *
 * Not optional and not a sleep. A fixed delay is either too short on a slow block or wasted
 * on a fast one; this asks the chain.
 */
async function waitFor(txHash, what, timeoutMs = 300_000) {
  if (!txHash) return;
  const started = Date.now();
  process.stderr.write(`    waiting for ${what} … `);
  for (;;) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "starknet_getTransactionStatus",
          params: [txHash],
        }),
      });
      const body = await res.json();
      const status = body?.result?.finality_status;
      const execution = body?.result?.execution_status;
      if (execution === "REVERTED") {
        process.stderr.write("REVERTED\n");
        throw new Error(`${what} reverted: ${body.result.failure_reason ?? "no reason given"}`);
      }
      if (status === "ACCEPTED_ON_L2" || status === "ACCEPTED_ON_L1") {
        process.stderr.write(`${status} in ${Math.round((Date.now() - started) / 1000)}s\n`);
        return;
      }
    } catch (e) {
      if (String(e.message).includes("reverted")) throw e;
      // A transaction the node has not indexed yet reads as an error; keep asking.
    }
    if (Date.now() - started > timeoutMs) {
      process.stderr.write("TIMED OUT\n");
      throw new Error(`${what} was not accepted within ${timeoutMs / 1000}s (${txHash})`);
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
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
async function declare(contract) {
  try {
    const r = sncast("declare", "--contract-name", contract);
    say(`  declared ${contract} → ${r.class_hash}`);
    // The class is not usable until the declare is accepted, and on a public network that
    // is not immediate.
    await waitFor(r.transaction_hash, `declare ${contract}`);
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

async function deploy(classHash, calldata, label) {
  const r = sncast("deploy", "--class-hash", classHash, ...(calldata.length ? ["--constructor-calldata", ...calldata] : []));
  if (r.transaction_hash) transactions.push({ hash: r.transaction_hash, what: `deploy ${label}` });
  say(`  deployed ${label} → ${r.contract_address}`);
  await waitFor(r.transaction_hash, `deploy ${label}`);
  return r.contract_address;
}

/**
 * Every transaction this script sends, in order.
 *
 * Recorded so the submission can be filled from what actually happened rather than from
 * hashes copied out of a terminal by hand — which is how one ends up submitting a hash from
 * the wrong network, or from a run that was later redeployed over.
 */
const transactions = [];

async function invoke(address, entrypoint, calldata, label) {
  const r = sncast(
    "invoke",
    "--contract-address",
    address,
    "--function",
    entrypoint,
    "--calldata",
    ...calldata,
  );
  transactions.push({ hash: r.transaction_hash, what: label });
  say(`  ${label} → ${r.transaction_hash}`);
  // Sequenced, not fired and forgotten. Two invokes in flight from one account collide on a
  // nonce, and on a public network the second is simply rejected.
  if (!isLocal) await waitFor(r.transaction_hash, label, 180_000);
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
say(`  rpc ${RPC.replace(/\/v2\/.*$/, "/v2/…")}\n`);

// ---- can these markets ever settle? -----------------------------------------------------
//
// Listing a market against an oracle that has stopped publishing creates something that can
// never resolve. On a testnet that is a defensible thing to do deliberately — the deploy path
// and the pool integration are worth proving even where settlement is impossible — but it is
// not a defensible thing to do by accident, so it has to be asked for and it gets written
// into the deployment record.
/**
 * Which oracle this deployment settles against.
 *
 * Pragma by default and on mainnet always. `--oracle <address>` points a testnet deployment
 * at the relay instead, which is the only way a Sepolia market can settle at all — Pragma
 * stopped publishing there months ago. The address is written into the deployment record, so
 * a deployment can never be quietly reading something other than what it claims.
 */
const chosenOracle = String(args.oracle ?? "") || PRAGMA[network] || null;

/**
 * Reuse an already-declared class instead of declaring again.
 *
 * A declare pays for the whole Sierra program and is by far the most expensive step — on
 * Sepolia today the estimator wants more than the deployer holds. A class hash is content
 * addressed, so if the code has not changed the class is already on chain and deploying
 * against it is a fraction of the cost. `--class-hash` says so explicitly rather than
 * letting a re-declare quietly drain an account.
 */
const chosenClass = args["class-hash"] ? String(args["class-hash"]) : null;

/** Which round tiers to list. All of them unless a deployment needs to be cheaper. */
const chosenTiers = args.tiers
  ? String(args.tiers).split(",").map((t) => Number(t.trim()))
  : null;
if (args.oracle && network === "mainnet") {
  console.error("Refusing --oracle on mainnet. Pragma is alive there; a relay would be a downgrade.");
  process.exit(1);
}

let settleable = true;
let oracleNote = null;
if (!isLocal) {
  const { MARKETS: PAIRS, decodePrint, freshness, pairId } = await import(
    "../packages/sdk/src/index.ts"
  );
  const { hash } = await import("starknet");
  const oracleAddr = chosenOracle;
  const dead = [];
  for (const m of PAIRS) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "starknet_call",
          params: [{
            contract_address: oracleAddr,
            entry_point_selector: hash.getSelectorFromName("get_data_median"),
            calldata: ["0x0", "0x" + pairId(m.label).toString(16)],
          }, "latest"],
        }),
      });
      const body = await res.json();
      const check = freshness(decodePrint(body.result));
      if (!check.fresh) dead.push(`${m.label}: ${check.reason}`);
    } catch (e) {
      dead.push(`${m.label}: ${e.message.slice(0, 60)}`);
    }
  }
  if (dead.length > 0) {
    settleable = false;
    oracleNote = dead;
    if (args["accept-unsettleable"] !== true) {
      console.error(
        `\nThe oracle on ${network} cannot settle these pairs:\n` +
          dead.map((d) => `  ${d}`).join("\n") +
          "\n\nMarkets listed here would never resolve. Pass --accept-unsettleable to do it\n" +
          "anyway — which is reasonable on a testnet, where the point is proving the deploy\n" +
          "path and the pool integration rather than trading.\n",
      );
      process.exit(1);
    }
    say(`  ! oracle cannot settle: ${dead.length} pair(s). Listing anyway, and recording it.\n`);
  }
}

// ---- what the market talks to ---------------------------------------------------------
let oracle;
let token;

if (isLocal) {
  // Local only. On a public chain these are the real StarkWare and Pragma contracts and
  // deploying a stand-in for either would be deploying a lie.
  say("devnet: deploying stand-ins for the oracle and the token");
  oracle = await deploy(await declare("StubOracle"), [], "StubOracle");
  token = await deploy(await declare("StubToken"), [], "StubToken");

  // A fresh, broad print so the market can actually settle.
  const now = Math.floor(Date.now() / 1000);
  await invoke(oracle, "set", [hex(7_970_000_000_000n), hex(now), hex(11)], "seeded the stub oracle");
} else {
  oracle = chosenOracle;
  token = STRK_TOKEN;
  const isPragma = oracle?.toLowerCase() === PRAGMA[network]?.toLowerCase();
  say(`  oracle  ${oracle}  ${isPragma ? "(Pragma)" : "(RELAY — republishes mainnet Pragma)"}`);
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
//
// Resumable, and it has to be. A deploy is thirty-odd transactions on a public network and
// losing the shell halfway through — a dropped connection, a timeout, a closed laptop —
// would otherwise strand a contract with markets listed and no bankroll behind them, and
// leave no way to finish it except deploying a second one.
//
// Resume state comes from the chain rather than from the file. The file records what this
// script believes; the chain records what actually happened, and only one of those is
// authoritative after a crash.
/**
 * Who may list markets on this deployment.
 *
 * The deploying account, because it is the only one that can sign the `create_market` calls
 * that come next. It used to default to the pool address, which deploys fine and then
 * refuses every listing with CALLER_NOT_OWNER — a contract stranded one step after birth,
 * for a default nobody would think to check.
 */
const owner = process.env.DEPLOYER_ADDRESS ?? accountAddress();
if (!owner) {
  throw new Error("could not determine the deployer's address; set DEPLOYER_ADDRESS");
}

let previous = null;
try {
  previous = JSON.parse(readFileSync(`deployments/${network}.json`, "utf8"));
} catch {
  /* no previous run */
}

const resuming = Boolean(args.resume) && previous?.market;
const marketClass = chosenClass ? (say(`  reusing declared class ${chosenClass}`), chosenClass) : resuming ? previous.classHash : await declare("MolfiMarket");
const market = resuming
  ? previous.market
  : await deploy(marketClass, [pool, oracle, owner], "MolfiMarket");
if (resuming) say(`  resuming ${market}\n`);

/** How many markets the contract already holds, so a resumed run does not list them twice. */
async function alreadyListed() {
  const r = await rpcCall("starknet_call", [{
    contract_address: market,
    entry_point_selector: (await import("starknet")).hash.getSelectorFromName("market_count"),
    calldata: [],
  }, "latest"]);
  return Number(BigInt(r[0]));
}

/** What a market already has behind it, so funding is not repeated or skipped. */
async function bankrollOf(id) {
  const r = await rpcCall("starknet_call", [{
    contract_address: market,
    entry_point_selector: (await import("starknet")).hash.getSelectorFromName("get_market"),
    calldata: [hex(id)],
  }, "latest"]);
  return (BigInt(r[19]) << 128n) | BigInt(r[18]);
}

async function rpcCall(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 200));
  return body.result;
}

// Record the contract before listing anything. A crash during the listing loop is then
// resumable with --resume; a crash before this point has cost nothing but a declare.
writeFileSync(
  `deployments/${network}.json`,
  JSON.stringify(
    { network, deployedAt: new Date().toISOString(), classHash: marketClass, market, oracle,
      oracleIsRelay: oracle?.toLowerCase() !== (PRAGMA[network] ?? "").toLowerCase(),
      token, pool, owner, settleable, oracleNote, markets: [], transactions:
      transactions.map((t) => t.hash), transactionLog: transactions, complete: false },
    null, 2,
  ) + "\n",
);

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

const listedAlready = resuming ? await alreadyListed() : 0;
if (listedAlready > 0) say(`  ${listedAlready} market(s) already listed, skipping those\n`);

let index = 0;
for (const m of CALIBRATED_MARKETS) {
  for (const [tier, round] of m.rounds.entries()) {
    // A deployment may list a subset of the rounds. Every listing is two transactions —
    // create then fund — and on a testnet where the deployer is not refillable, listing all
    // nine when the demo needs three is a way to run out halfway.
    if (chosenTiers && !chosenTiers.includes(tier)) continue;
    index += 1;
    const cutoffAt = now + round.seconds;
    if (index <= listedAlready) {
      listed.push({ pair: m.label, seconds: round.seconds, cutoffAt: null });
      continue;
    }
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
    await invoke(market, "create_market", calldata, `listed ${m.label} ${ROUND_SECONDS[tier]}s`);
    listed.push({ pair: m.label, seconds: round.seconds, cutoffAt });
  }
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
    if (resuming && (await bankrollOf(id)) >= bankroll) {
      say(`  market ${id} already funded, skipping`);
      continue;
    }
    if (isLocal) {
      // Local only: the stub token can mint.
      await invoke(token, "mint", [market, ...u256(bankroll)], `minted bankroll for market ${id}`);
    } else {
      // On a public network the tokens are real and have to actually move. `fund_market`
      // measures the contract's balance rather than trusting the amount, so calling it
      // without transferring first is refused with FUNDING_NOT_RECEIVED — which is the
      // check working, and was exactly what happened the first time this ran on Sepolia.
      await invoke(
        token,
        "transfer",
        [market, ...u256(bankroll)],
        `sent bankroll for market ${id}`,
      );
    }
    await invoke(market, "fund_market", [hex(id), ...u256(bankroll)], `funded market ${id}`);
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
  /**
   * Whether markets here can actually resolve. False means the oracle has stopped
   * publishing and every market listed is permanently open — recorded so nobody reads this
   * deployment as a working market.
   */
  settleable,
  oracleNote,
  markets: listed,
  /** Every transaction, so the submission is filled from what happened rather than by hand. */
  transactions: [...(resuming ? (previous.transactions ?? []) : []), ...transactions.map((t) => t.hash)],
  transactionLog: [...(resuming ? (previous.transactionLog ?? []) : []), ...transactions],
  complete: true,
};
writeFileSync(`deployments/${network}.json`, JSON.stringify(out, null, 2) + "\n");
say(`\nwrote deployments/${network}.json`);

/**
 * Point the SDK at what was just deployed.
 *
 * `MOLFI_MARKET` in `packages/sdk/src/networks.ts` is what the console, the API routes and
 * the verifier all read. Leaving it to a hand edit means a deploy that succeeds completely
 * and changes nothing anyone can see, and the symptom — a new contract on chain and an old
 * one in the browser — looks like a caching problem rather than a missed step.
 *
 * Rewritten by locating the network's own line inside the record, so the comment block above
 * it survives and nothing else in the file is touched.
 */
if (!isLocal) {
  const file = "packages/sdk/src/networks.ts";
  const before = readFileSync(file, "utf8");

  // Scoped to the MOLFI_MARKET record, not the whole file. `sepolia:` also appears in
  // CHAIN_IDS and in NETWORKS, and a file-wide replace rewrote the chain id — a deployment
  // that then fails every wallet check for a reason nothing points at.
  const open = before.indexOf("export const MOLFI_MARKET");
  const close = open >= 0 ? before.indexOf("\n};", open) : -1;
  const line = new RegExp(`(\\n  ${network}: )(?:"0x[0-9a-fA-F]+"|null)(,)`);

  if (open < 0 || close < 0 || !line.test(before.slice(open, close))) {
    say(`  ! could not find MOLFI_MARKET.${network} in ${file}; set it by hand`);
  } else {
    const record = before.slice(open, close);
    const updated = record.replace(line, `$1"${market}"$2`);
    if (updated !== record) {
      writeFileSync(file, before.slice(0, open) + updated + before.slice(close));
      say(`updated MOLFI_MARKET.${network} in ${file}`);
    } else {
      say(`MOLFI_MARKET.${network} already points at this deployment`);
    }
  }
}

say(`\n  market ${market}\n`);
if (!isLocal) {
  say(`  Next: commit, redeploy the console, then open a real position:`);
  say(`    node --experimental-strip-types scripts/trade.mjs --network ${network} --account ${account} --stake 1\n`);
}
