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
import { CALIBRATED_MARKETS as PUBLISHED } from "./generated/markets.ts";

/** The pairs, and the tape each is fitted from. Binance is used to calibrate, never to settle. */
/**
 * A pair earns a place here by clearing two bars at once, and most do not.
 *
 * **Pragma must carry it with at least three publishers and a fresh print**, because that is
 * what `settle` demands — a market listed against a thinner or staler feed can be opened and
 * never resolve. **And an exchange must carry ninety days of minutes for it**, because the
 * probability table is measured rather than assumed and there is nothing to measure without
 * tape.
 *
 * Checked against Pragma mainnet rather than guessed. Of forty candidates only these clear
 * both: SOL, AVAX, DOGE, LINK, BNB, XRP, ADA, ARB, OP and the rest either have no Pragma feed
 * at all or return no data. UNI, DAI and ZEND have one publisher and prints months old.
 * EKUBO and LORDS *do* clear Pragma with three publishers each — they are Starknet-native and
 * genuinely volatile, which would make them the most interesting markets here — but no
 * exchange carries minute tape for either, so there is nothing to fit a table from and
 * listing them would mean quoting odds nobody measured.
 *
 * USDC and USDT clear both bars and are deliberately excluded: a prediction market on
 * something pinned at a dollar is not a market. Every band containing 1.00 wins essentially
 * always, the fitted sigma collapses toward zero, and the multiplier runs to the ceiling on
 * a bet with no uncertainty in it.
 */
const PAIRS = [
  // Settled from Pragma mainnet's own median. These four are the ones Pragma carries with
  // enough publishers; everything below them is settled through molfi's relay instead.
  { key: "BTC", label: "BTC/USD", tape: "BTCUSDT", settle: "pragma" as const },
  { key: "ETH", label: "ETH/USD", tape: "ETHUSDT", settle: "pragma" as const },
  { key: "STRK", label: "STRK/USD", tape: "STRKUSDT", settle: "pragma" as const },
  { key: "WBTC", label: "WBTC/USD", tape: "WBTCUSDT", settle: "pragma" as const },

  /**
   * Settled from molfi's own median across five independent exchanges.
   *
   * Pragma does not carry these at all — not thinly, not staled: `get_data_median` errors on
   * the pair id. So the choice was four markets or an oracle, and the audit already named the
   * only defensible version of the second: "a real median across three or more independent
   * exchanges with the true count attached, which is what an oracle is."
   *
   * That is what the keeper now computes and relays. Binance, Coinbase, Kraken, OKX and
   * Bybit are queried per round, the median is taken, and the **number that actually
   * answered** is what goes on chain — so `MIN_SOURCES >= 3` is enforced against a real
   * count rather than a number molfi asserted. Measured at the time of writing: all five
   * answer for all five pairs, agreeing to within 0.05%.
   *
   * The tape is deep for every one of them, which is the other bar: these are not thin
   * Starknet-native pools where 94% of minutes have no trade, they are the most liquid
   * alt pairs on earth.
   */
  { key: "SOL", label: "SOL/USD", tape: "SOLUSDT", settle: "molfi" as const },
  { key: "XRP", label: "XRP/USD", tape: "XRPUSDT", settle: "molfi" as const },
  { key: "DOGE", label: "DOGE/USD", tape: "DOGEUSDT", settle: "molfi" as const },
  { key: "LINK", label: "LINK/USD", tape: "LINKUSDT", settle: "molfi" as const },
  { key: "AVAX", label: "AVAX/USD", tape: "AVAXUSDT", settle: "molfi" as const },
];

/**
 * Pairs whose published table must not move, and why the tool enforces it rather than a note.
 *
 * `create_market` stores the table it was given, and the audit that makes the published
 * calibration mean anything is "the table the contract prices with is the one molfi
 * published". Refit an existing pair and every market already listed against it fails that
 * check. It has happened once: adding WBTC refit all four pairs at once and broke forty-nine
 * markets' audits.
 *
 * The previous defence was a paragraph at the top of the generated file asking the reader not
 * to re-run the generator, which is not a defence — the next person runs `pnpm calibrate`,
 * gets a clean-looking diff, and finds out later. These tables are now copied through from the
 * existing generated file verbatim, so re-running is safe by construction and adding a pair is
 * the only thing it can do.
 */
const FROZEN = new Set(["BTC", "ETH", "STRK", "WBTC"]);

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
out.push(` *  Tables for pairs already listed on chain are COPIED THROUGH unchanged — see FROZEN in`);
out.push(` *  run-calibrate.ts. Re-running this is safe: it can add a pair, it cannot move a`);
out.push(` *  published one out from under the markets already priced against it.`);
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
out.push(`  /** Where the tape came from. Calibration only — never a settlement price. */`);
out.push(`  source: string;`);
out.push(`  /**`);
out.push(`   * Which oracle settles this market.`);
out.push(`   *`);
out.push(`   * "pragma" is Pragma mainnet's own median, read straight off their aggregator.`);
out.push(`   * "molfi" is molfi's median across five independent exchanges, relayed on chain with`);
out.push(`   * the true number that answered. Both clear the contract's three-publisher floor; they`);
out.push(`   * are not the same trust assumption and the UI says which is which.`);
out.push(`   */`);
out.push(`  settle: "pragma" | "molfi";`);
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
  if (FROZEN.has(pair.key)) {
    const kept = PUBLISHED.find((m) => m.key === pair.key);
    if (!kept) throw new Error(`${pair.key} is frozen but has no published table to keep`);
    process.stderr.write(`  ${pair.key}: keeping the published table (frozen)\n`);
    out.push(`  {`);
    out.push(`    key: ${JSON.stringify(kept.key)},`);
    out.push(`    label: ${JSON.stringify(kept.label)},`);
    out.push(`    source: ${JSON.stringify(kept.source)},`);
    out.push(`    settle: ${JSON.stringify(pair.settle)},`);
    out.push(`    live: ${kept.live},`);
    out.push(`    rounds: [`);
    for (const r of kept.rounds) {
      out.push(`      {`);
      out.push(`        seconds: ${r.seconds},`);
      out.push(`        sigma1e4: ${r.sigma1e4}n,`);
      out.push(`        minProb1e6: ${r.minProb1e6}n,`);
      out.push(`        maxMultiplierBps: ${r.maxMultiplierBps}n,`);
      out.push(`        probTable: [${r.probTable.map((t) => `${t}n`).join(", ")}],`);
      out.push(`      },`);
    }
    out.push(`    ],`);
    out.push(`  },`);
    continue;
  }

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
  out.push(`    settle: ${JSON.stringify(pair.settle)},`);
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
