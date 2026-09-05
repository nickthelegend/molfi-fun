#!/usr/bin/env node
/**
 * Everything between "the deployer has enough STRK" and "somebody has traded on Sepolia".
 *
 * The public trading route is written, unit tested, and proven end to end against a real
 * chain — and none of it reaches a user until the class is declared, which costs about 60
 * STRK. This script is the rest of that path, in one command, so the gap between funding and
 * a live trade is a single step rather than six remembered ones.
 *
 *   1. Check the balance, and say plainly how short it is if it is short.
 *   2. Declare and deploy, listing and funding the markets. `deploy.mjs` also repoints
 *      MOLFI_MARKET in the SDK, which is what the console and every API route read.
 *   3. Open a real position from the deploying account, through the console's own call
 *      builders — the same `openCalls` LiveConsole uses.
 *   4. Re-check the two plan items this exists to close: D11, that `open_position` answers
 *      on the deployed address, and D12, that the market has actually been traded.
 *
 * It stops at the first failure rather than carrying on, because every later step reads the
 * state an earlier one wrote.
 *
 * Usage: node --experimental-strip-types scripts/golive.mjs [--account ghost_deployer]
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { RpcProvider, hash as snhash } from "starknet";
import { NETWORKS, STRK_TOKEN } from "../packages/sdk/src/networks.ts";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") === false ? all[i + 1] : true]] : [],
  ),
);
const account = String(args.account ?? "ghost_deployer");
const network = "sepolia";
const RPC = process.env.STARKNET_RPC_URL ?? NETWORKS[network].rpcUrl;
const provider = new RpcProvider({ nodeUrl: RPC });

/** What the declare costs, measured rather than remembered. */
const DECLARE_STRK = 62n;
const NEEDED = (DECLARE_STRK + 3n) * 10n ** 18n;

const say = (s) => process.stdout.write(`${s}\n`);
const strk = (v) => `${(Number(v) / 1e18).toFixed(2)} STRK`;

function run(label, cmd, cmdArgs, opts = {}) {
  say(`\n\x1b[1m── ${label}\x1b[0m`);
  const r = spawnSync(cmd, cmdArgs, { stdio: "inherit", encoding: "utf8", ...opts });
  if (r.status !== 0) {
    say(`\n  ${label} failed. Nothing after this point would be reading the state it expects, so stopping here.\n`);
    process.exit(r.status ?? 1);
  }
}

function accountAddress() {
  const r = spawnSync("sncast", ["--json", "account", "list"], { cwd: "cairo", encoding: "utf8" });
  const m = String(r.stdout ?? "").match(
    new RegExp(`"${account}"\\s*:\\s*\\{[^}]*"address"\\s*:\\s*"(0x[0-9a-fA-F]+)"`),
  );
  if (!m) throw new Error(`could not read ${account}'s address from sncast`);
  return m[1];
}

/**
 * Is the class already on chain?
 *
 * The 60 STRK is the *declare*, and a class is a chain-wide fact: anyone may declare it, and
 * once anyone has, deploying an instance costs about a tenth of a STRK. So the affordability
 * gate below only applies while the class is missing. Checking costs one call and turns a
 * 60 STRK requirement into a 1 STRK one the moment the class exists, whoever put it there.
 */
async function declaredClassHash() {
  for (const dir of ["cairo/target/release", "cairo/target/dev"]) {
    try {
      const sierra = JSON.parse(readFileSync(`${dir}/molfi_MolfiMarket.contract_class.json`, "utf8"));
      const h = snhash.computeContractClassHash(sierra);
      const onChain = await provider.getClassByHash(h).then(() => true).catch(() => false);
      return { classHash: h, declared: onChain, from: dir };
    } catch {
      /* not built in this profile */
    }
  }
  return { classHash: null, declared: false, from: null };
}

const address = accountAddress();
const balance = await provider
  .callContract({ contractAddress: STRK_TOKEN, entrypoint: "balance_of", calldata: [address] })
  .then((r) => (BigInt(r[1]) << 128n) | BigInt(r[0]));

say(`\nmolfi go-live · ${network} · ${account}`);
say(`  ${address}`);
say(`  balance ${strk(balance)}, declare needs about ${DECLARE_STRK} STRK\n`);

const cls = await declaredClassHash();
if (cls.classHash) {
  say(`  class ${cls.classHash}`);
  say(`  ${cls.declared ? "already declared — the declare is not needed" : "not declared yet"} (${cls.from})\n`);
}

/** Deploying an already-declared class is cheap; declaring it is not. */
const required = cls.declared ? 3n * 10n ** 18n : NEEDED;

if (balance < required) {
  const short = required - balance;
  say(`  Short by ${strk(short)}.`);
  say(`\n  Declaring a class is priced on its bytecode, and molfi's is 9,752 Sierra felts —`);
  say(`  about 2.03e9 L2 gas, which at the current 29.8 Gfri is roughly ${DECLARE_STRK} STRK. That is not`);
  say(`  a molfi number: a randomly sampled Sepolia declare cost 17 STRK for a quarter the`);
  say(`  bytecode. Shrinking cannot close it — the release profile saves 14%, dropping unused`);
  say(`  derives saves nothing because Sierra already strips them, and avoiding inlining is`);
  say(`  11% worse.`);
  say(`\n  Or have anyone at all declare the class — it is a chain-wide fact, and once it`);
  say(`  exists this needs about 3 STRK rather than ${DECLARE_STRK}:`);
  say(`    cd cairo && sncast --account <funded> declare --contract-name MolfiMarket \\`);
  say(`      --url ${RPC}`);
  say(`\n  To fund it:`);
  say(`    node --experimental-strip-types scripts/faucet.mjs ${address}`);
  say(`      5 STRK, no sign-in, one per address per 24h.`);
  say(`    https://faucet.starknet.io`);
  say(`      100 STRK from the form — gated by a Cloudflare Turnstile CAPTCHA.`);
  say(`      3,000 STRK with a GitHub sign-in. Both share the same 24h cooldown.`);
  say(`\n  Then run this again.\n`);
  process.exit(2);
}

run(cls.declared ? "Deploy the declared class, list and fund" : "Declare, deploy, list and fund", "node", [
  "--experimental-strip-types", "scripts/deploy.mjs",
  "--network", network, "--account", account,
  "--oracle", JSON.parse(readFileSync(`deployments/${network}.json`, "utf8")).oracle,
  ...(cls.declared ? ["--class-hash", cls.classHash] : []),
]);

run("Open a real position, through the console's own calls", "node", [
  "--experimental-strip-types", "scripts/trade.mjs",
  "--network", network, "--account", account, "--stake", String(args.stake ?? 1),
]);

run("Re-check the plan", "node", ["--experimental-strip-types", "scripts/verify.mjs"]);

say(`\n  Live. Commit the updated MOLFI_MARKET and redeploy the console:`);
say(`    git add -A && git commit && git push && vercel --prod --yes\n`);
