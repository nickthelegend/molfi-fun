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
import { mkdirSync, rmSync, readdirSync, renameSync, existsSync, writeFileSync, readFileSync } from "node:fs";
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
/**
 * Where the *desk* is recorded, which is not always where the site is.
 *
 * Production gates `/play` behind a Privy login, so pointing the camera at it records the front
 * door. The console itself is the same build reading the same chain; it just needs a wallet, and
 * locally the repo's development door supplies one. Everything on screen — markets, prices,
 * quotes, the multiplier — is still read live from Starknet.
 */
const DESK_BASE = String(args["desk-base"] ?? BASE).replace(/\/$/, "");
/**
 * This take's own transactions, or nothing.
 *
 * Written by `scripts/trade.mjs` when it opens the position and again when it claims. The
 * recorder reads the hashes from here rather than holding constants, and refuses to run
 * without the file — the failure mode being guarded against is a beat that films *a* real
 * transaction under narration describing *this* trade, which looks perfect and is a lie.
 */
const TAKE = (() => {
  const at = join(HERE, "take-txs.json");
  if (!existsSync(at)) {
    throw new Error(
      "NO_TAKE_TXS: demo/launch/take-txs.json is missing. Open a position with " +
        "`node --experimental-strip-types scripts/trade.mjs --network sepolia --account molfi_trader --stake 1` " +
        "first; the recorder will not film a trade it cannot name.",
    );
  }
  const t = JSON.parse(readFileSync(at, "utf8"));
  for (const k of ["open", "commitment", "marketId", "explorer"]) {
    if (!t[k]) throw new Error(`NO_TAKE_TXS: take-txs.json has no "${k}"`);
  }
  return t;
})();

const ONLY = args.only ? String(args.only).split(",").map((s) => s.trim()) : null;

/** The running order, so a merged log keeps the cut's sequence rather than run order. */
const SCENE_ORDER = [
  "intro", "landing", "problem",
  "deck-open", "deck-band", "deck-pays",
  "trade-live", "riding", "trade", "verify", "settle", "payout", "keeper", "mainnet", "outro",
];

/** 1280x720 keeps the deck legible at YouTube's smallest sane size without letterboxing. */
const SIZE = { width: 1280, height: 720 };

/**
 * The picture is captured at twice the layout, so a close-up costs nothing.
 *
 * The console is a portrait handheld capped at 460 CSS pixels wide. In a 16:9 frame that is
 * about 30% of the width, and the first cut proved what that looks like: a device too small to
 * read, marooned in background pattern, while the narration described numbers nobody could see.
 *
 * A portrait object cannot fill a landscape frame, so the answer is to stop trying to hold the
 * whole object and crop into it. Cropping a 1280x720 recording would mean upscaling a 400-pixel
 * region by three and shipping mush. Recording the same viewport at 2560x1440 instead makes
 * every CSS pixel two video pixels, so a 1280x720 crop is *native* — no scaling at all — and the
 * console lands at 68% of the frame instead of 30%.
 *
 * The page still lays out at 1280 CSS. Nothing about the product changes; only the camera.
 */
const VIDEO = { width: SIZE.width * 2, height: SIZE.height * 2 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => process.stdout.write(`${s}\n`);

/**
 * Wait for a condition instead of sleeping a guess.
 *
 * A fixed wait is the reason recordings drift: it is too short on a cold route and wasted on a
 * warm one, and either way the clip no longer matches what the narration describes.
 */
async function until(page, fn, timeout = 25_000, arg = undefined) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      if (await page.evaluate(fn, arg)) return true;
    } catch { /* mid-navigation */ }
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}

/**
 * Refuse to film the wrong screen.
 *
 * The first take marked both desk beats on the words CONNECT TO PLAY, because the readiness
 * check listed the gate as an acceptable state. It rolled, every control click found nothing and
 * was skipped by a `count()` guard, and the cut narrated "pick a band" over a login card. A wait
 * that accepts the wrong screen is worse than no wait: it fails silently and only the finished
 * video shows it. This throws instead, and the scene is reported as failed rather than shipped.
 */
