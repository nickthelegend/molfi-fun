/**
 * Fits every market and horizon on real tape and writes `src/generated/tables.ts`.
 *
 * Run: pnpm --filter @molfi/sdk calibrate
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { HORIZONS, HOUSE_EDGE_BPS, SIGMA_SHADE, fetchMinuteCloses, fitHorizon } from "./calibrate.ts";
import { MARKETS } from "./markets.ts";

/** Thirty days of minutes: enough that a four-hour horizon still has hundreds of samples. */
const MINUTES = 43_200;

const out: string[] = [];
const report: string[] = [];

out.push(`/** GENERATED — do not edit by hand. Produced by \`pnpm calibrate\` from real tape.`);
out.push(` *`);
out.push(` *  Distributions are MEASURED per horizon, not assumed normal. Over fifteen minutes an`);
out.push(` *  asset finishes very close to where it started far more often than a normal allows,`);
out.push(` *  and carries fatter tails than it allows too, so a normal misprices both ends.`);
out.push(` *`);
out.push(` *  Generated: ${new Date().toISOString()}`);
out.push(` */`);
out.push("");
out.push(`import type { Calibration } from "../quote.ts";`);
out.push("");
out.push(`export const GENERATED_AT = "${new Date().toISOString()}";`);
out.push(`export const HOUSE_EDGE_BPS = ${HOUSE_EDGE_BPS}n;`);
out.push(`export const SIGMA_SHADE = ${SIGMA_SHADE};`);
out.push("");
out.push(`export const CALIBRATIONS: Calibration[] = [`);

for (const market of MARKETS) {
  process.stderr.write(`  fetching ${market.tape} …\n`);
  const candles = await fetchMinuteCloses(market.tape, MINUTES);
  const closes = candles.map((c) => c.close);
  process.stderr.write(`    ${closes.length.toLocaleString()} minute closes\n`);

  for (const horizon of HORIZONS) {
    const fit = fitHorizon(closes, horizon.seconds, horizon.key);
    if (!fit) {
      process.stderr.write(`    ${horizon.key}: not enough tape, skipped\n`);
      continue;
    }
    out.push(`  {`);
    out.push(`    marketKey: ${JSON.stringify(market.key)},`);
    out.push(`    horizonKey: ${JSON.stringify(horizon.key)},`);
    out.push(`    sigma1e4: ${fit.sigma1e4}n,`);
    out.push(`    table: [${fit.table.map((t) => `${t}n`).join(", ")}],`);
    out.push(`  },`);

    // What the vault actually keeps, which is the number that decides solvency. The
    // multiplier is (1 - fee) / p_model, and the band pays out at p_realised, so the
    // expectation per unit staked is p_realised * (1 - fee) / p_model.
    const fee = Number(HOUSE_EDGE_BPS) / 10_000;
    const multiplier = (1 - fee) / fit.modelledWinRate;
    const expectedPayout = fit.realisedWinRate * multiplier;
    const effectiveEdge = (1 - expectedPayout) * 100;

    report.push(
      `  ${market.key.padEnd(5)} ${horizon.key.padEnd(4)} ` +
        `sigma ${(fit.modelSigma * 100).toFixed(3)}%  ` +
        `modelled ${(fit.modelledWinRate * 100).toFixed(1)}%  ` +
        `realised ${(fit.realisedWinRate * 100).toFixed(1)}%  ` +
        `edge ${effectiveEdge.toFixed(1)}%`,
    );
  }
}

out.push(`];`);
out.push("");

mkdirSync("src/generated", { recursive: true });
writeFileSync("src/generated/tables.ts", out.join("\n"));

process.stderr.write("\n  out-of-sample — a one-sigma band on tape the fit never saw:\n");
for (const line of report) process.stderr.write(line + "\n");
process.stderr.write(
  "\n  The edge column is what the vault keeps per unit staked, and it is the only number\n" +
  "  here that decides solvency. It runs far above the 4% fee because the model claims\n" +
  "  bands hold more often than they do out of sample, and the player is charged as if the\n" +
  "  optimistic number were true.\n" +
  "\n  That is disclosed rather than hidden. Closing it would mean modelling a win rate at\n" +
  "  or below the realised one, which is the direction that drains the vault, and an\n" +
  "  insolvent market is worse for everyone than a wide spread. STRK is the worst of the\n" +
  "  three at roughly 21%, which is a reason to think hard before listing it, not a reason\n" +
  "  to quietly reprint the number smaller.\n",
);
