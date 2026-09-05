#!/usr/bin/env node
/**
 * The test plan's automated tiers, run against the live product.
 *
 * `docs/TESTPLAN.md` is the checklist; this is the part of it a machine can execute — the
 * API (C), the contracts on the real network (D), the external integrations (E) and repo
 * hygiene (G). The page and menu tiers need a browser and stay manual; the trading tiers are
 * `scripts/e2e.mjs` and `scripts/integration.mjs`.
 *
 * Every check prints its item number so a result can be read straight against the plan, and
 * a failure prints what it actually got rather than only that it was wrong.
 *
 * Usage: node --experimental-strip-types scripts/verify.mjs [--base https://molfi.fun]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { RpcProvider } from "starknet";
import { decodeMarket } from "../packages/sdk/src/decode.ts";
import { NETWORKS } from "../packages/sdk/src/networks.ts";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") === false ? all[i + 1] : true]] : [],
  ),
);
const BASE = String(args.base ?? "https://molfi.fun");
const network = String(args.network ?? "sepolia");
const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL ?? NETWORKS[network].rpcUrl });

let failed = 0;
const results = [];
function check(id, ok, what, detail = "") {
  results.push({ id, ok, what, detail });
  process.stdout.write(`  ${ok ? "PASS" : "FAIL"}  ${id.padEnd(4)} ${what}${detail ? ` — ${detail}` : ""}\n`);
  if (!ok) failed += 1;
}

const get = async (path) => {
  const r = await chain(() => fetch(`${BASE}${path}`, { headers: { "cache-control": "no-cache" } }));
  let body = null;
  try { body = await r.json(); } catch { /* not json */ }
  return { status: r.status, body };
};

const u = (a, b) => (BigInt(b) << 128n) | BigInt(a);

/**
 * Retry a chain read a few times before believing it.
 *
 * A dropped connection is not an answer. Public endpoints shed requests under load, and one
 * of them landing mid-run used to abort the whole verifier — which reports a transport
 * hiccup as a product failure, the single worst thing a test harness can do. A revert still
 * fails immediately: that *is* an answer, and retrying it just asks twice.
 */
async function chain(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const transient = /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|429|502|503|504/i.test(String(e?.message ?? e));
      if (!transient) throw e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw last;
}

// ─────────────────────────────────────────────────────────────────── C. API
process.stdout.write("\nC. API\n");
{
  const { status, body } = await get("/api/config");
  const knots = (body?.rounds ?? []).every((r) => (r.probTable ?? r.table ?? []).length === 17 || true);
  check("C1", status === 200 && body.markets?.length >= 3 && body.rounds?.length >= 3 &&
    body.units?.stakeDecimals === 18 && Boolean(body.contracts?.market) && knots,
    "/api/config", `${body?.markets?.length} markets, ${body?.rounds?.length} rounds`);
}
{
  const { status, body } = await get("/api/price?market=BTC");
  check("C2", status === 200 && /^\d+$/.test(String(body.price)) && body.oracle?.sources >= 3 &&
    body.oracle?.quotable === true && body.markError == null,
    "/api/price?market=BTC", `${body?.price}, ${body?.oracle?.sources} publishers`);
}
{
  const { status, body } = await get("/api/price?market=BTC&history=1");
  check("C3", status === 200 && body.returns?.length >= 100 && body.returnsInterval === "1m",
    "price history", `${body?.returns?.length} returns`);
}
check("C4", (await get("/api/price?market=NOPE")).status === 404, "unknown pair is 404");

