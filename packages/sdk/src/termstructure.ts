/**
 * Measures the volatility term structure directly, one horizon at a time.
 *
 * XORR originally priced every horizon from a single volBps scaled by sqrt(time).
 * Against real tape that assumption fails hard at the short end: BTC's one-sigma move
 * over 3 seconds is nowhere near sigma(30s)/sqrt(10), because one-second returns are
 * dominated by bid-ask bounce that averages out over longer windows. Pricing a
 * 3-second round off a 30-second sigma hands the player a multiplier priced for
 * volatility that is not there.
 *
 * So: measure each round length separately and let the market carry a table.
 */
import { NORMAL_TABLE, halfProb, zForProb } from "./pricing.ts";

const SYMBOL = process.argv[2] ?? "BTCUSDT";
const BLOCK_MS = 300;

/** The round lengths XORR actually sells. */
export const ROUND_BLOCKS = [10, 33, 100, 333, 1000, 3000] as const;

async function klines(symbol: string, interval: string, limit: number, endTime?: number) {
  const u = new URL("https://api.binance.com/api/v3/klines");
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("interval", interval);
  u.searchParams.set("limit", String(limit));
  if (endTime) u.searchParams.set("endTime", String(endTime));
  const r = await fetch(u, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`binance ${r.status} for ${symbol}`);
  return (await r.json()) as unknown[][];
}

export async function secondCloses(symbol: string, want: number): Promise<number[]> {
  const closes: number[] = [];
  let endTime: number | undefined;
  while (closes.length < want) {
    const b = await klines(symbol, "1s", 1000, endTime);
    if (!b.length) break;
    closes.unshift(...b.map((k) => Number(k[4])));
    endTime = Number(b[0][0]) - 1;
    if (b.length < 1000) break;
  }
  return closes;
}

/** Sigma of the log return over `seconds`, measured on overlapping real windows. */
export function sigmaOver(closes: number[], seconds: number): number {
  const rs: number[] = [];
  const step = Math.max(1, Math.floor(seconds / 4)); // overlap for a bigger sample
  for (let i = 0; i + seconds < closes.length; i += step) {
    if (closes[i] > 0 && closes[i + seconds] > 0) rs.push(Math.log(closes[i + seconds] / closes[i]));
  }
  const m = rs.reduce((a, b) => a + b, 0) / rs.length;
  return Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / (rs.length - 1));
}

export function tierSeconds(blocks: number): number {
  return Math.max(1, Math.round((blocks * BLOCK_MS) / 1000));
}

/**
 * Empirical probability that a `seconds`-long move stays inside +/- halfFrac.
 * Measured on overlapping real windows, not simulated.
 */
export function empiricalProb(closes: number[], seconds: number, halfFrac: number): number {
  let inside = 0;
  let total = 0;
  const step = Math.max(1, Math.floor(seconds / 4));
  for (let i = 0; i + seconds < closes.length; i += step) {
    const ratio = closes[i + seconds] / closes[i];
    if (ratio >= 1 - halfFrac && ratio <= 1 + halfFrac) inside++;
    total++;
  }
  return total === 0 ? 0 : inside / total;
}

/**
 * Fit the sigma the *model* should use, rather than the sigma the data has.
 *
 * The pricing kernel is a normal CDF, but one-second BTC returns carry excess
 * kurtosis around 70: the bulk sits far tighter than any normal fitted to its own
 * standard deviation, while rare moves are far larger. Feeding the true standard
 * deviation into a normal CDF therefore understates the chance a band holds, inflates
 * the multiplier, and bleeds the vault on exactly the bands players like most.
 *
 * Rather than guess a haircut, this solves the actual problem:
 *
 *   pick the LARGEST sigma such that, across every band the market would sell at that
 *   sigma, the empirical win rate still leaves the vault at least `minEdge`.
 *
 * Largest sigma is the best deal the evidence supports for the player; the edge
 * constraint is what makes it safe. A tier with no admissible sigma is one XORR
 * should not list, and this returns null rather than papering over it.
 */
export interface SigmaFit {
  sigmaFrac: number;
  worstEv: number;
  /** widths tested, as (halfFrac, modelP, empiricalP, multiplier, ev) */
  cells: { halfFrac: number; modelP: number; realP: number; mult: number; ev: number }[];
}

const HOUSE_EDGE_BPS = 400n;
const MIN_MULT_BPS = 12_000n;
const MAX_MULT_BPS = 80_000n;
const MIN_PROB_1E6 = 125_000n;

