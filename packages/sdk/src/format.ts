import { BLOCK_MS } from "./markets.ts";

/** 8-decimal chain price to a display string. */
export function fmtPrice(p: bigint, dp = 2): string {
  const neg = p < 0n;
  const v = neg ? -p : p;
  const whole = v / 100_000_000n;
  const frac = v % 100_000_000n;
  const fracStr = frac.toString().padStart(8, "0").slice(0, dp);
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${w}${dp > 0 ? "." + fracStr : ""}`;
}

/** 6-decimal asset units to a dollar string. */
export function fmtUsd(v: bigint, dp = 2): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / 1_000_000n;
  const frac = (a % 1_000_000n).toString().padStart(6, "0").slice(0, dp);
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${w}${dp > 0 ? "." + frac : ""}`;
}

export function fmtMultiplier(bps: bigint): string {
  return `${(Number(bps) / 10_000).toFixed(2)}x`;
}

export function fmtProb(p1e6: bigint): string {
  return `${(Number(p1e6) / 10_000).toFixed(1)}%`;
}

/** Blocks to a human duration, at Monad's 300ms cadence. */
export function blocksToMs(blocks: number): number {
  return blocks * BLOCK_MS;
}

export function fmtBlocksAsTime(blocks: number): string {
  const ms = blocksToMs(blocks);
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s % 1 === 0 ? s.toFixed(0) : s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/** Parse a decimal dollar string into 6-decimal asset units. */
export function parseUsd(s: string): bigint {
  const [w, f = ""] = s.replace(/[$,]/g, "").split(".");
  return BigInt(w || "0") * 1_000_000n + BigInt((f + "000000").slice(0, 6));
}
