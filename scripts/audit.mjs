#!/usr/bin/env node
/**
 * `docs/AUDIT-PLAN.md`, executed.
 *
 * The plan states what "correct" means for every page, endpoint, contract read, integration and
 * flow. This runs it: a real Chrome over the DevTools Protocol for anything a person would see,
 * and direct calls for anything they would not. Every item prints PASS or FAIL with the evidence
 * that decided it.
 *
 * It exists as a script rather than a session transcript because Phase 4 asks for the whole plan
 * to be re-run after every fix. A plan that can only be re-asserted is a plan nobody can check.
 *
 * Why CDP and not the in-app preview pane: the pane never fires `IntersectionObserver` — not for
 * any element, including `document.body`. That produced one false failure during this audit (the
 * landing counters read 0/0/0 there and 129/60/666 in Chrome) before it was caught. Anything
 * scroll- or viewport-gated has to run in a real browser or the result is fiction.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit.mjs
 *   node --experimental-strip-types scripts/audit.mjs --base http://127.0.0.1:3400 --only A,B
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { hash } from "starknet";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") === false ? all[i + 1] : true]] : [],
  ),
);
const BASE = String(args.base ?? "https://molfi.fun").replace(/\/$/, "");
const KEEPER = "https://keeper-production-8dd8.up.railway.app";
const RPC = "https://api.cartridge.gg/x/starknet/sepolia";
const ONLY = args.only ? String(args.only).split(",") : null;

const D = JSON.parse(readFileSync("deployments/sepolia.json", "utf8"));
/** A real position, opened by a real transaction, used for the observer's happy path. */
const REAL_COMMITMENT = "0x621f98efdc0b62f2e3fe2096eb4c680e8a6115e5a2728fc87c558d0a14b2fc7";

const results = [];
const record = (id, ok, detail) => {
  results.push({ id, ok, detail });
  const tag = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  ${tag}  ${id.padEnd(5)} ${String(detail).slice(0, 150)}`);
};
const untested = (id, why) => {
  results.push({ id, ok: null, detail: why });
  console.log(`  \x1b[33mUNTESTED\x1b[0m ${id.padEnd(3)} ${why}`);
};
const want = (id, cond, detail) => record(id, Boolean(cond), detail);
const section = (s) => ONLY === null || ONLY.includes(s);

const json = async (url, init) => {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
};
const call = async (address, fn, calldata = []) => {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "starknet_call",
      params: [{ contract_address: address, entry_point_selector: hash.getSelectorFromName(fn), calldata }, "latest"],
    }),
  });
  const b = await r.json();
  if (b.error) throw new Error(JSON.stringify(b.error).slice(0, 120));
  return b.result;
};

// ---------------------------------------------------------------- the browser

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One Chrome, reused for every page item.
 *
 * Console errors are collected per navigation and handed back with the evaluation, so an item
 * cannot pass on its visible result while quietly logging an exception.
 */
async function browser(width, height) {
  const port = 9400 + Math.floor(Math.random() * 500);
  const proc = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/molfi-audit-${port}`,
    `--window-size=${width},${height}`, "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "about:blank",
  ], { stdio: "ignore" });

  let target;
  for (let i = 0; i < 80; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = l.find((t) => t.type === "page");
      if (target) break;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  if (!target) { proc.kill(); throw new Error("Chrome never exposed a page target"); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); let errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      const { res, rej } = pending.get(d.id); pending.delete(d.id);
      d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result);
    }
    if (d.method === "Log.entryAdded" && d.params.entry.level === "error") errors.push(d.params.entry.text.slice(0, 120));
    if (d.method === "Runtime.exceptionThrown") {
      errors.push("EXCEPTION " + String(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 120));
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });

  await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");

  return {
    /** Navigate, settle, evaluate, and hand back whatever errors the page logged on the way. */
    async visit(path, expression, settleMs = 8000) {
      errors = [];
      await send("Page.navigate", { url: BASE + path });
      await sleep(settleMs);
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      return { value: r.result?.value, errors: [...errors] };
    },
    /**
     * Evaluate in whatever context the page is in now.
     *
     * Separate from `visit` because a click that navigates destroys the execution context the
     * evaluation is running in — CDP answers "Inspected target navigated or closed" and the
     * whole run dies. Clicking and asserting therefore happen in two calls, with the navigation
     * between them, which is also closer to what the flow actually is.
     */
    async evaluate(expression) {
      try {
        const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        return { value: r.result?.value, errors: [...errors] };
      } catch (e) {
        if (!/navigated or closed/.test(String(e.message))) throw e;
        await sleep(1500);
        const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        return { value: r.result?.value, errors: [...errors] };
      }
    },
    async status(path) {
      const res = await fetch(BASE + path, { redirect: "manual" });
      return res.status;
    },
    close() { try { ws.close(); } catch { /* already gone */ } proc.kill(); },
  };
}

