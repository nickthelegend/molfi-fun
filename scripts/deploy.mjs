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

import { readFileSync, writeFileSync } from "node:fs";
import { chain, hex, say, short, u256 } from "./lib/chain.mjs";
import { CALIBRATED_MARKETS, ROUND_SECONDS } from "../packages/sdk/src/generated/markets.ts";
import { NETWORKS, STRK_TOKEN } from "../packages/sdk/src/networks.ts";
import { PRAGMA, SETTLEMENT_MAX_PRICE_AGE_SECONDS } from "../packages/sdk/src/pragma.ts";

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
 * One account, one endpoint, and a record of every write.
 *
 * The invocation, retry and transaction-waiting rules live in `scripts/lib/chain.mjs` — they
 * are not deploy-specific and a second copy of them would be a second copy to get wrong.
 * `wait` is false on devnet, where a transaction is visible to the very next call and asking
 * the node about it is pure latency.
 */
const { rpcCall, declare, deploy, invoke, transactions, accountAddress: sncastAddress } =
  chain({ account, rpc: RPC, wait: !isLocal });

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
      // Whether a market listed here could ever resolve is the contract's 900s rule.
      const check = freshness(decodePrint(body.result), undefined, SETTLEMENT_MAX_PRICE_AGE_SECONDS);
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

/**
 * The address that signs, with the devnet override in front.
 *
 * A local run points the pool at the deployer itself, and that address comes from the devnet
 * the harness started rather than from sncast's account store.
 */
function accountAddress() {
  return process.env.DEVNET_ACCOUNT_ADDRESS ?? sncastAddress();
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
