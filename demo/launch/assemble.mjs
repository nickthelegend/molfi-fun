#!/usr/bin/env node
/**
 * Turn the recorded scenes and their narration into one cut.
 *
 * Each scene is paced to *its own* narration rather than to a global timeline, which is the
 * whole reason the scenes are separate files. If the footage runs long it is speed-ramped down
 * to the line; if it runs short the last frame is held. Either way the picture and the sentence
 * describing it start and end together, and a scene can be re-shot later without moving
 * anything after it.
 *
 * Durations are read from the files with ffprobe. Nothing here estimates a length.
 *
 * Usage:
 *   node demo/launch/assemble.mjs              # full cut at natural pace
 *   node demo/launch/assemble.mjs --speeds     # apply scenes.json multipliers
 */

import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, "raw");
const AUDIO = join(HERE, "audio");
const WORK = join(HERE, "work");
const useSpeeds = process.argv.includes("--speeds");

const sh = (cmd, args, cwd) =>
  execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...(cwd ? { cwd } : {}) });
const probe = (f) =>
  Number(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).trim());

const narration = JSON.parse(readFileSync(join(HERE, "narration.json"), "utf8"));
/**
 * How much of each clip is the browser still navigating.
 *
 * `recordVideo` starts with the context, so every take opens on about:blank. Recording writes
 * the measured offset of the first painted frame; without trimming it, a scene begins on black
 * — and after a speed ramp that black sat directly under the scene's first caption.
 */
const leadIns = existsSync(join(HERE, "recorded.json"))
  ? Object.fromEntries(JSON.parse(readFileSync(join(HERE, "recorded.json"), "utf8")).map((r) => [r.id, r.leadIn ?? 0]))
  : {};

/** Per-scene camera windows, written by the recorder from real element boxes. */
const crops = Object.fromEntries(
  JSON.parse(readFileSync(join(HERE, "recorded.json"), "utf8"))
    .filter((r) => r && r.crop)
    .map((r) => [r.id, r.crop]),
);
const speeds = useSpeeds && existsSync(join(HERE, "scenes.json"))
  ? Object.fromEntries(JSON.parse(readFileSync(join(HERE, "scenes.json"), "utf8")).map((s) => [s.id, s.speed]))
  : {};

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

/** 1280x720 at 30fps everywhere, so concat never has to re-encode a mismatch. */
const W = 1280, H = 720, FPS = 30;

/**
 * Two lines maximum, broken on a word.
 *
 * A subtitle that wraps to three lines covers the thing it is describing. Kept short and
 * bottom-centred, clear of the deck and of every page's own footer strip.
 */
function wrap(text, max = 46) {
  const words = text.split(" ");
  const lines = [""];
  for (const w of words) {
    const line = lines[lines.length - 1];
    if (!line) lines[lines.length - 1] = w;
    else if ((line + " " + w).length <= max) lines[lines.length - 1] = line + " " + w;
    else lines.push(w);
  }
  // If it ran to three, rebalance across two rather than dropping a line.
  if (lines.length > 2) {
    const mid = Math.ceil(text.length / 2);
    let best = text.length, at = -1;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === " " && Math.abs(i - mid) < best) { best = Math.abs(i - mid); at = i; }
    }
    return at > 0 ? [text.slice(0, at), text.slice(at + 1)] : [text];
  }
  return lines;
}

/**
 * One narration line becomes several caption cues, split where a speaker would breathe.
 *
 * A cue per scene is a cue per paragraph. The direction beat's line ran to three lines of type
 * and sat directly over the UP and DOWN keys the sentence was pointing at — the caption covered
 * its own subject for twelve seconds. Splitting at sentence ends first, then at clause commas,
 * then at words as a last resort, keeps every cue to a phrase a reader takes in at a glance.
 *
 * Time is shared out by character count rather than evenly: a six-word clause and a twenty-word
 * one do not take the same time to say, and an even split leaves the short cue lingering while
 * the long one races.
 */
const CUE_MAX = 52;
function phrases(text) {
  // Sentences first — the strongest break a reader already expects.
  const out = [];
  for (const sentence of text.match(/[^.!?]+[.!?]*\s*/g) ?? [text]) {
    const t = sentence.trim();
    if (!t) continue;
    if (t.length <= CUE_MAX) { out.push(t); continue; }
    // Then clause commas, accumulating until the next one would overflow.
    let buf = "";
    for (const clause of t.split(/(?<=,)\s+/)) {
      if (!buf) buf = clause;
      else if ((buf + " " + clause).length <= CUE_MAX) buf += " " + clause;
      else { out.push(buf); buf = clause; }
    }
    if (buf) out.push(buf);
  }
  // Last resort: a clause that is still too long is broken on words.
  const final = [];
  for (const chunk of out) {
    if (chunk.length <= CUE_MAX) { final.push(chunk); continue; }
    let buf = "";
    for (const w of chunk.split(" ")) {
      if (!buf) buf = w;
      else if ((buf + " " + w).length <= CUE_MAX) buf += " " + w;
      else { final.push(buf); buf = w; }
    }
    if (buf) final.push(buf);
  }
  return final.length ? final : [text];
}