async function mustSee(page, label, fn, timeout = 30_000, arg = undefined) {
  if (!(await until(page, fn, timeout, arg))) {
    const seen = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 120)).catch(() => "?");
    throw new Error(`never reached "${label}" — screen said: ${seen}`);
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
async function scene(browser, id, body, opts = {}) {
  if (ONLY && !ONLY.includes(id)) return null;
  const dir = join(RAW, `.tmp-${id}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  /**
   * A scene may ask for a taller viewport than the frame it will end up in.
   *
   * The console is 830 CSS pixels tall and a 720-tall viewport cut its bottom off — the payout
   * panel, which is the number the narration is about, was below the fold in every desk take.
   * Giving those scenes a taller page and cropping back to 16:9 afterwards shows the whole
   * device *and* lets the crop choose which part of it the frame holds.
   */
  const view = { width: opts.width ?? SIZE.width, height: opts.height ?? SIZE.height };
  const context = await browser.newContext({
    viewport: view,
    /*
      The video is exactly the viewport. Asking `recordVideo` for a larger `size` than the
      viewport does not supersample — it renders the page at the viewport and pads the rest of
      the canvas grey. A crop computed against the larger number then lands on the padding, and
      the first frame of the test cut was two thirds empty background with the console sliced
      down the middle. Size follows the viewport, and resolution is bought with `zoom` instead.
    */
    recordVideo: { dir, size: view },
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const errors = [];
  /*
    Console errors from the product, not from the internet.

    The rule is that footage must be clean, and it is worth keeping — a scene recorded over a
    failing page is a scene of a broken product. But the bypass wallet used for recording has
    no Privy session, so Privy's own endpoint answers 403 on every take, and a guard that
    cannot be satisfied is a guard everybody learns to ignore. Third-party origins are recorded
    separately and reported, without failing the take; anything from molfi still fails it.
  */
  const foreign = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text().slice(0, 160);
    const from = m.location?.()?.url ?? "";
    const ours = !from || from.startsWith(BASE) || from.startsWith(DESK_BASE);
    (ours ? errors : foreign).push(text);
  });
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
  let failure = null;
  const ready = () => { if (!leadIn) leadIn = (Date.now() - started) / 1000; };

  /**
   * Aim the frame at a real element, in that element's own measured position.
   *
   * The crop is computed from `getBoundingClientRect` at record time rather than typed in as
   * pixel constants, so it cannot drift when the layout changes — a hand-written crop that is
   * fifty pixels stale points the camera at the bezel instead of the screen, and the first
   * anyone knows is in the finished cut.
   *
   * `w`/`h` are the 16:9 window to hold, in CSS pixels; the box is centred inside it and
   * clamped to the page so the crop never runs off the edge into black.
   */
  /**
   * Kept as a no-op so scenes can still name what they are pointing at.
   *
   * This used to zoom the page and crop a window onto the console, which made the device big
   * by hiding most of it: the finished cut held a middle slice with the price cut off the top
   * and the payout cut off the bottom, and travelled down it like a scroll. The frame was full
   * of console and showed the interface not at all.
   *
   * A portrait handheld cannot fill a landscape frame on its own — that is arithmetic, not
   * framing — so the fix belonged in the product, not the camera. The desk now puts real
   * panels either side of the console on a wide screen, so a plain full-viewport recording
   * holds the whole interface at a readable size and nothing is cut off anything.
   */
  const frame = async () => {};

  try {
    await body(page, ready, frame);
  } catch (e) {
    failure = String(e.message).slice(0, 160);
    log(`  ! ${id} FAILED: ${failure}`);
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
  log(`  ${id.padEnd(12)} ${secs}s  lead-in ${trim}s${errors.length ? `  CONSOLE: ${errors.slice(0, 2).join(" | ")}` : ""}${foreign.length ? `  (${foreign.length} third-party)` : ""}`);
  return { id, seconds: Number(secs), leadIn: trim, consoleErrors: errors, failure };
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
  await sleep(5200);
  // The market grid: real prices, and the oracle each one settles against. Glided rather than
  // snapped — a cut that jumps position reads as an edit, and this is one continuous look.
  const gridY = await page.evaluate(() => {
    const el = document.querySelector("[data-mk=root]");
    return el ? el.getBoundingClientRect().top + window.scrollY - 80 : 900;
  });
  await glide(page, gridY, 2600);
  await sleep(7000);
}));

made.push(await scene(browser, "problem", async (page, ready) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await until(page, () => document.querySelectorAll("section").length > 3);
  ready();
  const seesY = await page.evaluate(() => {
    const el = document.querySelectorAll("section")[1];
    return el ? el.getBoundingClientRect().top + window.scrollY - 60 : 800;
  });
  await glide(page, seesY, 2400);
  await sleep(6000);
  await glide(page, seesY + 520, 2600);
  await sleep(6500);
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

/**
 * The desk, held close enough to read.
 *
 * Every desk beat records a 900-tall page and crops a 640x360 CSS window — native 1280x720 in
 * the 2x recording — aimed at a measured element. The console lands at about two thirds of the
 * frame instead of a third, and the numbers the narration is talking about are legible.
 *
 * `TAll` gives the whole 830-pixel console somewhere to exist; without it the payout panel sat
 * below the fold and every take cut the device off at the knees.
 */
/**
 * The desk is filmed at the frame's own size, because it now fills it.
 *
 * 1280x720 with no zoom and no crop: the three-column desk lands console-centred with the
 * chain panel and the round list either side, which is both the whole interface and legible.
 */
/**
 * The desk is filmed at 1600x900 — sixteen by nine, just larger.
 *
 * At 1280x720 the console's own 831-pixel body did not fit: the payout panel, the game switch
 * and the stake keys sat below the fold in every desk take, so the beat about choosing a size
 * never showed the control that chooses it. A taller viewport of the same shape fits the whole
 * chassis with the side panels either side, and scales to 720 with no letterboxing and nothing
 * cut off anything.
 */
const TALL = { width: 1600, height: 900 };

/** The deck is only worth filming when it has a live round on it. */
const liveDeck = (page) =>
  mustSee(
    page,
    "a live deck with an open round",
    () =>
      /BAND/.test(document.body.innerText) &&
      !/CONNECT TO PLAY/.test(document.body.innerText) &&
      !/NO OPEN MARKET/.test(document.body.innerText) &&
      /CLOSES IN/.test(document.body.innerText),
    40_000,
  );

made.push(await scene(browser, "deck-open", async (page, ready, frame) => {
  await page.goto(`${DESK_BASE}/play`, { waitUntil: "domcontentloaded" });
  await liveDeck(page);
  // The whole device, top to bottom, at a size the numbers can be read at.
  await frame(".shell", SIZE.width, SIZE.height, true);
  ready();
  // Held on the live price and the round clock, both counting, both read from the chain.
  await sleep(13500);
}, TALL));

made.push(await scene(browser, "deck-band", async (page, ready, frame) => {
  await page.goto(`${DESK_BASE}/play`, { waitUntil: "domcontentloaded" });
  await liveDeck(page);
  await frame(".screen");
  ready();
  await sleep(1800);
  const click = async (label, n = 1) => {
    const b = page.locator(`button:text-is("${label}")`).first();
    if (!(await b.count())) throw new Error(`control "${label}" is not on screen`);
    for (let i = 0; i < n; i++) { await b.click(); await sleep(850); }
  };
  // Wide, then tight. The band percentage and the payout move together on screen.
  await click("+", 5);
  await sleep(2200);
  await click("−", 7);
  await sleep(2400);
  await click("+", 3);
  await sleep(3000);
}, TALL));

made.push(await scene(browser, "deck-pays", async (page, ready, frame) => {
  await page.goto(`${DESK_BASE}/play`, { waitUntil: "domcontentloaded" });
  await liveDeck(page);
  // Aimed low, at the payout panel — the number a trader actually decides on.
  await frame(".shell");
  await page.evaluate(() => {
    const el = document.querySelector(".shell");
    if (el) el.scrollIntoView({ block: "end" });
  });
  ready();
  await sleep(2000);
  const tier = async (label) => {
    const b = page.locator(`button:text-is("${label}")`).first();
    if (!(await b.count())) throw new Error(`tier "${label}" is not on screen`);
    await b.click();
    await sleep(2800);
  };
  await tier("1h"); await tier("4h"); await tier("15m"); await tier("1h");
  await sleep(3500);
}, TALL));

/*
  The direction beat is gone with the network.

  UpDownMarket is a second deployment and only Sepolia has it, so on mainnet the switch is not
  rendered and there is nothing to film. Filming it against the testnet and cutting it into a
  mainnet film would be showing a feature the live product does not have.
*/

made.push(await scene(browser, "trade-live", async (page, ready, frame) => {
  await page.goto(`${DESK_BASE}/play`, { waitUntil: "domcontentloaded" });
  await liveDeck(page);
  await frame(".shell", SIZE.width, SIZE.height, true);
  ready();
  await sleep(2200);

  /*
    Controls are found by their accessible name, not their label.

    The stake keys are labelled with the value they will jump to — "▼ 2" one moment and "▼ 1"
    the next — so a selector written against the text matched on the first take and timed out
    on the second. `aria-label` is the part of a control that is supposed to be stable, and
    using it means the recorder is pressing the key a screen reader would name, not a string
    that happens to be printed on it today.
  */
  const press = async (name, n = 1, wait = 900) => {
    const b = page.locator(`button:text-is("${name}"), button[aria-label="${name}"]`).first();
    if (!(await b.count())) throw new Error(`control "${name}" is not on screen`);
    for (let i = 0; i < n; i++) { await b.click(); await sleep(wait); }
  };
  const fire = page.locator('button[aria-label="Fire"], button:text-is("Fire")').first();
  if (!(await fire.count())) throw new Error("the Fire key is not on screen");

  // Choose a band, then a size — the two decisions the whole product is about.
  await press("+", 3, 800);
  await sleep(1400);
  await press("Lower the stake", 2, 800);
  await sleep(1800);

  // First press connects: the address replaces NOT CONNECTED on the strip.
  await fire.click();
  await mustSee(page, "a connected wallet on the deck",
    () => !/NOT CONNECTED/.test(document.body.innerText), 45_000);
  await sleep(2600);

  // Second press signs and broadcasts. Read the counter before, so the wait ends on a change
  // rather than on a timer that could expire while the transaction was still in flight.
  const riding = () => page.evaluate(() => {
    const m = document.body.innerText.match(/(\d+)\s*RIDING/);
    return m ? Number(m[1]) : 0;
  });
  const before = await riding();
  await fire.click();
  await mustSee(page, "the position land on chain", (n) => {
    const m = document.body.innerText.match(/(\d+)\s*RIDING/);
    return Boolean(m) && Number(m[1]) > n;
  }, 150_000, before);
  await sleep(6000);

  /*
    Write down what this take just did.

    Every beat after this one — the explorer, /verify, the market page — has to name *this*
    position, and the previous cut named a Sepolia one because the hashes were typed in once
    and the network moved underneath them. So the scene that creates the position is the scene
    that records it, and the rest read from the file.

    The store is the browser's own: the same record the desk uses to claim later, secret and
    all, so nothing here is a second copy that can disagree with the first.
  */
  const stored = await page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem("molfi.positions.v1");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const latest = stored[stored.length - 1];
  if (!latest) throw new Error("the deck reported a position but stored none — nothing to name later");
  TAKE.network = "mainnet";
  TAKE.explorer = "https://starkscan.co";
  TAKE.commitment = latest.commitment;
  TAKE.marketId = latest.marketId;
  TAKE.pair = latest.pair;
  TAKE.stakeStrk = String(Number(BigInt(latest.stake)) / 1e18);
  // No fallback. A hash left over from another take under narration describing this one is
  // the exact lie this file exists to prevent.
  if (!latest.txHash) throw new Error("NO_TAKE_TXS: the stored position carries no open transaction hash");
  TAKE.open = latest.txHash;
  TAKE.claim = null;
  TAKE.storedPosition = latest;
  writeFileSync(join(HERE, "take-txs.json"), JSON.stringify(TAKE, null, 2) + "\n");
  log(`    take: market #${TAKE.marketId} · ${String(TAKE.commitment).slice(0, 14)}…`);
}, TALL));

