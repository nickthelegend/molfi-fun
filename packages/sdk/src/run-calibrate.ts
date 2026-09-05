/**
 * Fits every market and round length on real tape and writes `src/generated/markets.ts`.
 *
 * Run: pnpm --filter @molfi/sdk calibrate
 */

import { mkdirSync, writeFileSync } from "node:fs";
import {
  HORIZONS,
  HOUSE_EDGE_BPS,
  SIGMA_SHADE,
  fetchMinuteCloses,
  fitHorizon,
} from "./calibrate.ts";
import { BPS, PROB_ONE } from "./pricing.ts";

/** The pairs, and the tape each is fitted from. Binance is used to calibrate, never to settle. */
const PAIRS = [
  { key: "BTC", label: "BTC/USD", tape: "BTCUSDT" },
  { key: "ETH", label: "ETH/USD", tape: "ETHUSDT" },
  { key: "STRK", label: "STRK/USD", tape: "STRKUSDT" },
];

/**
 * Ninety days of minutes.
 *
 * Long enough that the four hour round has hundreds of independent windows. The sample
 * counts printed below are overlapping windows at one minute stride, not independent draws —
 * a four hour round over ninety days has about 540 of those, and the held-out fifth has
 * about a hundred. That is the number the realised column is actually resting on.
 */
const MINUTES = 129_600;

/** Hard ceiling on what any round may pay, matching `markets.ts`. */
const MAX_MULTIPLIER_BPS = 80_000n;

const out: string[] = [];
const report: string[] = [];
const stamp = new Date().toISOString();

out.push(`/** GENERATED — do not edit by hand. Produced by \`pnpm calibrate\` from real tape.`);
out.push(` *`);
out.push(` *  Distributions are MEASURED per round length, not assumed normal. Over fifteen`);
out.push(` *  minutes an asset finishes very close to where it started far more often than a`);
out.push(` *  normal allows, and carries fatter tails than it allows too, so a normal misprices`);
out.push(` *  both ends of every band.`);
out.push(` *`);
out.push(` *  Generated: ${stamp}`);
out.push(` */`);
out.push("");
out.push(`export interface CalibratedRound {`);
out.push(`  /** Round length in seconds. Not blocks: the constraint is the oracle, not the chain. */`);
out.push(`  seconds: number;`);
out.push(`  /** Move size over the round, as a fraction of spot times 1e8. */`);
out.push(`  sigma1e4: bigint;`);
out.push(`  /** Tightest band the desk will sell, as a probability. Below this the quote runs away. */`);
out.push(`  minProb1e6: bigint;`);
out.push(`  /** What that tightest band pays, so the ceiling is the floor's exact partner. */`);
out.push(`  maxMultiplierBps: bigint;`);
out.push(`  /** T(z) = P(|move| <= z*sigma) on z = 0, 0.25 .. 4.00, in 1e6 fixed point. */`);
out.push(`  probTable: readonly bigint[];`);
out.push(`}`);
out.push("");
out.push(`export interface CalibratedMarket {`);
out.push(`  key: string;`);
out.push(`  /** The Pragma pair label, and the short string the oracle is keyed by. */`);
out.push(`  label: string;`);
out.push(`  /** Where the tape came from. Calibration only — settlement is always Pragma. */`);
out.push(`  source: string;`);
out.push(`  live: boolean;`);
out.push(`  rounds: CalibratedRound[];`);
out.push(`}`);
out.push("");
out.push(`export const GENERATED_AT = "${stamp}";`);
out.push(`export const HOUSE_EDGE_BPS = ${HOUSE_EDGE_BPS}n;`);
out.push(`export const SIGMA_SHADE = ${SIGMA_SHADE};`);
out.push(`export const ROUND_SECONDS = [${HORIZONS.map((h) => h.seconds).join(", ")}] as const;`);
out.push(`export const ROUND_KEYS = [${HORIZONS.map((h) => JSON.stringify(h.key)).join(", ")}] as const;`);
out.push("");
out.push(`export const CALIBRATED_MARKETS: CalibratedMarket[] = [`);