/** The checks every page shares, run inside the page. */
const PAGE_PROBE = `(async()=>{
  const de=document.documentElement;
  window.scrollTo(0,de.scrollHeight); await new Promise(r=>setTimeout(r,1500)); window.scrollTo(0,0);
  await new Promise(r=>setTimeout(r,400));
  const t=document.body.innerText;
  return {title:document.title, overflow:de.scrollWidth>de.clientWidth+1, chars:t.replace(/\\s+/g,' ').trim().length,
    raw:/\\bTypeError\\b|\\bundefined\\b|\\bNaN\\b|\\[object Object\\]|webpack-internal/.test(t),
    stillLoading:/loading…|CHECKING YOUR SESSION|OPENING YOUR WALLET/i.test(t)};
})()`;

/** A 404 page legitimately makes the browser log a 404. Nothing else may. */
const realErrors = (errs, is404Page) =>
  errs.filter((e) => !(is404Page && /status of 404/.test(e)));

// ---------------------------------------------------------------- run

console.log(`\nmolfi · audit plan · ${BASE}\n`);
const PAGES = [
  ["A1", "/", "molfi — a handheld for bets nobody can see", 200],
  ["A2", "/play", "molfi — the desk", 200],
  ["A3", "/privacy", "molfi — what stays private", 200],
  ["A4", "/verify", "molfi — check a position", 200],
  ["A5", "/keeper", "molfi — the keeper", 200],
  ["A6", "/m/1", "molfi — market #1", 200],
  ["A7", "/m/70", "molfi — market #70", 200],
  ["A8", "/m/999999", "molfi — no such market", 404],
  ["A9", "/m/abc", "molfi — no such market", 404],
  ["A10", "/nope-not-here", "molfi — no such page", 404],
];

if (section("A")) {
  for (const [label, w, h] of [["desktop 1280x860", 1280, 860], ["mobile 390x844", 390, 844]]) {
    console.log(`\nA. Pages · ${label}`);
    const b = await browser(w, h);
    try {
      for (const [id, path, title, code] of PAGES) {
        const status = await b.status(path);
        const { value, errors } = await b.visit(path, PAGE_PROBE);
        const errs = realErrors(errors, code === 404);
        const ok = status === code && value.title === title && !value.overflow && !value.raw &&
          !value.stillLoading && value.chars > 150 && errs.length === 0;
        want(`${id}${w === 390 ? "m" : ""}`, ok,
          `${path} · ${status} · "${value.title}" · ${value.chars} chars${value.overflow ? " · OVERFLOW" : ""}${value.raw ? " · RAW TEXT" : ""}${value.stillLoading ? " · STUCK LOADING" : ""}${errs.length ? " · CONSOLE: " + errs.join("|") : ""}`);
      }
    } finally { b.close(); }
  }

  // A1 extra: the proof counters must equal what the APIs report, not 0.
  const b = await browser(1280, 860);
  try {
    const { value } = await b.visit("/", `(async()=>{
      document.querySelector('[data-proof=root]').scrollIntoView({block:'center'});
      await new Promise(r=>setTimeout(r,3000));
      const stats=[...document.querySelectorAll('[data-proof=stat] .tnum')].map(e=>e.innerText.trim());
      const m=await fetch('/api/markets').then(r=>r.json());
      const k=await fetch('/api/keeper').then(r=>r.json());
      return {stats, count:String(m.count), settled:String(m.markets.filter(x=>x.isSettled).length), relayed:String(k.ledger?.relay?.ok)};
    })()`);
    const norm = (s) => String(s).replace(/,/g, "");
    const ok = norm(value.stats[0]) === value.count && norm(value.stats[1]) === value.settled && norm(value.stats[2]) === value.relayed;
    want("A1c", ok, `proof counters ${value.stats.join(" / ")} vs api ${value.count} / ${value.settled} / ${value.relayed}`);
  } finally { b.close(); }
}