/** ASS wants H:MM:SS.cc — hours unpadded, centiseconds. */
const assTime = (s) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360_000);
  const m = String(Math.floor((cs % 360_000) / 6_000)).padStart(2, "0");
  const sec = String(Math.floor((cs % 6_000) / 100)).padStart(2, "0");
  return `${h}:${m}:${sec}.${String(cs % 100).padStart(2, "0")}`;
};

console.log(`\nassembling${useSpeeds ? " (with scenes.json speeds)" : ""}\n`);

const segments = [];
const cues = [];
let clock = 0;

for (const [i, n] of narration.entries()) {
  const video = join(RAW, `${n.id}.webm`);
  const audio = join(AUDIO, `${n.id}.wav`);
  if (!existsSync(video) || !existsSync(audio)) {
    console.log(`  ${n.id.padEnd(12)} SKIPPED — missing ${existsSync(video) ? "audio" : "video"}`);
    continue;
  }

  const speed = Number(speeds[n.id] ?? 1) || 1;
  /**
   * The camera window this scene asked for, measured at record time.
   *
   * A desk scene records a 900-tall page at 2x and names a 16:9 window over a real element, so
   * the console fills the frame rather than floating in it. Applied before anything else in the
   * chain: cropping after a scale would be cropping an already-shrunk picture, and the whole
   * point is that this crop is native pixels.
   */
  const lead = Number(leadIns[n.id] ?? 0);
  const vDur = probe(video) - lead;
  const box = crops[n.id];
  /*
    A panning crop is the crop's own `y` written as a function of `t`, so ffmpeg moves the
    window while it decodes. Clamped at both ends, because the ramp below retimes the clip and
    an unclamped expression would keep travelling past the bottom of the object into padding.
  */
  const crop = !box
    ? ""
    : box.pan
      ? `crop=${box.w}:${box.h}:${box.x}:'${box.pan.from}+(${box.pan.to}-${box.pan.from})*min(1\,max(0\,t/${Math.max(0.1, vDur).toFixed(2)}))',`
      : `crop=${box.w}:${box.h}:${box.x}:${box.y},`;
  /** The narration is the clock; a multiplier shortens both together so they stay in sync. */
  const target = n.seconds / speed;
  const seg = join(WORK, `${String(i).padStart(2, "0")}-${n.id}.mp4`);

  /**
   * Long footage is ramped, short footage holds its last frame.
   *
   * `setpts` retimes rather than dropping frames, so a scroll stays smooth when it is sped up.
   * `tpad` freezes the final frame instead of looping or cutting to black, which would read as
   * a glitch exactly where the narration is finishing a sentence.
   */
  const ratio = target / vDur;
  const vf =
    ratio < 1
      ? `${crop}setpts=${ratio.toFixed(6)}*PTS,fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0a0a0b`
      : `${crop}fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0a0a0b,tpad=stop_mode=clone:stop_duration=${(target - vDur).toFixed(3)}`;

  // Audio is retimed by the same multiplier. atempo preserves pitch, so a 2x scene still sounds
  // like the same narrator rather than a chipmunk.
  const af = speed === 1 ? "anull" : `atempo=${Math.min(2, speed).toFixed(4)}${speed > 2 ? `,atempo=${(speed / 2).toFixed(4)}` : ""}`;

  sh("ffmpeg", [
    "-y", "-loglevel", "error",
    // `-ss` before `-i` so the seek happens on the input and the trimmed frames are never decoded.
    ...(lead > 0 ? ["-ss", lead.toFixed(3)] : []), "-i", video, "-i", audio,
    "-filter_complex", `[0:v]${vf}[v];[1:a]${af},aresample=48000[a]`,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-shortest",
    "-t", target.toFixed(3),
    seg,
  ]);

  const actual = probe(seg);
  /*
    Cue times are measured on the normalised clip, after the mux. `-shortest` trims each
    segment to its own narration, so timing the cues from the raw footage would put them
    progressively further ahead of the picture as the cut went on.
  */
  const parts = phrases(n.line);
  const chars = parts.reduce((a, t) => a + t.length, 0);
  let at = clock;
  for (const t of parts) {
    const share = (t.length / chars) * actual;
    cues.push({ start: at, end: at + share, text: t });
    at += share;
  }
  clock += actual;
  segments.push(seg);
  console.log(
    `  ${n.id.padEnd(12)} ${lead ? `−${lead.toFixed(1)}s lead · ` : ""}${vDur.toFixed(1)}s → ${actual.toFixed(1)}s  (narration ${n.seconds.toFixed(1)}s${speed !== 1 ? `, ${speed}x` : ""})`,
  );
}

