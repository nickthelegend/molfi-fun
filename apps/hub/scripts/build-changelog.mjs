/**
 * Turns the real git history into data the changelog page renders.
 *
 * Run at build time rather than request time: the page is served from a machine that has no
 * repository, so reading git in a request handler would work in development and fail in
 * production, which is the worst way for a feature to break.
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "src", "generated", "changelog.json");

// Subject and body are separated by a record separator so a multi-line body survives.
const FORMAT = "%H%x1f%aI%x1f%s%x1f%b%x1e";

let entries = [];
try {
  const raw = execSync(`git log --no-merges --max-count=40 --pretty=format:"${FORMAT}"`, {
    cwd: join(here, "..", "..", ".."),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });

  entries = raw
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, date, subject, body] = record.split("\x1f");
      return {
        hash: hash.slice(0, 8),
        date,
        subject,
        // First paragraph only. A commit body here is several paragraphs of reasoning and
        // the page wants the claim, not the essay.
        summary: (body ?? "").trim().split("\n\n")[0].replace(/\s+/g, " ").slice(0, 320),
      };
    });
} catch (error) {
  // A build outside a git checkout is a real situation. An empty changelog renders an honest
  // empty state; failing the build over a nice-to-have page would be the wrong trade.
  console.warn("[changelog] no git history available:", error.message);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(entries, null, 2) + "\n");
console.log(`[changelog] wrote ${entries.length} entries`);