/**
 * The desk right after the trade lands, with the whole terminal on screen.
 *
 * The panel on the left is the position exactly as the contract received it — commitment,
 * stake, multiplier, route — and then YOUR BAND and YOUR NAME, marked NOT STORED. The panel on
 * the right shows it riding with the band sealed. This is the product's whole claim, visible
 * in one frame, on the screen that just made it true.
 */
made.push(await scene(browser, "riding", async (page, ready, frame) => {
  /*
    Each scene records in its own browser context, which is what keeps one clip per beat — and
    it means an empty `localStorage`. The position this beat is about was opened in the take
    before it, so the deck here had nothing to show and the panel rendered its empty state.

    Restored, not invented: this is the record the previous scene read out of the browser that
    made it, written to disk and put back. The chain is still the source of everything on
    screen; the store only says which commitment to ask about.
  */
  if (!TAKE.storedPosition) {
    throw new Error("NO_TAKE_TXS: no stored position from this take — record trade-live first");
  }
  await page.addInitScript((pos) => {
    try {
      window.localStorage.setItem("molfi.positions.v1", JSON.stringify([pos]));
    } catch {
      /* a context with storage disabled will fail the mustSee below, loudly */
    }
  }, TAKE.storedPosition);
  await page.goto(`${DESK_BASE}/play`, { waitUntil: "domcontentloaded" });
  await liveDeck(page);
  await mustSee(page, "the chain's view of a real position",
    () => /NOT STORED/.test(document.body.innerText) && /COMMITMENT/.test(document.body.innerText), 30_000);
  ready();
  await sleep(11_000);
}, TALL));

