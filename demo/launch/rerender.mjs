#!/usr/bin/env node
/**
 * Re-cut to a target runtime by changing numbers, never by cutting content.
 *
 * `scenes.json` carries one `speed` per scene. Set a scene to 2, 4, 5 or anything else and run
 * this: the picture is retimed with `setpts` and the narration with `atempo`, which preserves
 * pitch — a 2x scene still sounds like the same narrator rather than a chipmunk — and the whole
 * thing is reassembled with the captions re-timed to match.
 *
 * Nothing is re-recorded and no scene is dropped, so the video still covers everything it
 * covered before; it just gets there faster. Scenes left at 1 are untouched.
 *
 *   node demo/launch/rerender.mjs          → molfi-launch.mp4
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
execFileSync("node", [join(HERE, "assemble.mjs"), "--speeds"], { stdio: "inherit" });