// ---- stitch ------------------------------------------------------------------------------
const list = join(WORK, "list.txt");
writeFileSync(list, segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
const stitched = join(WORK, "stitched.mp4");
sh("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", stitched]);

// ---- one cue per line, rendered as type and overlaid ---------------------------------------
/**
 * Captions rendered in a browser, then composited — because this ffmpeg cannot draw text.
 *
 * The build here has no `subtitles`, no `ass` and no `drawtext` filter; `overlay` is all there
 * is. That turns out to be the better road anyway: rendering each caption in the same Chromium
 * that recorded the footage means they are set in the product's own typeface with real kerning
 * and a real shadow, rather than in whatever libass would have fallen back to.
 *
 * One transparent PNG per cue, each composited only for its own scene's window.
 */
const subsDir = join(WORK, "subs");
mkdirSync(subsDir, { recursive: true });

const capBrowser = await chromium.launch();
const capPage = await capBrowser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
for (const [i, c] of cues.entries()) {
  const wrapped = wrap(c.text, 62);
  if (wrapped.length > 1) {
    throw new Error(
      `CAPTION_TOO_LONG: "${c.text}" will not set on one line. Split it further in phrases() ` +
        `or shorten the narration in script.json — silently dropping the tail of a sentence ` +
        `looks fine in a spot check and is wrong everywhere else.`,
    );
  }
  const line = wrapped[0].replace(/&/g, "&amp;").replace(/</g, "&lt;");
  await capPage.setContent(`<!doctype html><meta charset=utf-8>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600&display=swap');
      html,body{margin:0;width:${W}px;height:${H}px;background:transparent}
      /*
        A black plate only as wide as the words, not a gradient across the frame.

        The previous captions were a 190px scrim spanning the full width, which dimmed the
        bottom quarter of every shot to light two lines of type — and on the direction beat it
        was the quarter holding the UP and DOWN keys. One short line on its own plate leaves
        the picture alone.
      */
      .row{position:absolute;left:0;right:0;bottom:32px;display:flex;justify-content:center}
      .cap{font-family:'Bricolage Grotesque',system-ui,sans-serif;font-weight:600;
           font-size:18px;line-height:1.45;color:#fff;letter-spacing:-.002em;
           background:#000;padding:6px 13px;border-radius:4px;white-space:nowrap}
    </style><div class=row><div class=cap>${line}</div></div>`);
  await capPage.waitForTimeout(320);
  await capPage.screenshot({ path: join(subsDir, `${String(i).padStart(2, "0")}.png`), omitBackground: true });
}
await capBrowser.close();

const out = join(HERE, useSpeeds ? "molfi-launch.mp4" : "molfi-launch-full.mp4");
/**
 * Each caption is enabled only across its own scene, so exactly one is on screen at a time.
 *
 * `between(t,start,end)` on the overlay rather than trimming the PNG, which keeps the filter
 * graph a simple chain and means a re-timed scene only changes two numbers.
 */
const inputs = ["-i", stitched];
for (const [i] of cues.entries()) inputs.push("-i", join(subsDir, `${String(i).padStart(2, "0")}.png`));
/**
 * Each caption is scaled to the frame before it is composited.
 *
 * They are rendered at deviceScaleFactor 2 — 2560x1440 — so the type is supersampled and stays
 * crisp. Overlaid raw, that put a 1440-tall image on a 720-tall frame at 0,0 and the caption,
 * which sits at the bottom of its own canvas, landed entirely below the picture: the first cut
 * had no visible subtitles at all. Scaling here keeps the extra resolution and puts it back in
 * frame.
 */
const scales = cues.map((_, i) => `[${i + 1}:v]scale=${W}:${H}[s${i}]`).join(";");
const chain = scales + ";" + cues
  .map((c, i) => {
    const src = i === 0 ? "[0:v]" : `[v${i}]`;
    const dst = i === cues.length - 1 ? "[vout]" : `[v${i + 1}]`;
    return `${src}[s${i}]overlay=0:0:enable='between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})'${dst}`;
  })
  .join(";");

sh("ffmpeg", [
  "-y", "-loglevel", "error",
  ...inputs,
  "-filter_complex", chain,
  "-map", "[vout]", "-map", "0:a",
  "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
  "-c:a", "copy",
  out,
]);

const total = probe(out);
console.log(`\n${segments.length} scenes · ${Math.floor(total / 60)}m ${(total % 60).toFixed(0)}s → ${out}`);

// A speeds file to tune runtime with, written once and then left alone for the operator to edit.
const scenesPath = join(HERE, "scenes.json");
if (!existsSync(scenesPath)) {
  writeFileSync(
    scenesPath,
    JSON.stringify(narration.map((n) => ({ id: n.id, speed: 1, narration: n.seconds })), null, 2) + "\n",
  );
  console.log(`wrote ${scenesPath} — set a speed per scene, then: node demo/launch/assemble.mjs --speeds`);
}
