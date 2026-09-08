#!/usr/bin/env node
/**
 * Regenerate everything that restates the mainnet deployment, from the deployment record.
 *
 * `strk20.json` and the landing page's mainnet strip both claim what molfi did on mainnet.
 * Both were maintained by hand, and both drifted: the sprint's own submission checker read
 * `strk20.json`, found `network: sepolia`, and correctly concluded molfi had never touched
 * mainnet — while thirteen finalised mainnet transactions sat in `deployments/mainnet.json`
 * a directory away. A restatement of a fact that can disagree with the fact is a bug with a
 * scheduled fuse, so this makes them outputs rather than documents.
 *
 * `deployments/mainnet.json` is the source: `scripts/deploy.mjs` writes it as the chain
 * confirms each transaction, so it cannot claim a transaction that did not land.
 *
 *   node scripts/sync-manifest.mjs           regenerate
 *   node scripts/sync-manifest.mjs --check   fail if anything is stale (preflight, CI)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const rec = JSON.parse(readFileSync(join(ROOT, "deployments/mainnet.json"), "utf8"));

/**
 * The account deploy is a mainnet transaction molfi made and the deploy script does not
 * record, because by the time it runs the account already exists — `sncast` pays for
 * `DEPLOY_ACCOUNT` out of the account's own balance before any of this. It is written into
 * the record by hand once, verified on chain, and read from there like everything else.
 */
const log = [
  ...(rec.accountDeployTx ? [{ hash: rec.accountDeployTx, what: "account deployed" }] : []),
  ...rec.transactionLog.map((t) => ({ hash: t.hash, what: t.what })),
];

const manifest = {
  network: rec.network,
  demo_url: "https://molfi.fun",
  demo_video: "https://molfi.fun/molfi-demo.mp4",
  repository: "https://github.com/nickthelegend/molfi-fun",
  contracts: [rec.market],
  transactions: log.map((t) => t.hash),
};

const ts = `/** GENERATED — do not edit by hand. Produced by \`node scripts/sync-manifest.mjs\`
 *  from \`deployments/mainnet.json\`, which the deploy script writes as the chain confirms.
 *
 *  Here so the landing page can state what molfi did on mainnet without a human retyping a
 *  hash. Generated: kept in step by \`--check\` in preflight.
 */

export interface MainnetTransaction {
  /** The transaction hash, as accepted on L1. */
  readonly hash: string;
  /** What it did, in the deploy script's own words. */
  readonly what: string;
}

export const MAINNET_DEPLOYMENT = {
  /** The market contract, live and reading Pragma mainnet directly. */
  market: ${JSON.stringify(rec.market)},
  /** Pragma's aggregator on mainnet. No relay here — Pragma is alive on mainnet. */
  oracle: ${JSON.stringify(rec.oracle)},
  deployedAt: ${JSON.stringify(rec.deployedAt)},
  /** House bankroll put behind each market, in wei of STRK. */
  bankrollPerMarket: ${JSON.stringify(rec.bankrollPerMarket)},
  /** Pairs listed. The five Pragma does not carry on mainnet were deliberately skipped. */
  markets: ${JSON.stringify(rec.markets.map((m) => ({ pair: m.pair, seconds: m.seconds })))},
  /** Pairs skipped, because a market whose oracle cannot be read can never resolve. */
  skipped: ${JSON.stringify(rec.skippedPairs ?? [])},
  transactions: ${JSON.stringify(log, null, 2).replace(/\n/g, "\n  ")},
  explorer: "https://starkscan.co",
} as const;
`;

const targets = [
  ["strk20.json", JSON.stringify(manifest, null, 2) + "\n"],
  ["packages/sdk/src/generated/mainnet.ts", ts],
];

let stale = 0;
for (const [rel, want] of targets) {
  const path = join(ROOT, rel);
  let have = null;
  try {
    have = readFileSync(path, "utf8");
  } catch {
    /* not written yet */
  }
  if (have === want) {
    console.log(`  ok      ${rel}`);
    continue;
  }
  stale++;
  if (check) {
    console.log(`  STALE   ${rel}`);
  } else {
    writeFileSync(path, want);
    console.log(`  written ${rel}`);
  }
}

console.log(
  `\n${rec.network}: ${manifest.contracts.length} contract, ${log.length} transactions, ` +
    `${rec.markets.length} markets`,
);

if (check && stale) {
  console.error(
    `\n${stale} file(s) disagree with deployments/mainnet.json.\n` +
      `Run: node scripts/sync-manifest.mjs`,
  );
  process.exit(1);
}