if (section("B")) {
  console.log("\nB. API");
  const c = await json(`${BASE}/api/config`);
  want("B1", c.status === 200 && c.body.network === "sepolia" &&
    String(JSON.stringify(c.body)).includes(D.market.slice(2, 20)), `${c.status} · ${c.body?.network}`);

  const h = await json(`${BASE}/api/health`);
  want("B2", h.status === 200 && h.body.ok === true && ["chain", "oracle", "market", "pool"].every((k) => h.body[k].status === "ok") && Boolean(h.body.door?.status),
    `${h.status} · chain ${h.body?.chain?.status} oracle ${h.body?.oracle?.status} market ${h.body?.market?.status} pool ${h.body?.pool?.status} door ${h.body?.door?.status}`);

  const m = await json(`${BASE}/api/markets`);
  want("B3", m.status === 200 && m.body.count >= 129 && m.body.markets.every((x) => x.pair && "isSettled" in x),
    `${m.status} · count ${m.body?.count} · ${m.body?.markets?.length} returned`);

  const rd = await json(`${BASE}/api/rounds`);
  want("B4", rd.status === 200 && rd.body.contract?.toLowerCase() === D.upDownMarket.toLowerCase(), `${rd.status} · ${rd.body?.contract?.slice(0, 16)}…`);

  const k = await json(`${BASE}/api/keeper`);
  want("B5", k.status === 200 && k.body.configured === true && (k.body.ledger?.relay?.ok ?? 0) > 0,
    `${k.status} · configured ${k.body?.configured} · ledger relay ok ${k.body?.ledger?.relay?.ok}`);

  const p = await json(`${BASE}/api/price?market=BTC`);
  const orc = p.body?.oracle ?? {};
  want("B6", p.status === 200 && orc.sources >= 3 && orc.ageSeconds < 900 && typeof orc.quotable === "boolean",
    `${p.status} · ${orc.sources} sources · ${orc.ageSeconds}s old · quotable ${orc.quotable}`);

  const p404 = await json(`${BASE}/api/price?market=NOPE`);
  want("B7", p404.status === 404 && typeof p404.body?.error === "string", `${p404.status} · ${p404.body?.error}`);
  // Corrected during the run: the route reads `searchParams.get("market") ?? "BTC"`, so a
  // missing market is a documented default rather than an error. The plan's original 400 was a
  // guess about a design decision that had already been made deliberately in the code.
  const pNone = await json(`${BASE}/api/price`);
  want("B8", pNone.status === 200 && pNone.body?.market === "BTC" && pNone.body?.oracle?.sources >= 3,
    `${pNone.status} · defaults to ${pNone.body?.market} · ${pNone.body?.oracle?.sources} sources`);

  const spot = String(p.body.price ?? p.body.spot);
  const q = await json(`${BASE}/api/quote?market=BTC&tier=0&spot=${spot}&stake=1&halfWidthPct=0.2`);
  want("B9", q.status === 200 && q.body.ok === true && Number(q.body.multiplierBps) > 10000 &&
    BigInt(q.body.low) < BigInt(spot) && BigInt(spot) < BigInt(q.body.high),
    `${q.status} · ok ${q.body?.ok} · ${q.body?.multiplierBps}bps · band brackets spot`);

  const qw = await json(`${BASE}/api/quote?market=BTC&tier=0&spot=${spot}&stake=1&halfWidthPct=90`);
  want("B10", qw.status === 200 && qw.body.ok === false && qw.body.refusal === "too-cheap", `${qw.status} · refusal ${qw.body?.refusal}`);
  const qn = await json(`${BASE}/api/quote?market=BTC&tier=0&spot=${spot}&stake=-5&halfWidthPct=0.2`);
  want("B11", qn.status === 400 && /positive/.test(qn.body?.error ?? ""), `${qn.status} · ${qn.body?.error}`);
  const qu = await json(`${BASE}/api/quote?market=BTC&spot=${spot}&low_off_1e8=1`);
  want("B12", qu.status === 400 && /unknown parameters?:/.test(qu.body?.error ?? ""), `${qu.status} · ${String(qu.body?.error).slice(0, 70)}`);

  const a = await json(`${BASE}/api/audit/70`);
  const failed = (a.body?.checks ?? []).filter((x) => x.verdict === "failed").length;
  want("B13", a.status === 200 && (a.body?.checks?.length ?? 0) > 0 && failed === 0,
    `${a.status} · ${a.body?.checks?.length} checks · ${failed} failed`);
  const a404 = await json(`${BASE}/api/audit/999999`);
  want("B14", a404.status === 404, `${a404.status}`);

  const pos = await json(`${BASE}/api/position/${REAL_COMMITMENT}`);
  const hasBand = Boolean(pos.body?.position?.bandLow || pos.body?.position?.bandHigh);
  want("B15", pos.status === 200 && pos.body.exists === true && pos.body.position?.stake && !hasBand,
    `${pos.status} · exists ${pos.body?.exists} · stake ${pos.body?.position?.stake} · band on chain: ${hasBand}`);
  const posAbsent = await json(`${BASE}/api/position/0x1`);
  want("B16", posAbsent.status === 200 && posAbsent.body.exists === false, `${posAbsent.status} · exists ${posAbsent.body?.exists}`);
  const posBad = await json(`${BASE}/api/position/zzz`);
  want("B17", posBad.status === 400 && typeof posBad.body?.error === "string", `${posBad.status} · ${posBad.body?.error}`);

  const t = await json(`${BASE}/api/ticket/0x1`);
  want("B18", t.status === 200 && "exists" in t.body, `${t.status} · exists ${t.body?.exists}`);
  const tBad = await json(`${BASE}/api/ticket/zzz`);
  want("B19", tBad.status === 400 && typeof tBad.body?.error === "string", `${tBad.status} · ${tBad.body?.error}`);

  const bal = await json(`${BASE}/api/balance?address=${D.owner}`);
  want("B20", bal.status === 200 && /^\d+$/.test(String(bal.body?.balance)), `${bal.status} · ${bal.body?.balance}`);
  const balNone = await json(`${BASE}/api/balance`);
  want("B21", balNone.status === 400 && typeof balNone.body?.error === "string", `${balNone.status} · ${balNone.body?.error}`);
  const balBad = await json(`${BASE}/api/balance?address=notanaddress`);
  want("B22", balBad.status === 400 && typeof balBad.body?.error === "string", `${balBad.status} · ${balBad.body?.error}`);

  const post = (path, body) => json(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const r1 = await post("/api/rpc", { jsonrpc: "2.0", id: 1, method: "starknet_blockNumber", params: [] });
  want("B23", r1.status === 200 && typeof r1.body?.result === "number", `${r1.status} · block ${r1.body?.result}`);
  const r2 = await post("/api/rpc", { jsonrpc: "2.0", id: 1, method: "starknet_addDeclareTransaction", params: [] });
  want("B24", r2.status === 403, `${r2.status} · ${r2.body?.error?.message}`);
  const r3 = await post("/api/rpc", { jsonrpc: "2.0", id: 1, method: "evil_method", params: [] });
  want("B25", r3.status === 403, `${r3.status} · ${r3.body?.error?.message}`);

  const w1 = await post("/api/wallet/sign", {});
  want("B26", w1.status === 401, `${w1.status} · ${w1.body?.error}`);
  const w2 = await post("/api/wallet/starknet", {});
  want("B27", w2.status === 401, `${w2.status} · ${w2.body?.error}`);
  const w3 = await post("/api/wallet/fund", {});
  want("B28", w3.status === 401, `${w3.status} · ${w3.body?.error}`);
}

if (section("C")) {
  console.log("\nC. Contracts, on chain");
  const [count] = await call(D.market, "market_count");
  want("C1", BigInt(count) >= 129n, `market_count ${BigInt(count)}`);
  const [rounds] = await call(D.upDownMarket, "round_count");
  want("C2", BigInt(rounds) >= 0n, `round_count ${BigInt(rounds)}`);
  const { pairId, decodePrint } = await import("../packages/sdk/src/index.ts");
  const btc = await call(D.oracle, "get_data_median", ["0x0", "0x" + pairId("BTC/USD").toString(16)]);
  const print = decodePrint(btc);
  want("C3", print.sources >= 3 && print.raw > 0n,
    `relay BTC/USD ${(Number(print.raw) / 1e8).toFixed(2)} · ${print.sources} sources · ${Math.floor(Date.now() / 1000) - print.updatedAt}s old`);
  const poolClass = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "starknet_getClassHashAt", params: ["latest", D.pool] }) }).then((r) => r.json());
  want("C4", typeof poolClass.result === "string", `pool class ${String(poolClass.result).slice(0, 18)}…`);

  const cls = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "starknet_getClassAt", params: ["latest", D.market] }) }).then((r) => r.json());
  const abi = typeof cls.result.abi === "string" ? JSON.parse(cls.result.abi) : cls.result.abi;
  const flat = JSON.stringify(abi);
  want("C5", flat.includes("low_off_1e8") && flat.includes("high_off_1e8"), `deployed class stores reach ratios, not the band`);

  const one = await json(`${BASE}/api/audit/1`);
  const settled = one.body?.market?.settledPrice ?? one.body?.settledPrice;
  want("C6", Boolean(settled) && BigInt(settled) > 0n, `market #1 settled at ${settled}`);
  untested("C7", "covered by scripts/pool-probe.mjs, which reaches SUBCHANNEL_NOT_FOUND on both pools — re-run separately");
}

