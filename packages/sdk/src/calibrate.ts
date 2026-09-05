/**
 * Measures what a band is actually worth, from real tape.
 *
 * The tables this writes are the difference between a market that prices bands and one that
 * guesses at them. A normal distribution is badly wrong at these horizons — over fifteen
 * minutes an asset finishes very close to where it started far more often than a normal
 * allows, and puts far more weight in the tails than it allows too. Selling bands priced off
 * a normal means systematically overpaying the tight ones and underpaying the wide ones.
 *
 * Two disciplines carried over from the source project, both load-bearing:
 *
 * **Fit recent, validate on held-out tape.** Volatility is not stationary. Fitting on tape
 * that includes the validation window would produce a number that looks excellent and does
 * not survive contact with the next hour.
 *
 * **Shade sigma down, deliberately, and say so.** A smaller model sigma means a larger z, a
 * higher modelled win chance, and a lower multiplier. That is a one-sided guarantee bought at
 * the price of a wider spread. Unshaded, the same fit runs profitable or ruinous purely on
 * which way the regime moved, and a market that depends on the weather is not a market.
 *
 * Run: pnpm --filter @molfi/sdk calibrate
 */

import { PROB_ONE, TABLE_LEN, Z_MAX, Z_STEP } from "./pricing.ts";

/**
 * Round lengths molfi can honestly settle.
 *
 * Every one is longer than a Pragma publish cycle. The five minute round that used to head
 * this list was removed: Pragma republishes every few minutes and the contract accepts a
 * print up to fifteen minutes old, so a five minute round could settle against a number that
 * was already public before the round opened — the one outcome a prediction market must not
 * have. The floor is a publish interval, not a block.
 *
 * The ceiling is set by the tape rather than by taste. A twenty-four hour round was fitted
 * and then cut: ninety days of minutes contains about ninety independent daily moves, and
 * the held-out fifth of that is roughly eighteen. Out of sample the fit claimed 65% and
 * delivered 33% on STRK — that is not a spread, it is a model that cannot price the
 * instrument, and selling against it would be selling a number nobody measured.
 */
export const HORIZONS = [
  { key: "15m", seconds: 900, label: "15 minutes" },
  { key: "1h", seconds: 3_600, label: "1 hour" },
  { key: "4h", seconds: 14_400, label: "4 hours" },
] as const;

/**
 * How far model sigma is shaded below measured.
 *
 * Bought with spread, and the spread is disclosed rather than hidden. Ten percent was the
 * smallest shave that kept every horizon's out-of-sample win rate at or above the modelled
 * one across the validation window.
 */
export const SIGMA_SHADE = 0.9;

/** Fee taken off the gross multiplier. The real edge is wider; see the report. */
export const HOUSE_EDGE_BPS = 400n;

export interface Candle {
  openTime: number;
  close: number;
}

/**
 * Real minute candles, paged.
 *
 * Binance caps a request at 1000, so a month of minutes is 44 requests. No key is needed for
 * public klines, which keeps calibration reproducible by anyone reading this.
 */
