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
  const lead = Number(leadIns[n.id] ?? 0);
  const vDur = probe(video) - lead;
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
      ? `setpts=${ratio.toFixed(6)}*PTS,fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0a0a0b`
      : `fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0a0a0b,tpad=stop_mode=clone:stop_duration=${(target - vDur).toFixed(3)}`;

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
  cues.push({ start: clock, end: clock + actual, text: n.line });
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
  const lines = wrap(c.text).map((l) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
  await capPage.setContent(`<!doctype html><meta charset=utf-8>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600&display=swap');
      html,body{margin:0;width:${W}px;height:${H}px;background:transparent}
      /* A scrim, because the footage underneath is a real product and not a backdrop.
         A shadow alone left the caption sitting on top of body text and audit rows — legible
         if you squint, which is not legible. The gradient is transparent well before the
         middle of the frame, so it darkens the caption band and nothing the scene is about. */
      .scrim{position:absolute;left:0;right:0;bottom:0;height:190px;
             background:linear-gradient(to top,rgba(6,6,8,.94) 0%,rgba(6,6,8,.82) 34%,rgba(6,6,8,.45) 66%,rgba(6,6,8,0) 100%)}
      .cap{position:absolute;left:0;right:0;bottom:40px;text-align:center;padding:0 90px;
           font-family:'Bricolage Grotesque',system-ui,sans-serif;font-weight:600;font-size:25px;
           line-height:1.38;color:#fff;letter-spacing:-.005em;
           text-shadow:0 2px 8px rgba(0,0,0,.9)}
    </style><div class=scrim></div><div class=cap>${lines.join("<br>")}</div>`);
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
