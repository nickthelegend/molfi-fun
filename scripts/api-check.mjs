#!/usr/bin/env node
/**
 * Exercise every route against a running console.
 *
 * The API is what a frontend is built on, so it needs to be checked as a whole rather than
 * one route at a time in a browser. This asks for the things a client actually asks for,
 * including the failures — a route that only works on the happy path is a route that will
 * strand whoever hits the other one.
 *
 * Usage: node --experimental-strip-types scripts/api-check.mjs [baseUrl]
 */

const base = process.argv[2] ?? "http://localhost:3400";
let failures = 0;

const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function get(path, expect = 200) {
  const res = await fetch(`${base}${path}`, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  check(res.status === expect, `GET ${path} → ${expect}`, res.status === expect ? "" : `got ${res.status}`);
  return body;
}

console.log(`\nmolfi API · ${base}\n`);

console.log("config");
const config = await get("/api/config");
check(Array.isArray(config?.markets) && config.markets.length > 0, "lists markets");
check(Array.isArray(config?.rounds) && config.rounds.length > 0, "lists rounds");
check(config?.units?.stakeDecimals === 18, "states the stake unit");
check(config?.rules?.minRoundSeconds >= 900, "no round is shorter than a publish interval");
check(
  config?.markets?.every((m) => m.rounds.every((r) => r.probTable.length === 17)),
  "publishes a full table for every round",
);

console.log("\nprice");
const price = await get("/api/price?market=BTC");
check(typeof price?.price === "string", "returns a mark");
check("oracle" in price, "reports the settlement oracle separately from the mark");
if (price?.oracle) {
  check(typeof price.oracle.sources === "number", "with a publisher count");
  check(typeof price.oracle.quotable === "boolean", "and a settleability verdict");
}
await get("/api/price?market=NOPE", 404);

const tape = await get("/api/price?market=BTC&history=1");
check((tape?.returns?.length ?? 0) > 100, "history returns real tape", `${tape?.returns?.length} samples`);
check(tape?.returnsInterval === "1m", "at the resolution the tables were fitted on");

console.log("\nquote");
const spot = price?.price ?? "7970000000000";
const q = await get(`/api/quote?market=BTC&tier=0&spot=${spot}&halfWidthPct=0.171&stake=10`);
check(q?.ok === true, "prices a one-sigma band");
check(BigInt(q?.multiplierBps ?? 0) > 10_000n, "above 1.00x", `${Number(q?.multiplierBps) / 10_000}x`);
check(
  BigInt(q?.stakeUnits ?? 0) === 10n * 10n ** 18n,
  "reads stake as whole STRK, not as raw units",
  q?.stakeUnits,
);
check(q?.window?.maxHalfWidthPct > q?.window?.minHalfWidthPct, "reports a sellable window");

const wide = await get(`/api/quote?market=BTC&tier=0&spot=${spot}&halfWidthPct=5&stake=10`);
check(wide?.ok === false && wide?.refusal === "too-cheap", "names a too-wide band", wide?.refusal);

const tight = await get(`/api/quote?market=BTC&tier=0&spot=${spot}&halfWidthPct=0.0001&stake=10`);
check(tight?.ok === false, "refuses a band tighter than the model can price", tight?.refusal);

await get(`/api/quote?market=BTC&tier=9&spot=${spot}&halfWidthPct=0.2`, 400);
await get(`/api/quote?market=BTC&tier=0&halfWidthPct=0.2`, 400);
const both = await fetch(`${base}/api/quote?market=BTC&tier=0&spot=${spot}&halfWidthPct=0.2&stake=1&stakeUnits=1`);
check(both.status === 400, "refuses stake given two ways at once", `got ${both.status}`);

console.log("\nmarkets");
const markets = await get("/api/markets");
check(typeof markets?.deployed === "boolean", "says whether the contract is deployed");
if (markets?.deployed && markets.markets.length > 0) {
  const m = markets.markets[0];
  check(typeof m.roundSeconds === "number", "each market records its round length");
  check("bankroll" in m && "reserved" in m, "and what backs it");

  console.log("\naudit");
  const audit = await get(`/api/audit/${m.id}`);
  // An open market has fewer checks than a settled one, and that is correct rather than a
  // shortfall — the price checks have no price to run against yet. Asserting a fixed count
  // made a correct audit of an open market look like a broken one.
  const settled = m.isSettled;
  check(
    Array.isArray(audit?.checks) && audit.checks.length >= (settled ? 10 : 7),
    `runs the checks a ${settled ? "settled" : "open"} market supports`,
    `${audit?.checks?.length} checks`,
  );
  check(
    settled
      ? audit.checks.some((c) => c.key === "price-was-fresh")
      : audit.checks.find((c) => c.key === "settled")?.verdict === "unchecked",
    settled
      ? "including the settlement price checks"
      : "and reports the unsettled market as unchecked rather than passed",
  );
  check(
    audit.checks.some((c) => c.key === "quote-is-reproducible"),
    "and reproduces the quote whether or not the market has settled",
  );
  check(
    audit?.checks?.every((c) => c.claim && c.matters && c.onChain && c.recomputed),
    "every check states what it compared and why it matters",
  );
  check(
    audit?.checks?.every((c) => ["ok", "failed", "unchecked"].includes(c.verdict)),
    "with a verdict that distinguishes unchecked from passed",
  );
  check((audit?.failed?.length ?? 1) === 0, "and the market is sound", (audit?.failed ?? []).join(", "));
  await get("/api/audit/999999", 404);
  await get("/api/audit/abc", 400);

  console.log("\nposition");
  const absent = await get("/api/position/0x1");
  check(absent?.exists === false, "an unopened commitment reads as absent, not as an error");
  await get("/api/position/nothex", 400);
} else {
  console.log("\n  (no deployment — audit and position checks skipped)");
}

console.log("\nhealth");
// 503 is a correct answer here, not a failure of the endpoint: it is what "something is
// genuinely down" looks like. Asserting 200 would mean the check only passes when the
// deployment is healthy, which is the opposite of what a health check is for.
const healthRes = await fetch(`${base}/api/health`, { cache: "no-store" });
const health = await healthRes.json();
check([200, 503].includes(healthRes.status), "GET /api/health answers", `got ${healthRes.status}`);
check(
  (healthRes.status === 503) === !health.ok,
  "and its status code agrees with its own verdict",
  `${healthRes.status} vs ok=${health.ok}`,
);
check(["ok", "degraded", "down"].includes(health?.chain?.status), "reports the node");
check(
  health?.oracle?.status === "absent" || health?.oracle?.pairs?.length > 0,
  "reports every pair's settleability, or says no oracle is configured",
  health?.oracle?.status,
);
check(
  ["ok", "degraded", "down", "absent"].includes(health?.market?.status),
  "distinguishes an absent contract from a broken one",
  health?.market?.status,
);

console.log("\nrpc");
const rpcOk = await fetch(`${base}/api/rpc`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "starknet_blockNumber" }),
});
check(rpcOk.status === 200, "forwards a read");
const rpcNo = await fetch(`${base}/api/rpc`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "starknet_addInvokeTransaction", params: [] }),
});
check(rpcNo.status === 403, "and refuses a write", `got ${rpcNo.status}`);

console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