/**
 * The trade itself, on the explorer that anyone can open.
 *
 * These hashes are this take's. `demo/launch/take-txs.json` is written by the trade script when
 * the position is opened and by the claim when it pays; the recorder refuses to film if it is
 * missing rather than reaching for a hash that happened to be lying around. A demo that shows
 * *a* transaction under a line describing *this* trade is the exact lie this guard exists for.
 */
made.push(await scene(browser, "trade", async (page, ready) => {
  await page.goto(`${TAKE.explorer}/tx/${TAKE.open}`, { waitUntil: "domcontentloaded" });
  await mustSee(page, "the open_position transaction", () => /open_position|Succeeded|SUCCEEDED/i.test(document.body.innerText), 45_000);
  ready();
  await sleep(6000);
  await glide(page, 620, 2200);
  await sleep(5500);
  await glide(page, 1150, 2200);
  await sleep(5000);
}));

made.push(await scene(browser, "settle", async (page, ready) => {
  /*
    A market that has actually settled, chosen at record time.

    This pointed at `TAKE.marketId` — the round the take just opened into, which by definition
    has not settled yet — and after the move to mainnet that id did not exist there at all, so
    the beat filmed a 404. The audit page is only worth showing on a settled round anyway:
    that is where the recomputation lives.
  */
  const settled = await fetch(`${BASE}/api/markets`)
    .then((r) => r.json())
    .then((d) => (d.markets ?? []).filter((m) => m.isSettled).sort((a, b) => b.id - a.id)[0])
    .catch(() => null);
  if (!settled) throw new Error("no settled market on this network to audit");
  log(`    auditing market #${settled.id} (${settled.pair})`);
  await page.goto(`${BASE}/m/${settled.id}`, { waitUntil: "domcontentloaded" });
  await mustSee(page, "the market's own audit", () => /check/i.test(document.body.innerText), 30_000);
  ready();
  await sleep(4500);
  await glide(page, 700, 2400);
  await sleep(5500);
  await glide(page, 1400, 2400);
  await sleep(5000);
}));