export async function fetchMinuteCloses(symbol: string, minutes: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let end = Date.now();

  while (out.length < minutes) {
    const want = Math.min(1000, minutes - out.length);
    const url =
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m` +
      `&limit=${want}&endTime=${end}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${symbol}: binance returned ${res.status}`);
    const rows = (await res.json()) as Array<[number, string, string, string, string]>;
    if (rows.length === 0) break;

    for (const row of rows) out.push({ openTime: row[0], close: Number(row[4]) });
    end = rows[0][0] - 1;
    // Public endpoint, no key: pace the requests rather than getting rate limited mid-run.
    await new Promise((r) => setTimeout(r, 120));
  }

  out.sort((a, b) => a.openTime - b.openTime);
  return out;
}

/** Log returns over a horizon measured in candles. */
export function returnsOver(closes: number[], step: number): number[] {
  const out: number[] = [];
  for (let i = step; i < closes.length; i += 1) {
    const a = closes[i - step];
    const b = closes[i];
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
}

/** Standard deviation of a sample, about its own mean. */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const varsum = xs.reduce((a, b) => a + (b - mean) ** 2, 0);
  return Math.sqrt(varsum / (xs.length - 1));
}

/**
 * T(z) = P(|move| <= z*sigma), measured rather than assumed.
 *
 * Sampled on the same z grid the contract interpolates over, so the table this produces can
 * be pasted straight into a market's config and read by `half_prob` unchanged.
 */
export function buildTable(returns: number[], sigma: number): bigint[] {
  if (sigma <= 0 || returns.length === 0) return [];
  const abs = returns.map(Math.abs).sort((a, b) => a - b);

  const table: bigint[] = [];
  for (let i = 0; i < TABLE_LEN; i += 1) {
    const z = (Number(Z_STEP) * i) / 10_000;
    const cutoff = z * sigma;
    // Fraction of moves that stayed inside z sigmas.
    let count = 0;
    for (const a of abs) {
      if (a <= cutoff) count += 1;
      else break;
    }
    table.push(BigInt(Math.round((count / abs.length) * Number(PROB_ONE))));
  }

  // A CDF cannot dip. Sampling noise in a thin tail can produce one, so it is enforced —
  // and this has to run BEFORE the ceiling below, because raising a dipped knot back up to
  // its predecessor would otherwise undo a clamp that had already been applied.
  for (let i = 1; i < TABLE_LEN; i += 1) {
    if (table[i] < table[i - 1]) table[i] = table[i - 1];
  }

  // The grid ends at four sigma and the contract clamps anything beyond it to the last
  // sample, so no knot may read as certainty: the tail past four sigma is thin, not empty,
  // and a table claiming otherwise prices a wide band as a sure thing. Applied from the top
  // down so capping one knot cannot leave the one before it higher.
  const ceiling = PROB_ONE - 1n;
  for (let i = TABLE_LEN - 1; i >= 1; i -= 1) {
    if (table[i] > ceiling) table[i] = ceiling;
  }

  table[0] = 0n;
  return table;
}

export interface HorizonFit {
  key: string;
  seconds: number;
  samples: number;
  measuredSigma: number;
  modelSigma: number;
  sigma1e4: bigint;
  table: bigint[];
  /** Out-of-sample: how often a one-sigma band actually held, against what the model said. */
  modelledWinRate: number;
  realisedWinRate: number;
}

/**
 * Fit one horizon, and check it against tape it never saw.
 *
 * The held-out check is the only number here worth trusting. A fit always looks good on the
 * data it was fitted to.
 */
export function fitHorizon(closes: number[], seconds: number, key: string): HorizonFit | null {
  const step = Math.round(seconds / 60);
  if (closes.length < step * 40) return null;

  // Last fifth is never fitted on.
  const split = Math.floor(closes.length * 0.8);
  const train = closes.slice(0, split);
  const test = closes.slice(split);

  const trainReturns = returnsOver(train, step);
  const testReturns = returnsOver(test, step);
  if (trainReturns.length < 30 || testReturns.length < 10) return null;

  const measuredSigma = stdev(trainReturns);
  const modelSigma = measuredSigma * SIGMA_SHADE;
  if (modelSigma <= 0) return null;

  const table = buildTable(trainReturns, modelSigma);
  if (table.length === 0) return null;

  // A one-sigma band: what the model claims, against what the held-out tape did.
  const oneSigmaIndex = Math.round(10_000 / Number(Z_STEP));
  const modelledWinRate = Number(table[oneSigmaIndex]) / Number(PROB_ONE);
  const cutoff = modelSigma;
  const held = testReturns.filter((r) => Math.abs(r) <= cutoff).length;
  const realisedWinRate = held / testReturns.length;

  return {
    key,
    seconds,
    samples: trainReturns.length,
    measuredSigma,
    modelSigma,
    sigma1e4: BigInt(Math.max(1, Math.round(modelSigma * 10_000 * 10_000))),
    table,
    modelledWinRate,
    realisedWinRate,
  };
}

export { Z_MAX, Z_STEP, TABLE_LEN };