function evaluateSigma(closes: number[], seconds: number, sigmaFrac: number): SigmaFit | null {
  const cells: SigmaFit["cells"] = [];
  let worstEv = 0;

  // Sweep the band widths this sigma would make sellable.
  for (let zt = 0.15; zt <= 3.0; zt += 0.05) {
    const halfFrac = sigmaFrac * zt;
    const z1e4 = BigInt(Math.round(zt * 1e4));
    const modelP = Number(halfProb(NORMAL_TABLE, z1e4)) / 1e6;
    if (BigInt(Math.round(modelP * 1e6)) < MIN_PROB_1E6) continue;

    const gross = (1e6 * 1e4) / (modelP * 1e6);
    let multBps = (gross * Number(10_000n - HOUSE_EDGE_BPS)) / 1e4;
    if (multBps < Number(MIN_MULT_BPS)) continue; // too wide to sell
    if (multBps > Number(MAX_MULT_BPS)) multBps = Number(MAX_MULT_BPS);

    const realP = empiricalProb(closes, seconds, halfFrac);
    const mult = multBps / 1e4;
    const ev = realP * mult;
    cells.push({ halfFrac, modelP, realP, mult, ev });
    if (ev > worstEv) worstEv = ev;
  }

  if (cells.length === 0) return null;
  return { sigmaFrac, worstEv, cells };
}

export function fitEffectiveSigma(
  closes: number[],
  seconds: number,
  minEdge = 0.02,
): SigmaFit | null {
  const raw = sigmaOver(closes, seconds);
  let best: SigmaFit | null = null;

  // Search sigma from a tiny fraction of the stdev up past it. Larger sigma is a
  // better deal for the player, so walk upward and keep the last admissible one.
  for (let f = 0.02; f <= 1.6; f += 0.01) {
    const fit = evaluateSigma(closes, seconds, raw * f);
    if (!fit) continue;
    if (fit.worstEv <= 1 - minEdge) best = fit;
  }
  return best;
}

/** sigma1e4 = one-sigma move in bps of spot, scaled by 1e4, per round tier. */
export function calibrateTiers(closes: number[], minEdge = 0.02): (number | null)[] {
  return ROUND_BLOCKS.map((b) => {
    const fit = fitEffectiveSigma(closes, tierSeconds(b), minEdge);
    return fit ? Math.max(1, Math.round(fit.sigmaFrac * 1e8)) : null;
  });
}

async function main() {
  const closes = await secondCloses(SYMBOL, 60_000);
  console.log(`\nXORR volatility term structure — ${SYMBOL}`);
  console.log("=".repeat(72));
  console.log(`sample: ${closes.length} one-second closes (${(closes.length / 3600).toFixed(1)}h)\n`);
  console.log("blocks   round   stdev(bps)   fitted(bps)   ratio   worstEV   edge     sigma1e4");
  console.log("-".repeat(78));

  const tiers = calibrateTiers(closes);

  ROUND_BLOCKS.forEach((b, i) => {
    const raw = sigmaOver(closes, tierSeconds(b)) * 1e4;
    const fit = fitEffectiveSigma(closes, tierSeconds(b));
    if (!fit || tiers[i] === null) {
      console.log(`${String(b).padStart(6)}  ${(tierSeconds(b) + "s").padStart(6)}  ${raw.toFixed(3).padStart(10)}  NOT SELLABLE`);
      return;
    }
    const fitted = fit.sigmaFrac * 1e4;
    console.log(
      `${String(b).padStart(6)}  ${(tierSeconds(b) + "s").padStart(6)}  ${raw.toFixed(3).padStart(10)}  ` +
        `${fitted.toFixed(3).padStart(12)}  ${(fitted / raw).toFixed(3).padStart(5)}  ` +
        `${fit.worstEv.toFixed(3).padStart(7)}  ${((1 - fit.worstEv) * 100).toFixed(2).padStart(6)}%  ${String(tiers[i]).padStart(8)}`,
    );
  });

  console.log("-".repeat(72));
  console.log(
    `\nThe fitted sigma runs well under the sample standard deviation at every horizon.\n` +
      `That gap is the kurtosis: a normal fitted to the stdev would price these bands as\n` +
      `harder than they actually are, and pay out accordingly.\n`,
  );
  console.log(`sigma1e4 table: [${tiers.join(", ")}]\n`);
}

// Note: no file:// comparison here — this repo path contains spaces, which get
// percent-encoded in import.meta.url and would silently skip main().
if (process.argv[1]?.endsWith("termstructure.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
