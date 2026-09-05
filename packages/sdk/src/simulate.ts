/**
 * Vault safety simulation.
 *
 * The pricing model assumes returns are normal. Real crypto returns are not: at one
 * second BTC shows excess kurtosis around 70. A leptokurtic distribution has a taller
 * peak AND fatter tails than the normal, which cuts both ways for a "stay inside the
 * band" ticket:
 *
 *   tight bands  -> the extra mass at the peak makes them EASIER than priced -> vault bleeds
 *   wide bands   -> the fatter tails make them HARDER than priced            -> vault gains
 *
 * So "fat tails are good for the house" is only half true, and which half you get
 * depends on band width. This measures it instead of assuming it, by bootstrapping
 * contiguous windows of real returns (preserving volatility clustering, which an iid
 * bootstrap would destroy) and pricing every band with the production quote function.
 *
 * Usage: node src/simulate.ts [SYMBOL] [volBps]
 */
import { NORMAL_TABLE, quote, sigmaBps1e4 } from "./pricing.ts";

const SYMBOL = process.argv[2] ?? "BTCUSDT";
const BLOCK_MS = 300;
const REF_BLOCKS = 100n;
const HOUSE_EDGE_BPS = 400n;
const MIN_MULT = 12_000n;
const MAX_MULT = 80_000n;
const MIN_PROB = 125_000n;
const PATHS = 20_000;

async function klines(symbol: string, interval: string, limit: number, endTime?: number) {
  const u = new URL("https://api.binance.com/api/v3/klines");
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("interval", interval);
  u.searchParams.set("limit", String(limit));
  if (endTime) u.searchParams.set("endTime", String(endTime));
  const r = await fetch(u, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`binance ${r.status}`);
  return (await r.json()) as unknown[][];
}

async function secondReturns(symbol: string, want: number): Promise<number[]> {
  const closes: number[] = [];
  let endTime: number | undefined;
  while (closes.length < want) {
    const b = await klines(symbol, "1s", 1000, endTime);
    if (!b.length) break;
    closes.unshift(...b.map((k) => Number(k[4])));
    endTime = Number(b[0][0]) - 1;
    if (b.length < 1000) break;
  }
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  return r;
}

/** Sum a contiguous run of real returns, preserving volatility clustering. */
function pathReturn(rets: number[], seconds: number, rng: () => number): number {
  const start = Math.floor(rng() * (rets.length - seconds - 1));
  let acc = 0;
  for (let i = 0; i < seconds; i++) acc += rets[start + i];
  return acc;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const rets = await secondReturns(SYMBOL, 60_000);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd1s = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));

  // volBps: one sigma over 100 blocks (30s), in bps of spot
  const volBps = BigInt(process.argv[3] ?? Math.max(1, Math.round(sd1s * Math.sqrt(30) * 1e4 * 0.85)));

  console.log(`\nXORR vault simulation — ${SYMBOL}`);
  console.log("=".repeat(78));
  console.log(`sample      : ${rets.length} one-second returns (${(rets.length / 3600).toFixed(1)}h)`);
  console.log(`sigma(1s)   : ${(sd1s * 1e4).toFixed(3)} bps`);
  console.log(`volBps      : ${volBps}  (one sigma over ${REF_BLOCKS} blocks / 30s)`);
  console.log(`paths       : ${PATHS.toLocaleString()} contiguous-window bootstraps per cell\n`);

  const SPOT = 100_000_00000000n; // 1e5 at 8dp
  const horizons = [10, 33, 100, 333, 1000, 3000, 6000];
  const widths = [0.4, 0.6, 0.8, 1.0, 1.3, 1.7, 2.2];

  console.log(
    "blocks   round    band(σ)  modelP   realP    offered   EV      edge     verdict",
  );
  console.log("-".repeat(78));

  let worstEv = Infinity;
  let worstCell = "";
  let staked = 0;
  let returned = 0;

  for (const blocks of horizons) {
    const seconds = Math.max(1, Math.round((blocks * BLOCK_MS) / 1000));
    for (const w of widths) {
      // Band half-width in price terms, w sigmas wide under the model's own sigma.
      const sigmaFrac = (Number(volBps) / 1e4) * Math.sqrt(blocks / Number(REF_BLOCKS));
      const halfFrac = sigmaFrac * w;
      const half = BigInt(Math.round(Number(SPOT) * halfFrac));
      if (half <= 0n) continue;

      const low = SPOT - half;
      const high = SPOT + half;

      let q;
      try {
        q = quote(
          NORMAL_TABLE,
          SPOT,
          low,
          high,
          sigmaBps1e4(volBps, BigInt(blocks), REF_BLOCKS),
          HOUSE_EDGE_BPS,
        );
      } catch {
        continue;
      }
      // Gates RangeMarket applies before it will sell the band.
      if (q.prob1e6 < MIN_PROB) continue;
      if (q.multiplierBps < MIN_MULT) continue;
      const offered = q.multiplierBps > MAX_MULT ? MAX_MULT : q.multiplierBps;

      const rng = mulberry32(blocks * 7919 + Math.round(w * 1000));
      let wins = 0;
      for (let i = 0; i < PATHS; i++) {
        const lr = pathReturn(rets, seconds, rng);
        const end = Math.exp(lr); // as a fraction of spot
        if (end >= 1 - halfFrac && end <= 1 + halfFrac) wins++;
      }
      const realP = wins / PATHS;
      const modelP = Number(q.prob1e6) / 1e6;
      const ev = realP * (Number(offered) / 1e4);

      staked += PATHS;
      returned += wins * (Number(offered) / 1e4);

      if (ev < worstEv) {
        worstEv = ev;
        worstCell = `${blocks} blocks @ ${w}σ`;
      }

      const roundS = (seconds).toFixed(0) + "s";
      const verdict = ev <= 1 ? "vault +" : "VAULT -";
      console.log(
        `${String(blocks).padStart(6)}  ${roundS.padStart(6)}  ${w.toFixed(1).padStart(7)}  ` +
          `${modelP.toFixed(4)}  ${realP.toFixed(4)}  ${(Number(offered) / 1e4).toFixed(3).padStart(7)}x  ` +
          `${ev.toFixed(3).padStart(6)}  ${((1 - ev) * 100).toFixed(2).padStart(6)}%  ${verdict}`,
      );
    }
  }

  const bookEdge = 1 - returned / staked;
  console.log("-".repeat(78));
  console.log(`\nbook-wide edge across every sellable cell : ${(bookEdge * 100).toFixed(2)}%`);
  console.log(`worst single cell                        : EV ${worstEv.toFixed(3)} at ${worstCell}`);
  if (worstEv > 1) {
    console.log(`\n  NEGATIVE-EV CELL PRESENT — do not fund a live vault at this volBps.`);
    process.exitCode = 1;
  } else {
    console.log(`\n  every sellable band is +EV for the vault against real ${SYMBOL} tape.`);
  }
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