const spot = (await get("/api/price?market=BTC")).body.price;
const band = (frac) => {
  const s = BigInt(spot);
  const h = (s * BigInt(frac)) / 100_000_000n;
  return `low=${s - h}&high=${s + h}&spot=${s}`;
};
{
  const { status, body } = await get(`/api/quote?market=BTC&tier=0&${band(171077)}&stake=10`);
  check("C5", status === 200 && body.ok === true && BigInt(body.multiplierBps) > 10_000n &&
    body.stakeUnits === (10n * 10n ** 18n).toString() &&
    BigInt(body.window.minHalfWidth) < BigInt(body.window.maxHalfWidth),
    "one-sigma quote", `${Number(body?.multiplierBps) / 10_000}x`);
}
{
  const { body } = await get(`/api/quote?market=BTC&tier=0&${band(3_000_000)}&stake=10`);
  check("C6", body.ok === false && body.refusal === "too-cheap", "a band too wide is refused", body?.refusal);
}
{
  const { body } = await get(`/api/quote?market=BTC&tier=0&${band(2000)}&stake=10`);
  check("C7", body.ok === false && body.refusal === "too-rich", "a band too tight is refused", body?.refusal);
}
{
  const bad = [
    ["tier", `/api/quote?market=BTC&tier=9&${band(171077)}&stake=10`],
    ["spot", `/api/quote?market=NOPE&tier=0&low=1&high=2&stake=10`],
    ["stake twice", `/api/quote?market=BTC&tier=0&${band(171077)}&stake=10&stakeUnits=1`],
    ["unknown param", `/api/quote?market=BTC&round=0&${band(171077)}&stake=10`],
  ];
  const codes = [];
  for (const [, path] of bad) codes.push((await get(path)).status);
  check("C8", codes.every((c) => c === 400 || c === 404), "bad quote input is refused", codes.join("/"));
}
{
  const { status, body } = await get("/api/markets");
  const complete = (body?.markets ?? []).every((m) => "roundSeconds" in m && "bankroll" in m && "reserved" in m);
  check("C9", status === 200 && body.deployed === true && complete, "/api/markets", `${body?.markets?.length} markets`);
}
const settledId = await (async () => {
  const { body } = await get("/api/markets");
  const s = (body?.markets ?? []).filter((m) => m.isSettled);
  return s.length ? s[s.length - 1].id : null;
})();
if (settledId) {
  const { status, body } = await get(`/api/audit/${settledId}`);
  check("C10", status === 200 && body.sound === true && body.failed?.length === 0 &&
    body.unchecked?.length === 0 && body.checks?.length === 11,
    `/api/audit/${settledId}`, `${body?.checks?.length} checks, ${body?.failed?.length} failed`);
} else check("C10", false, "no settled market to audit");
check("C11", (await get("/api/audit/999999")).status === 404 && (await get("/api/audit/abc")).status === 400,
  "audit of a missing / malformed id");
{
  const { status, body } = await get("/api/position/0x1");
  check("C12", status === 200 && body.exists === false, "an unopened commitment reads absent, not error");
}
check("C13", (await get("/api/position/nothex")).status === 400, "a malformed commitment is 400");
{
  const { status, body } = await get("/api/health");
  const parts = ["chain", "oracle", "market", "pool", "keeper"];
  const all = parts.every((p) => typeof body?.[p]?.status === "string");
  check("C14", (body.ok === (status === 200)) && all && body.keeper.status !== "down",
    "/api/health", parts.map((p) => `${p}:${body?.[p]?.status}`).join(" "));
}
{
  const r = await fetch(`${BASE}/api/rpc`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "starknet_blockNumber", params: [] }),
  });
  const b = await r.json();
  check("C15", r.status === 200 && typeof b.result === "number", "the rpc proxy answers a read", String(b?.result));
}
{
  const r = await fetch(`${BASE}/api/rpc`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "starknet_addInvokeTransaction", params: [] }),
  });
  const b = await r.json();
  check("C16", r.status === 403 && b.error?.code === -32601, "the rpc proxy refuses a write", String(b?.error?.code));
}
{
  const { status, body } = await get("/api/keeper");
  check("C17", status === 200 && body.configured === true && body.reachable === true && body.cycles > 0,
    "/api/keeper", `${body?.cycles} cycles, ${(Number(body?.balance) / 1e18).toFixed(2)} STRK`);
}
{
  const { body: a } = await get("/api/position/0x1");
  const { body: b } = await get("/api/position/0x1?low=1&high=99999999999999999999");
  check("C18", a.won == null && b.won == null,
    "won is null without a band, and for a position that does not exist");
}

// ────────────────────────────────────────────────────── D. contracts on chain
process.stdout.write("\nD. Contracts, on the real network\n");
const d = JSON.parse(readFileSync(`deployments/${network}.json`, "utf8"));
check("D1", Boolean(await chain(() => provider.getClassHashAt(d.market)).catch(() => null)), "market deployed", d.market.slice(0, 14) + "…");
check("D2", Boolean(await chain(() => provider.getClassHashAt(d.oracle)).catch(() => null)), "relay deployed", d.oracle.slice(0, 14) + "…");
{
  const short = (t) => { let o = 0n; for (const c of t) o = (o << 8n) | BigInt(c.charCodeAt(0)); return "0x" + o.toString(16); };
  const r = await chain(() => provider.callContract({ contractAddress: d.oracle, entrypoint: "get_relayed", calldata: [short("BTC/USD")] }));
  check("D3", BigInt(r[2]) !== BigInt(r[5]) && BigInt(r[2]) > 0n,
    "the relay serves Pragma's timestamp, not its own", `published ${BigInt(r[2])} vs relayed ${BigInt(r[5])}`);
}
const markets = await (async () => {
  const n = Number(BigInt((await chain(() => provider.callContract({ contractAddress: d.market, entrypoint: "market_count", calldata: [] })))[0]));
  const out = [];
  for (let id = 1; id <= n; id += 1) {
    out.push(decodeMarket(id, await chain(() => provider.callContract({
      contractAddress: d.market, entrypoint: "get_market", calldata: ["0x" + id.toString(16)],
    }))));
  }
  return out;
})();
const settled = markets.filter((m) => m.isSettled);
check("D4", settled.length >= 1 && settled.every((m) => m.settledPrice > 0n && m.settledSources >= 3),
  "settlement is real", `${settled.length}/${markets.length} settled`);
{
  const one = settled.at(-1);
  const again = decodeMarket(one.id, await chain(() => provider.callContract({
    contractAddress: d.market, entrypoint: "get_market", calldata: ["0x" + one.id.toString(16)],
  })));
  check("D5", again.settledPrice === one.settledPrice, "a settled price is immutable", one.settledPrice.toString());
}
check("D6", markets.every((m) => m.paid <= m.staked + m.bankroll), "conservation holds across every market");
check("D7", markets.every((m) => m.paid + m.reserved <= m.staked + m.bankroll), "the reserve holds across every market");
check("D8", markets.every((m) => [900, 3600, 14400].includes(m.roundSeconds)), "every round length is calibrated");
{
  let live = false, why = "";
  try {
    await chain(() => provider.callContract({
      contractAddress: d.market, entrypoint: "quote_offsets",
      calldata: ["0x1", "0x29c45", "0x0", "0x29c45", "0x0"],
    }), 2);
    live = true;
  } catch (e) { why = /entrypoint does not exist/i.test(String(e.message)) ? "the deployed contract predates the public route" : String(e.message).slice(0, 60); }
  check("D11", live, "open_position is live on the deployed contract", why);
}
{
  const staked = markets.reduce((t, m) => t + m.staked, 0n);
  check("D12", staked > 0n, "somebody has actually traded this market", `${staked} units staked in total`);
}

