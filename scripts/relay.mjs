#!/usr/bin/env node
/**
 * Deploy and drive the Sepolia price relay.
 *
 * Reads mainnet Pragma's median and republishes it to the relay on Sepolia, so a testnet
 * deployment can settle at all. Every relayed value carries the mainnet block it was read
 * at, so the number can be checked against the chain it came from.
 *
 *   node --experimental-strip-types scripts/relay.mjs deploy
 *   node --experimental-strip-types scripts/relay.mjs push
 *   node --experimental-strip-types scripts/relay.mjs status
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hash } from "starknet";
import { MARKETS, decodePrint, freshness, pairId } from "../packages/sdk/src/index.ts";
import { PRAGMA } from "../packages/sdk/src/pragma.ts";

const command = process.argv[2] ?? "status";
const account = process.env.RELAYER_ACCOUNT ?? "ghost_deployer";
const SEPOLIA = process.env.SEPOLIA_RPC ?? "https://api.cartridge.gg/x/starknet/sepolia";
const MAINNET = process.env.MAINNET_RPC ?? "https://api.cartridge.gg/x/starknet/mainnet";
const FILE = "deployments/sepolia-relay.json";

const say = (s) => process.stderr.write(`${s}\n`);
const hex = (v) => "0x" + BigInt(v).toString(16);

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message ?? JSON.stringify(body.error));
  return body.result;
}

const call = (url, to, fn, calldata = []) =>
  rpc(url, "starknet_call", [
    { contract_address: to, entry_point_selector: hash.getSelectorFromName(fn), calldata },
    "latest",
  ]);

/** The one line worth reading out of a Starknet revert. */
function reason(text) {
  const named = String(text).match(/\('([A-Z0-9_]+)'\)/);
  return named ? `${named[1]} (contract refused)` : String(text).slice(0, 240);
}

function sncast(...a) {
  const r = spawnSync("sncast", ["--json", "--account", account, ...a, "--url", SEPOLIA], {
    cwd: "cairo",
    encoding: "utf8",
  });
  const objects = [];
  for (const line of [...String(r.stdout ?? "").split("\n"), ...String(r.stderr ?? "").split("\n")]) {
    if (!line.trim()) continue;
    try {
      objects.push(JSON.parse(line));
    } catch {
      /* build progress */
    }
  }
  const failed = objects.find((o) => o.error);
  if (failed) throw new Error(reason(failed.error));
  const out = objects.reverse().find((o) => o.command || o.class_hash || o.contract_address);
  if (!out) {
    // Include what it actually said. "Returned nothing readable" with the output thrown away
    // is the least useful error a wrapper can produce, and it cost a round trip once.
    throw new Error(
      `sncast ${a[0]} returned nothing readable: ${(String(r.stderr ?? "") + String(r.stdout ?? "")).slice(-300)}`,
    );
  }
  return out;
}

function declare(name) {
  try {
    const r = sncast("declare", "--contract-name", name);
    say(`  declared ${name} → ${r.class_hash}`);
    return r.class_hash;
  } catch (e) {
    const known = String(e.message).match(/0x[0-9a-fA-F]{40,64}/);
    if (/already declared/i.test(e.message) && known) {
      say(`  ${name} already declared → ${known[0]}`);
      return known[0];
    }
    throw e;
  }
}

const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : null);

/** Mainnet Pragma's median for one pair, with the block it was read at. */
async function readMainnet(pair) {
  const block = await rpc(MAINNET, "starknet_blockNumber");
  const raw = await call(MAINNET, PRAGMA.mainnet, "get_data_median", [
    "0x0",
    hex(pairId(pair)),
  ]);
  const print = decodePrint(raw);
  return { print, check: freshness(print), block };
}

// ---------------------------------------------------------------------------- deploy
if (command === "deploy") {
  say(`\nrelay deploy · sepolia · account ${account}\n`);
  const who = process.env.RELAYER_ADDRESS;
  if (!who) throw new Error("set RELAYER_ADDRESS to the account that will publish");

  const classHash = declare("PriceRelay");
  const r = sncast(
    "deploy",
    "--class-hash",
    classHash,
    "--constructor-calldata",
    who,
    PRAGMA.mainnet,
  );
  say(`  deployed PriceRelay → ${r.contract_address}`);

  writeFileSync(
    FILE,
    JSON.stringify(
      {
        network: "sepolia",
        deployedAt: new Date().toISOString(),
        classHash,
        relay: r.contract_address,
        relayer: who,
        mirrors: PRAGMA.mainnet,
        note:
          "Republishes mainnet Pragma's median onto Sepolia, because Pragma stopped " +
          "publishing there. One publisher — us. Every value carries the mainnet block it " +
          "was read at. Not deployed on mainnet, where molfi reads Pragma directly.",
      },
      null,
      2,
    ) + "\n",
  );
  say(`\nwrote ${FILE}\n  relay ${r.contract_address}\n`);
}

// ---------------------------------------------------------------------------- push
if (command === "push") {
  const cfg = load();
  if (!cfg) throw new Error(`no ${FILE}; run deploy first`);
  say(`\nrelay push · ${cfg.relay}\n`);

  let pushed = 0;
  for (const m of MARKETS) {
    const { print, check, block } = await readMainnet(m.label);
    if (!check.fresh) {
      // Never relay a print the source itself would not settle against. The relay cannot
      // improve a bad number and must not launder one.
      say(`  ${m.label}: skipped — mainnet says ${check.reason}`);
      continue;
    }
    try {
      const r = sncast(
        "invoke",
        "--contract-address",
        cfg.relay,
        "--function",
        "relay",
        "--calldata",
        hex(pairId(m.label)),
        hex(print.raw),
        hex(print.decimals),
        hex(print.updatedAt),
        hex(print.sources),
        hex(block),
      );
      say(
        `  ${m.label}: ${print.raw} (${print.sources} publishers, ${check.ageSeconds}s old, mainnet block ${block}) → ${r.transaction_hash}`,
      );
      pushed += 1;
    } catch (e) {
      if (/PRINT_OLDER_THAN_STORED/.test(e.message)) {
        say(`  ${m.label}: unchanged since the last relay`);
      } else {
        say(`  ${m.label}: FAILED — ${e.message}`);
      }
    }
  }
  say(`\n${pushed} relayed\n`);
}

// ---------------------------------------------------------------------------- status
if (command === "status") {
  const cfg = load();
  if (!cfg) {
    say(`no ${FILE} — the relay is not deployed`);
    process.exit(1);
  }
  say(`\nrelay · ${cfg.relay}\n  mirrors ${cfg.mirrors} on mainnet\n`);

  const nowSec = Math.floor(Date.now() / 1000);
  for (const m of MARKETS) {
    try {
      const r = await call(SEPOLIA, cfg.relay, "get_relayed", [hex(pairId(m.label))]);
      // RelayedPrice: price (u128), decimals, published_at, sources, source_block, relayed_at
      const price = BigInt(r[0]);
      if (price === 0n) {
        say(`  ${m.label}: never relayed`);
        continue;
      }
      const publishedAt = Number(BigInt(r[2]));
      const age = nowSec - publishedAt;
      say(
        `  ${m.label}: ${(Number(price) / 1e8).toLocaleString()} · ${r[3]} publishers · ` +
          `${age}s old · mainnet block ${BigInt(r[4])}`,
      );
    } catch (e) {
      say(`  ${m.label}: ${e.message}`);
    }
  }
  say("");
}