for (const pair of PAIRS) {
  process.stderr.write(`  fetching ${pair.tape} …\n`);
  const candles = await fetchMinuteCloses(pair.tape, MINUTES);
  const closes = candles.map((c) => c.close);
  process.stderr.write(`    ${closes.length.toLocaleString()} minute closes\n`);

  const rounds: string[] = [];

  for (const horizon of HORIZONS) {
    const fit = fitHorizon(closes, horizon.seconds, horizon.key);
    if (!fit) {
      process.stderr.write(`    ${horizon.key}: not enough tape, skipped\n`);
      continue;
    }

    // The tightest band worth selling, and what it pays. Derived from the multiplier
    // ceiling rather than picked, so the two can never disagree: past this probability the
    // quote is 1/p on a table sampled every 0.25 sigma, and the arithmetic runs away faster
    // than the measurement supports.
    const minProb1e6 = (PROB_ONE * (BPS - HOUSE_EDGE_BPS)) / MAX_MULTIPLIER_BPS;
    const maxMultiplierBps = ((PROB_ONE * BPS) / minProb1e6 * (BPS - HOUSE_EDGE_BPS)) / BPS;

    rounds.push(
      [
        `      {`,
        `        seconds: ${fit.seconds},`,
        `        sigma1e4: ${fit.sigma1e4}n,`,
        `        minProb1e6: ${minProb1e6}n,`,
        `        maxMultiplierBps: ${maxMultiplierBps}n,`,
        `        probTable: [${fit.table.map((t) => `${t}n`).join(", ")}],`,
        `      },`,
      ].join("\n"),
    );

    // What the vault actually keeps, which is the number that decides solvency. The
    // multiplier is (1 - fee) / p_model, and the band pays out at p_realised, so the
    // expectation per unit staked is p_realised * (1 - fee) / p_model.
    const fee = Number(HOUSE_EDGE_BPS) / 10_000;
    const multiplier = (1 - fee) / fit.modelledWinRate;
    const expectedPayout = fit.realisedWinRate * multiplier;
    const effectiveEdge = (1 - expectedPayout) * 100;

    report.push(
      `  ${pair.key.padEnd(5)} ${horizon.key.padEnd(4)} ` +
        `windows ${String(fit.samples).padStart(6)}  ` +
        `sigma ${(fit.modelSigma * 100).toFixed(3)}%  ` +
        `modelled ${(fit.modelledWinRate * 100).toFixed(1)}%  ` +
        `realised ${(fit.realisedWinRate * 100).toFixed(1)}%  ` +
        `edge ${effectiveEdge.toFixed(1)}%`,
    );
  }

  out.push(`  {`);
  out.push(`    key: ${JSON.stringify(pair.key)},`);
  out.push(`    label: ${JSON.stringify(pair.label)},`);
  out.push(`    source: ${JSON.stringify(`binance:${pair.tape} 1m`)},`);
  out.push(`    live: true,`);
  out.push(`    rounds: [`);
  out.push(rounds.join("\n"));
  out.push(`    ],`);
  out.push(`  },`);
}

out.push(`];`);
out.push("");

mkdirSync("src/generated", { recursive: true });
writeFileSync("src/generated/markets.ts", out.join("\n"));

process.stderr.write("\n  out-of-sample — a one-sigma band on tape the fit never saw:\n");
for (const line of report) process.stderr.write(line + "\n");
process.stderr.write(
  "\n  The edge column is what the vault keeps per unit staked, and it is the only number\n" +
    "  here that decides solvency. It runs above the 4% fee because the model claims bands\n" +
    "  hold more often than they do out of sample, and the trader is charged as if the\n" +
    "  optimistic number were true.\n" +
    "\n  That is disclosed rather than hidden. Closing it would mean modelling a win rate at\n" +
    "  or below the realised one, which is the direction that drains the vault, and an\n" +
    "  insolvent market is worse for everyone than a wide spread.\n",
);