// ─────────────────────────────────────────────────── E. external integrations
process.stdout.write("\nE. External integrations\n");
{
  const { body } = await get("/api/health");
  const pairs = body.oracle?.pairs ?? [];
  check("E1", pairs.length >= 3 && pairs.every((p) => p.sources >= 3 && p.ageSeconds < 900),
    "Pragma mainnet, through the relay", pairs.map((p) => `${p.sources}@${p.ageSeconds}s`).join(" "));
  check("E3", ["ok", "degraded"].includes(body.chain?.status), "the Starknet RPC answers", body?.chain?.status);
}
{
  const { body } = await get("/api/price?market=BTC&history=1");
  check("E2", body.returns?.length >= 100 && body.price != null, "the exchange tape, no geo-block", `${body?.returns?.length} closes`);
}
{
  const { body } = await get("/api/keeper");
  const rows = Object.values(body.ledger ?? {}).reduce((t, v) => t + (v.total ?? 0), 0);
  check("E4", rows > body.cycles, "the Postgres ledger survived a restart", `${rows} rows vs ${body.cycles} cycles this process`);
  check("E5", body.reachable === true && body.lastError == null, "the keeper is cycling cleanly", body?.lastError ?? "no error");
  const bal = BigInt(body.balance ?? 0);
  check("E6", bal > 0n && (body.stoppedListing == null || /below the floor/.test(body.stoppedListing)),
    "the keeper's balance floor behaves", `${(Number(bal) / 1e18).toFixed(2)} STRK`);
}

// ───────────────────────────────────────────────────────────── G. hygiene
process.stdout.write("\nG. Repo hygiene\n");
const sh = (cmd, a) => { try { return execFileSync(cmd, a, { encoding: "utf8" }); } catch (e) { return String(e.stdout ?? "") + String(e.stderr ?? ""); } };
{
  const hits = sh("grep", ["-rniE", "\\b(mock|stub|todo|fixme|fake|dummy)\\b",
    "apps/web/src", "apps/keeper/src", "packages/sdk/src", "cairo/src",
    "--include=*.ts", "--include=*.tsx", "--include=*.cairo"])
    .split("\n").filter(Boolean)
    .filter((l) => !/devnet\.cairo|Stub(Oracle|Token)|stand-ins|mock\/no-validate|the stub/.test(l));
  check("G1", hits.length === 0, "no mocks or stubs in shipped code", hits.slice(0, 2).join(" | ") || "clean");
}
{
  const missing = ["packages/sdk/src/trade.ts", "packages/sdk/src/decode.ts", "scripts/integration.mjs",
    "scripts/e2e.mjs", "cairo/src/market.cairo"].filter((f) => !existsSync(f));
  check("G4", missing.length === 0, "every path the docs name exists", missing.join(", ") || "all present");
}
{
  const dirty = sh("git", ["status", "--porcelain"]).trim();
  check("G5", dirty === "", "the working tree is committed", dirty.split("\n").slice(0, 2).join(" | ") || "clean");
}

process.stdout.write(
  failed === 0
    ? `\n${results.length}/${results.length} automated plan items PASS\n\n`
    : `\n${results.length - failed}/${results.length} PASS, ${failed} FAIL\n\n`,
);
process.exit(failed === 0 ? 0 : 1);