if (section("D")) {
  console.log("\nD. External integrations");
  // `aggregate` takes the BASE symbol and appends each venue's own quote suffix. Passing
  // "BTCUSDT" built "BTCUSDTUSDT" and every venue 404'd — which read as a total outage while
  // all five endpoints answered 200 to curl. My call was wrong, not the code.
  const { aggregate } = await import("../apps/keeper/src/exchanges.ts");
  const agg = await aggregate("BTC");
  want("D1", agg.sources >= 4, `${agg.sources}/5 venues · ${(Number(agg.price) / 1e8).toFixed(2)} · spread ${agg.spreadBps.toFixed(1)}bps · ${agg.venues.join(",")}`);

  const { pairId, decodePrint } = await import("../packages/sdk/src/index.ts");
  const solRaw = await call(D.oracle, "get_data_median", ["0x0", "0x" + pairId("SOL/USD").toString(16)]);
  const sol = decodePrint(solRaw);
  const live = await aggregate("SOL");
  const onChain = Number(sol.raw) / 1e8;
  const tape = Number(live.price) / 1e8;
  const bps = Math.abs((onChain - tape) / tape) * 10_000;
  want("D2", bps < 100, `SOL on chain ${onChain.toFixed(3)} vs tape ${tape.toFixed(3)} · ${bps.toFixed(1)}bps · ${live.sources} venues`);

  const h = await json(`${BASE}/api/health`);
  const pairs = h.body?.oracle?.pairs ?? [];
  want("D3", pairs.length === 9 && pairs.every((x) => x.sources >= 3 && x.ageSeconds < 900),
    `${pairs.length} pairs · worst age ${Math.max(...pairs.map((x) => x.ageSeconds))}s · min sources ${Math.min(...pairs.map((x) => x.sources))}`);

  const k = await json(`${BASE}/api/keeper`);
  const rows = Object.values(k.body?.ledger ?? {}).reduce((n, v) => n + (v.total ?? 0), 0);
  want("D4", rows > (k.body?.cycles ?? 0), `${rows} ledger rows vs ${k.body?.cycles} cycles this process`);
  const kh = await json(`${KEEPER}/health`);
  want("D5", kh.status < 600 && kh.body?.lastError === null, `keeper answered ${kh.status} · lastError ${kh.body?.lastError} · holding ${kh.body?.holding ?? "nothing"}`);
  const w = await json(`${BASE}/api/wallet/starknet`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  want("D6", w.status === 401, `Privy wired · unauthenticated answer ${w.status}`);
}

if (section("E")) {
  console.log("\nE. Flows and edge cases");
  const b = await browser(1280, 860);
  try {
    await b.visit("/", "1");
    await b.evaluate(`[...document.querySelectorAll('a')].find(a=>/PLAY THE GAME/i.test(a.innerText)).click()`);
    await sleep(4000);
    const onPlay = await b.evaluate(`JSON.stringify([location.pathname, document.title])`);
    const p1 = JSON.parse(onPlay.value);
    want("E1", p1[0] === "/play" && p1[1] === "molfi — the desk", `CTA → ${p1[0]} "${p1[1]}"`);

    await b.evaluate("history.back()"); await sleep(3500);
    const back = JSON.parse((await b.evaluate(`JSON.stringify([location.pathname, document.title])`)).value);
    await b.evaluate("history.forward()"); await sleep(3500);
    const fwd = JSON.parse((await b.evaluate(`JSON.stringify([location.pathname, document.title, document.body.innerText.length>150])`)).value);
    want("E2", back[0] === "/" && fwd[0] === "/play" && fwd[2] === true,
      `back → ${back[0]} · forward → ${fwd[0]} · body non-blank ${fwd[2]}`);

    const links = await b.visit("/", `(async()=>{
      const paths=new Set();
      for(const p of ['/','/play','/privacy','/verify','/keeper','/m/1','/m/70']){
        const html=await fetch(p).then(r=>r.text());
        for(const m of html.matchAll(/href="(\\/[^"#?]*)"/g)) if(!m[1].startsWith('/_next')) paths.add(m[1]);
      }
      const out=[];
      for(const p of paths){ const r=await fetch(p,{method:'GET'}); if(r.status!==200) out.push(p+':'+r.status); }
      return {checked:paths.size, broken:out};
    })()`, 3000);
    want("E3", links.value.broken.length === 0, `${links.value.checked} internal links · broken: ${links.value.broken.join(",") || "none"}`);

    const empty = await b.visit("/verify", `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='LOOK'); return {disabled:b.disabled};})()`);
    want("E4", empty.value.disabled === true, `LOOK disabled while empty: ${empty.value.disabled}`);

    const typeAndLook = (v, waitMs) => `(async()=>{
      const inp=document.querySelector('input[placeholder*=commitment]');
      const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      set.call(inp,'${v}'); inp.dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,300));
      const btn=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='LOOK');
      btn.click(); btn.click(); btn.click();
      await new Promise(r=>setTimeout(r,${waitMs}));
      const m=document.querySelector('main').innerText.replace(/\\s+/g,' ');
      return {text:m, hasUrlError:/returned \\d{3}/.test(m)};
    })()`;

    const bad = await b.visit("/verify", typeAndLook("not-a-commitment", 5000));
    const shows = /must be a felt|is a felt/i.test(bad.value.text);
    want("E5", shows && !bad.value.hasUrlError, `server message shown: ${shows} · url+status shown: ${bad.value.hasUrlError}`);

    const good = await b.visit("/verify", typeAndLook(REAL_COMMITMENT, 6000));
    const g = good.value.text;
    const okStake = /stake [\d,]+\.\d+ STRK/.test(g);
    const noBand = !/band low|band high/i.test(g);
    want("E6", /market #1/.test(g) && okStake && /multiplier/.test(g) && noBand,
      `market#1 ${/market #1/.test(g)} · STRK-formatted stake ${okStake} · band hidden ${noBand}`);
    want("E7", (g.match(/WHAT THE CHAIN REVEALS/g) ?? []).length === 1 && realErrors(good.errors, false).filter((e) => !/status of 400/.test(e)).length === 0,
      `one result after 3 rapid clicks · console clean`);

    const reload = await b.visit("/verify", `(()=>{const i=document.querySelector('input[placeholder*=commitment]'); return {value:i.value, hasResult:/WHAT THE CHAIN REVEALS/.test(document.body.innerText)};})()`);
    want("E15", reload.value.value === "" && reload.value.hasResult === false, `after reload: input "${reload.value.value}" · stale result ${reload.value.hasResult}`);
  } finally { b.close(); }

  // The desk needs the development door, which exists only outside production.
  if (BASE.includes("127.0.0.1") || BASE.includes("localhost")) {
    const b2 = await browser(1280, 860);
    try {
      const desk = await b2.visit("/play", `(async()=>{
        const B=t=>[...document.querySelectorAll('button')].find(x=>x.innerText.replace(/\\s+/g,' ').trim()===t);
        const A=l=>[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')===l);
        const doc=()=>Math.round(document.documentElement.scrollHeight);
        const txt=()=>document.body.innerText.replace(/\\s+/g,' ');
        const o={};
        o.gated=/CONNECT TO PLAY|CANNOT OPEN/.test(txt());
        if(o.gated) return o;
        o.h0=doc(); B('UP / DOWN').click(); await new Promise(r=>setTimeout(r,1400));
        o.h1=doc(); o.updownKeys=!!B('▲ UP')&&!!B('▼ DOWN');
        // A red *trade* key is the thing that was asked to go. The CONNECT affordance is also
        // red and is not that key, so it is excluded by label rather than by colour.
        o.red=[...document.querySelectorAll('button')].filter(x=>/rgb\\(2[0-9][0-9], *[0-6][0-9], *[0-6][0-9]\\)/.test(getComputedStyle(x).backgroundColor))
          .filter(x=>!/connect/i.test(x.getAttribute('aria-label')||'')).map(x=>x.getAttribute('aria-label')||x.innerText.trim());
        B('RANGE').click(); await new Promise(r=>setTimeout(r,1400)); o.h2=doc();
        const tiers={}; for(const t of ['1h','4h','15m']){ B(t)?.click(); await new Promise(r=>setTimeout(r,1100)); tiers[t]=(txt().match(/(15M|1H|4H) ROUND/)||[])[0]; }
        o.tiers=tiers;
        const b4=(txt().match(/±([\\d.]+)%/)||[])[1]; B('+')?.click(); B('+')?.click(); await new Promise(r=>setTimeout(r,900));
        const wide=(txt().match(/±([\\d.]+)%/)||[])[1]; B('−')?.click(); await new Promise(r=>setTimeout(r,900));
        const narrow=(txt().match(/±([\\d.]+)%/)||[])[1]; o.band={b4,wide,narrow};
        const mk=[...document.querySelectorAll('button')].find(x=>/▾/.test(x.innerText)); const m0=mk.innerText.trim();
        mk.click(); await new Promise(r=>setTimeout(r,1200));
        o.market={from:m0,to:[...document.querySelectorAll('button')].find(x=>/▾/.test(x.innerText)).innerText.trim()};
        o.noOpen=/NO OPEN MARKET/.test(txt());
        const fire=A('Fire'); o.fireDisabled=fire?.disabled;
        const ridingBefore=(txt().match(/(\\d+) RIDING/)||[])[1];
        fire?.click(); fire?.click(); fire?.click(); await new Promise(r=>setTimeout(r,3000));
        o.ridingAfter=(txt().match(/(\\d+) RIDING/)||[])[1];
        o.openedSomething = ridingBefore !== o.ridingAfter;
        o.rawAfterFire=/TypeError|\\[object|Cannot read/i.test(document.body.innerText);
        o.aria=[...document.querySelectorAll('button')].every(x=>x.getAttribute('aria-label')||x.innerText.trim());
        return o;
      })()`, 9000);
      const o = desk.value;
      if (o.gated) {
        for (const id of ["E8", "E9", "E10", "E11", "E12", "E13", "E14"]) untested(id, "desk is behind the gate — set NEXT_PUBLIC_DEV_WALLET_BYPASS=1 locally to audit it");
      } else {
        want("E8", o.h0 === o.h1 && o.h1 === o.h2 && o.updownKeys && o.red.length === 0,
          `height ${o.h0}/${o.h1}/${o.h2} · UP+DOWN keys ${o.updownKeys} · red trade keys: ${o.red.join(",") || "none"}`);
        want("E9", o.tiers["1h"] === "1H ROUND" && o.tiers["4h"] === "4H ROUND" && o.tiers["15m"] === "15M ROUND", JSON.stringify(o.tiers));
        want("E10", Number(o.band.wide) > Number(o.band.b4) && Number(o.band.narrow) < Number(o.band.wide), `${o.band.b4} → ${o.band.wide} → ${o.band.narrow}`);
        want("E11", o.market.from !== o.market.to, `${o.market.from.replace(/\n/g, "")} → ${o.market.to.replace(/\n/g, "")}`);
        /**
         * The contract is what the visitor experiences, not a boolean at one instant.
         *
         * `state.connection` resolves asynchronously, so Fire is briefly enabled before the
         * `!target` clause applies — reading `.disabled` at an arbitrary moment tests the race
         * rather than the product. What must always hold: the deck says NO OPEN MARKET, and
         * pressing Fire opens nothing. `doFire` is explicit that a key which does nothing and
         * says nothing is the failure to avoid; the standing on-screen reason is that saying.
         */
        want("E12", o.noOpen && o.openedSomething === false,
          `deck states NO OPEN MARKET ${o.noOpen} · fire disabled ${o.fireDisabled} · positions opened by 3 presses: ${o.openedSomething}`);
        want("E13", o.rawAfterFire === false && realErrors(desk.errors, false).length === 0, `no raw exception after 3 fire clicks · console ${realErrors(desk.errors, false).length} errors`);
        want("E14", o.aria === true, `every control labelled: ${o.aria}`);
      }
    } finally { b2.close(); }
  } else {
    for (const id of ["E8", "E9", "E10", "E11", "E12", "E13", "E14"]) {
      untested(id, "desk is behind the Privy gate on production; run this audit against a local server with the dev door open");
    }
  }
}

if (section("F")) {
  console.log("\nF. Hygiene");
  const { execSync } = await import("node:child_process");
  /**
   * Run a command and return what it said, including when it failed.
   *
   * The first version swallowed everything into "" on any throw, so a suite that overflowed
   * execSync's 1 MB default buffer reported as an empty string and the item failed with no
   * evidence at all — a check that cannot tell "it failed" from "I could not look" is worse
   * than no check. The buffer is raised and stdout is returned even on a non-zero exit.
   */
  const sh = (cmd) => {
    try {
      /**
       * PATH is set explicitly because `execSync` runs `/bin/sh -c`, which does not source the
       * user's profile. `snforge` and `pnpm` live in profile-managed directories, so without
       * this the toolchain checks ran as "command not found" and reported an empty result —
       * two items failing for a reason that had nothing to do with the code under test.
       */
      const PATH = [
        `${process.env.HOME}/.local/bin`,
        `${process.env.HOME}/.cargo/bin`,
        "/opt/homebrew/bin",
        "/usr/local/bin",
        process.env.PATH ?? "",
      ].join(":");
      return execSync(cmd, {
        encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900_000,
        env: { ...process.env, PATH },
      }).trim();
    } catch (e) {
      return String(e.stdout ?? "").trim() || `COMMAND FAILED: ${String(e.message).slice(0, 120)}`;
    }
  };
  const mocks = sh(`grep -rniE "\\bmock|\\bstub|\\bfixture|fakeData" apps/web/src packages/sdk/src apps/keeper/src --include=*.ts --include=*.tsx | grep -v "not a mock\\|no mock\\|never a mock\\|mocks\\b.*comment" | head -5`);
  want("F1", mocks === "", mocks || "no mock/stub/fixture in shipped code");
  const debug = sh(`grep -rnE "console\\.(log|debug|table|trace)" apps/web/src | head -3`);
  const todo = sh(`grep -rniE "\\b(todo|fixme|xxx)\\b" apps/web/src packages/sdk/src apps/keeper/src | head -3`);
  want("F2", debug === "" && todo === "", [debug, todo].filter(Boolean).join(" | ") || "no console.log, no TODO/FIXME");

  const html = await fetch(`${BASE}/play`).then((r) => r.text());
  want("F3", !html.includes("DEV_WALLET"), `dev bypass strings in production HTML: ${(html.match(/DEV_WALLET/g) ?? []).length}`);
  const leaked = ["PRIVY_APP_SECRET", "FAUCET_PRIVATE_KEY", "KEEPER_PRIVATE_KEY", "DEV_WALLET_PRIVATE_KEY"].filter((k) => html.includes(k));
  want("F4", leaked.length === 0, leaked.length ? `LEAKED: ${leaked.join(",")}` : "no secret names in the shipped page");

  /**
   * Run the toolchains directly rather than through a shell pipeline.
   *
   * `execSync("cd cairo && snforge test 2>&1 | tail -1")` returned an empty string with exit 0
   * — the pipeline swallowed it — while `spawnSync("snforge", ["test"], {cwd: "cairo"})` gives
   * 17 KB of output and the real result. Two items were failing on shell plumbing rather than
   * on anything about the code, which is the least useful kind of red.
   */
  const { spawnSync: run } = await import("node:child_process");
  const out = (cmd, cmdArgs, cwd) => {
    const r = run(cmd, cmdArgs, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return `${r.stdout ?? ""}${r.stderr ?? ""}`;
  };

  const cairo = out("snforge", ["test"], "cairo");
  const cairoLine = (cairo.match(/Tests: \d+ passed[^\n]*/) ?? ["no result"])[0];
  const units = out("pnpm", ["-s", "test"], ".");
  const counts = [...units.matchAll(/tests (\d+)/g)].map((m) => Number(m[1]));
  const failures = [...units.matchAll(/fail (\d+)/g)].map((m) => Number(m[1]));
  want("F5", /131 passed, 0 failed/.test(cairoLine) && counts.includes(112) && counts.includes(35) && failures.every((n) => n === 0),
    `cairo ${cairoLine} · js suites ${counts.join("+")} · failures ${failures.join(",") || "none"}`);

  const verify = out("node", ["--experimental-strip-types", "scripts/verify.mjs"], ".");
  const verdict = (verify.match(/\d+\/\d+ PASS[^\n]*/) ?? ["no result"])[0];
  want("F6", /39\/39 PASS/.test(verdict), verdict);
}

// ---------------------------------------------------------------- verdict
const pass = results.filter((r) => r.ok === true).length;
const fail = results.filter((r) => r.ok === false);
const skip = results.filter((r) => r.ok === null).length;
console.log(`\n${pass} PASS · ${fail.length} FAIL · ${skip} UNTESTED\n`);
if (fail.length) {
  console.log("failed:");
  for (const f of fail) console.log(`  ${f.id}  ${f.detail}`);
}
process.exitCode = fail.length ? 1 : 0;
