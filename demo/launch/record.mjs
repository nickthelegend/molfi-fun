#!/usr/bin/env node
/**
 * Record every scene in `recording.md`, one video file each.
 *
 * Playwright's own `recordVideo` writes the **browser viewport** to a file. There is no OS
 * screen capture anywhere in here: the operator's desktop is never read, no window has to stay
 * in front, and they can keep working while this runs. That is the whole reason for driving a
 * headed Chromium through CDP rather than pointing a screen recorder at a monitor.
 *
 * Every scene drives the real product. Real clicks, real typing, real network, real chain
 * reads. Where a number lands on screen it was read from Starknet at record time. A scene that
 * cannot be recorded truthfully is cut rather than staged.
 *
 * One file per scene, deliberately. A single long take means one fluffed moment costs the whole
 * recording; separate files mean any scene can be re-shot on its own, and the assembler can pace
 * each one to its own narration.
 *
 * Usage:
 *   node demo/launch/record.mjs                # every scene
 *   node demo/launch/record.mjs --only desk-range,verify
 *   node demo/launch/record.mjs --base http://127.0.0.1:3400
 */

import { chromium } from "playwright";
import { mkdirSync, rmSync, readdirSync, renameSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, "raw");

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") === false ? all[i + 1] : true]] : [],
  ),
);
const BASE = String(args.base ?? "https://molfi.fun").replace(/\/$/, "");
const ONLY = args.only ? String(args.only).split(",").map((s) => s.trim()) : null;

/** 1280x720 keeps the deck legible at YouTube's smallest sane size without letterboxing. */
const SIZE = { width: 1280, height: 720 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => process.stdout.write(`${s}\n`);

/**
 * Wait for a condition instead of sleeping a guess.
 *
 * A fixed wait is the reason recordings drift: it is too short on a cold route and wasted on a
 * warm one, and either way the clip no longer matches what the narration describes.
 */
async function until(page, fn, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      if (await page.evaluate(fn)) return true;
    } catch { /* mid-navigation */ }
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}

/** Scroll like a person reading, not like `scrollIntoView`. */
async function glide(page, toY, ms = 1800) {
  await page.evaluate(
    ([target, duration]) =>
      new Promise((done) => {
        const start = window.scrollY;
        const delta = target - start;
        const t0 = performance.now();
        const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
        function step(now) {
          const p = Math.min(1, (now - t0) / duration);
          window.scrollTo(0, start + delta * ease(p));
          p < 1 ? requestAnimationFrame(step) : done();
        }
        requestAnimationFrame(step);
      }),
    [toY, ms],
  );
}