made.push(await scene(browser, "verify", async (page, ready) => {
  await page.goto(`${BASE}/verify`, { waitUntil: "domcontentloaded" });
  await until(page, () => Boolean(document.querySelector("input[placeholder*=commitment]")));
  ready();
  await sleep(1800);
  const input = page.locator("input[placeholder*=commitment]").first();
  await input.click();
  // Typed, not pasted — a real commitment from a real position, entered like a person would.
  await input.type(TAKE.commitment, { delay: 14 });
  await sleep(700);
  await page.locator('button:text-is("LOOK")').first().click();
  await until(page, () => /WHAT THE CHAIN REVEALS/.test(document.body.innerText), 20_000);
  await sleep(6500);
  await glide(page, 620, 2200);
  await sleep(6000);
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

/** The claim: the band revealed for the first time, and the payout landing. */
/**
 * The claim, on the desk, with the band revealed for the first time.
 *
 * This used to be a block explorer page for a transaction from an earlier take. It is the
 * product's own flow now: the position is restored into the browser that will claim it, the
 * deck offers CLAIM because the chain says the round settled inside the band, and the payout
 * lands while the camera is still on it.
 *
 * The claim key only appears for a position that actually won. If this round landed outside
 * the band there is nothing to claim and the scene fails rather than filming a button that is
 * not there — losing is a real outcome and it needs its own beat, not this one dressed up.
 */
/**
 * The payout, on the explorer, with the money moving.
 *
 * The desk knows the position won — the rail reads SETTLED · INSIDE — and does not offer a
 * claim key for it, which is a real gap in the product and is filed as one. Rather than film
 * a button that is not there, this beat shows the claim transaction itself: the band revealed
 * on chain for the first time, and 1.6227 STRK landing back on the address that staked one.
 *
 * The hash is this take's own, written by the scene that opened the position.
 */
/**
 * The claim, on the desk, with the band revealed for the first time.
 *
 * This was a block explorer page for a while, because the console offered no way to claim: the
 * first press of any key silently connected a wallet and did nothing, so CLAIM looked dead and
 * the payout had to be taken from the command line. That is fixed, so the beat is the product's
 * own flow again — the deck offers CLAIM because the chain says this round settled inside the
 * band, and the payout lands while the camera is still on it.
 *
 * The key only appears for a position that actually won. If this round landed outside the band
 * there is nothing to claim, and the scene fails rather than filming a button that is not
 * there: losing is a real outcome and it needs its own beat, not this one dressed up.
 */
made.push(await scene(browser, "payout", async (page, ready, frame) => {
  if (!TAKE.storedPosition) {
    throw new Error("NO_TAKE_TXS: no stored position from this take — record trade-live first");
  }
  await page.addInitScript((pos) => {
    try {
      window.localStorage.setItem("molfi.positions.v1", JSON.stringify([pos]));
    } catch {
      /* storage refused; the mustSee below will say so */
    }
  }, TAKE.storedPosition);
  await page.goto(`${DESK_BASE}/play`, { waitUntil: "domcontentloaded" });
  await liveDeck(page);
  await mustSee(
    page,
    "a settled, winning position with a claim offered",
    () => /CLAIM \d+ POSITION/.test(document.body.innerText),
    120_000,
  );
  ready();
  await sleep(4000);

  const claim = page.locator('button:has-text("CLAIM")').first();
  if (!(await claim.count())) throw new Error("the CLAIM key is not on screen");
  await claim.click();
  // A payout is a transaction; hold until the deck says it landed rather than on a timer.
  await mustSee(page, "the payout land", () => /CLAIMED/.test(document.body.innerText), 180_000);
  await sleep(8000);
}, TALL));

made.push(await scene(browser, "keeper", async (page, ready) => {
  await page.goto(`${BASE}/keeper`, { waitUntil: "domcontentloaded" });
  await until(page, () => /Nobody has to run this/.test(document.body.innerText));
  ready();
  await sleep(4500);
  await glide(page, 620, 2200);
  await sleep(5500);
  await glide(page, 1180, 2400);
  await sleep(5500);
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
  await sleep(9000);
  // A short walk down the transaction list — 420, not 900. A previous take glided far enough
  // to reach Starkscan's own footer and spent half a beat on somebody else's links.
  await glide(page, 420, 2600);
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
/**
 * Merged, never replaced.
 *
 * `--only` re-shoots one scene; writing just those results wiped the lead-in offsets for every
 * scene that was not in this run, and the assembler then stopped trimming their black
 * navigation frames. A partial run must leave the rest of the log alone.
 */
const logPath = join(HERE, "recorded.json");
const previous = existsSync(logPath)
  ? Object.fromEntries(JSON.parse(readFileSync(logPath, "utf8")).map((r) => [r.id, r]))
  : {};
for (const r of recorded) previous[r.id] = r;
const ordered = SCENE_ORDER.filter((id) => previous[id]).map((id) => previous[id]);
writeFileSync(logPath, JSON.stringify(ordered, null, 2) + "\n");
const broken = recorded.filter((r) => r.failure);
if (broken.length) {
  log(`\nFAILED scenes — do not assemble these, fix and re-record:`);
  for (const b of broken) log(`  ${b.id}: ${b.failure}`);
}
const dirty = recorded.filter((r) => r.consoleErrors.length);
log(`\n${recorded.length} scene(s) recorded into ${RAW}`);
if (dirty.length) {
  log(`\nscenes with console errors — footage must be clean, re-record after fixing:`);
  for (const d of dirty) log(`  ${d.id}: ${d.consoleErrors.join(" | ")}`);
}