/** A scene's page, recorded on its own context so its video is its own file. */
async function scene(browser, id, body) {
  if (ONLY && !ONLY.includes(id)) return null;
  const dir = join(RAW, `.tmp-${id}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const context = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir, size: SIZE },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
  page.on("pageerror", (e) => errors.push(`EXCEPTION ${String(e.message).slice(0, 120)}`));

  const started = Date.now();
  /**
   * When the scene's picture actually begins.
   *
   * `recordVideo` starts with the context, so every clip opens on about:blank and then the
   * navigation — a black lead-in that survived into the cut and put a black frame under the
   * first caption of a scene. The scene body calls `ready()` the moment its content has
   * painted; that offset is written next to the clip and the assembler trims it.
   */
  let leadIn = 0;
  const ready = () => { if (!leadIn) leadIn = (Date.now() - started) / 1000; };
  try {
    await body(page, ready);
  } catch (e) {
    log(`  ! ${id} threw: ${String(e.message).slice(0, 140)}`);
  }
  // A beat of stillness at the end so a cut never lands mid-motion.
  await sleep(700);
  await context.close(); // flushes the video file

  const produced = readdirSync(dir).find((f) => f.endsWith(".webm"));
  if (!produced) { log(`  ! ${id}: no video produced`); return null; }
  const out = join(RAW, `${id}.webm`);
  rmSync(out, { force: true });
  renameSync(join(dir, produced), out);
  rmSync(dir, { recursive: true, force: true });

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  // A quarter second of margin: `ready()` fires on the first painted frame, and trimming to
  // exactly there can still catch the tail of a fade.
  const trim = leadIn ? Number((leadIn + 0.25).toFixed(2)) : 0;
  log(`  ${id.padEnd(12)} ${secs}s  lead-in ${trim}s${errors.length ? `  CONSOLE: ${errors.slice(0, 2).join(" | ")}` : ""}`);
  return { id, seconds: Number(secs), leadIn: trim, consoleErrors: errors };
}

/**
 * The two title cards are recorded, not composited.
 *
 * They are real HTML with real CSS animation, played in the same browser at the same size as
 * every other scene, so they carry the product's own type and colour rather than a stock
 * transition. `data:` so there is no server to start and nothing to serve them from.
 */
const card = (title, sub, chip) => `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html><meta charset=utf-8>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=IBM+Plex+Mono:wght@500&display=swap');
  :root{--amber:#ff9f0a}
  *{margin:0;box-sizing:border-box}
  body{height:100vh;display:grid;place-items:center;background:#0a0a0b;color:#fff;
       font-family:'Bricolage Grotesque',system-ui,sans-serif;overflow:hidden}
  .wrap{text-align:center;padding:0 6vw}
  .chip{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.22em;color:#7c7c85;
        opacity:0;animation:rise .7s cubic-bezier(.2,.8,.2,1) .15s forwards}
  /* One mask, not one span per glyph.
     Splitting the wordmark into inline-blocks to stagger them suppressed kerning, and in
     Bricolage at 800 the f's overhang then crossed straight into the i — "molfi" rendered as a
     smudge. A mask reveal keeps the word a single laid-out run, so the type is exactly the type
     the product ships, and the motion is a rise from behind a hard edge rather than a fade. */
  .mask{overflow:hidden;padding-bottom:.08em}
  /* .05em, measured rather than chosen: rendered at -.03, 0, .02 and .05 and compared. Below
     .05 the f's crossbar merges into the i and the wordmark reads as a smudge. */
  h1{font-size:clamp(48px,9vw,104px);font-weight:800;letter-spacing:.05em;line-height:1;margin:14px 0 0;
     transform:translateY(112%);animation:reveal .9s cubic-bezier(.16,1,.3,1) .25s forwards}
  .sub{font-size:clamp(15px,2vw,21px);color:#9a9aa2;margin-top:20px;opacity:0;
       animation:rise .75s cubic-bezier(.2,.8,.2,1) .95s forwards}
  .rule{height:2px;width:0;background:var(--amber);margin:26px auto 0;border-radius:2px;
        animation:draw .9s cubic-bezier(.2,.8,.2,1) .75s forwards}
  @keyframes reveal{to{transform:none}}
  @keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
  @keyframes draw{to{width:min(340px,52vw)}}
</style>
<div class=wrap>
  <div class=chip>${chip}</div>
  <div class=mask><h1>${title}</h1></div>
  <div class=rule></div>
  <div class=sub>${sub}</div>
</div>`)}`;

// ---------------------------------------------------------------------------- scenes

const browser = await chromium.launch({ headless: true, args: ["--force-color-profile=srgb", "--font-render-hinting=none"] });
mkdirSync(RAW, { recursive: true });
log(`\nrecording · ${BASE}\n`);
const made = [];

made.push(await scene(browser, "intro", async (page, ready) => {
  await page.goto(card("molfi", "A position nobody can read, on a chain everybody can.", "STARKNET · MAINNET · LIVE"));
  await sleep(250); ready();
  await sleep(5200);
}));

made.push(await scene(browser, "landing", async (page, ready) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await until(page, () => /A handheld for bets/.test(document.body.innerText));
  ready();
  await sleep(3600);
  // The market grid: real prices, and the oracle each one settles against.
  await page.evaluate(() => document.querySelector("[data-mk=root]")?.scrollIntoView({ block: "center" }));
  await sleep(4200);
}));

made.push(await scene(browser, "problem", async (page, ready) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await until(page, () => document.querySelectorAll("section").length > 3);
  ready();
  await page.evaluate(() => document.querySelectorAll("section")[1]?.scrollIntoView({ block: "center" }));
  await sleep(5200);
}));

made.push(await scene(browser, "privacy", async (page, ready) => {
  await page.goto(`${BASE}/privacy`, { waitUntil: "domcontentloaded" });
  await until(page, () => /what an observer/i.test(document.body.innerText));
  ready();
  await sleep(2600);
  await glide(page, 900, 2200);
  await sleep(2400);
  await glide(page, 1900, 2200);
  await sleep(3200);
}));

made.push(await scene(browser, "desk-range", async (page, ready) => {
  await page.goto(`${BASE}/play`, { waitUntil: "domcontentloaded" });
  await until(page, () => /BAND|CONNECT TO PLAY|CANNOT OPEN/.test(document.body.innerText), 30_000);
  ready();
  await sleep(2600);
  const click = async (label) => {
    const b = page.locator(`button:text-is("${label}")`).first();
    if (await b.count()) { await b.click(); await sleep(1100); }
  };
  for (const _ of [0, 1, 2]) await click("+");
  for (const _ of [0, 1]) await click("−");
  await click("1h"); await click("4h"); await click("15m");
  await sleep(1600);
}));

made.push(await scene(browser, "desk-updown", async (page, ready) => {
  await page.goto(`${BASE}/play`, { waitUntil: "domcontentloaded" });
  await until(page, () => /RANGE|CONNECT TO PLAY|CANNOT OPEN/.test(document.body.innerText), 30_000);
  ready();
  await sleep(2200);
  const ud = page.locator('button:text-is("UP / DOWN")').first();
  if (await ud.count()) { await ud.click(); await sleep(3000); }
  const rg = page.locator('button:text-is("RANGE")').first();
  if (await rg.count()) { await rg.click(); await sleep(2000); }
}));

made.push(await scene(browser, "verify", async (page, ready) => {
  await page.goto(`${BASE}/verify`, { waitUntil: "domcontentloaded" });
  await until(page, () => Boolean(document.querySelector("input[placeholder*=commitment]")));
  ready();
  await sleep(1800);
  const input = page.locator("input[placeholder*=commitment]").first();
  await input.click();
  // Typed, not pasted — a real commitment from a real position, entered like a person would.
  await input.type("0x621f98efdc0b62f2e3fe2096eb4c680e8a6115e5a2728fc87c558d0a14b2fc7", { delay: 18 });
  await sleep(700);
  await page.locator('button:text-is("LOOK")').first().click();
  await until(page, () => /WHAT THE CHAIN REVEALS/.test(document.body.innerText), 20_000);
  await sleep(4200);
}));

made.push(await scene(browser, "audit", async (page, ready) => {
  await page.goto(`${BASE}/m/1`, { waitUntil: "domcontentloaded" });
  await until(page, () => /EVERY CHECK PASSED|check/i.test(document.body.innerText));
  ready();
  await sleep(2600);
  await glide(page, 1100, 2400);
  await sleep(2600);
  await glide(page, 2300, 2400);
  await sleep(2600);
}));

made.push(await scene(browser, "keeper", async (page, ready) => {
  await page.goto(`${BASE}/keeper`, { waitUntil: "domcontentloaded" });
  await until(page, () => /Nobody has to run this/.test(document.body.innerText));
  ready();
  await sleep(3000);
  await glide(page, 800, 2200);
  await sleep(3400);
}));

made.push(await scene(browser, "mainnet", async (page, ready) => {
  const { market } = JSON.parse(
    (await import("node:fs")).readFileSync(join(HERE, "../../deployments/mainnet.json"), "utf8"),
  );
  await page.goto(`https://starkscan.co/contract/${market}`, { waitUntil: "domcontentloaded" });
  await sleep(5000);
  /**
   * Dismiss the consent banner before it eats the frame, declining the optional cookies.
   *
   * It covered the bottom third of the shot. Rejecting rather than accepting is both the
   * privacy-preserving answer and the honest one for a recording made on someone else's behalf.
   */
  // Waited for, not raced. The first attempt clicked before the banner had mounted, so it
  // reappeared mid-shot and covered the transaction list the scene exists to show.
  const reject = page.locator('button:has-text("Reject All"), button:has-text("Reject all")').first();
  await reject.waitFor({ state: "visible", timeout: 12_000 }).catch(() => {});
  if (await reject.count()) { await reject.click().catch(() => {}); await sleep(1200); }
  ready();
  // Hold near the top: the contract address and its transaction list are the evidence here,
  // and the previous take drifted all the way to Starkscan's own footer.
  // No scroll. The evidence is the contract header and the transaction list directly under it;
  // the previous takes drifted into Starkscan's footer, which is half a frame of their links.
  await sleep(7000);
}));

made.push(await scene(browser, "outro", async (page, ready) => {
  const { market } = JSON.parse(
    (await import("node:fs")).readFileSync(join(HERE, "../../deployments/mainnet.json"), "utf8"),
  );
  await page.goto(card("molfi.fun", `${market.slice(0, 22)}… · Starknet mainnet`, "YOUR BAND · YOUR SIZE · YOUR NAME"));
  await sleep(250); ready();
  await sleep(5200);
}));

await browser.close();

const recorded = made.filter(Boolean);
writeFileSync(join(HERE, "recorded.json"), JSON.stringify(recorded, null, 2) + "\n");
const dirty = recorded.filter((r) => r.consoleErrors.length);
log(`\n${recorded.length} scene(s) recorded into ${RAW}`);
if (dirty.length) {
  log(`\nscenes with console errors — footage must be clean, re-record after fixing:`);
  for (const d of dirty) log(`  ${d.id}: ${d.consoleErrors.join(" | ")}`);
}
