/**
 * Display formatting, in one place.
 *
 * Three scales meet in this app and mixing any two produces a number that looks plausible
 * and is wrong: Pragma prints prices at 8 decimals, STRK is an 18 decimal token, and the
 * paper desk keeps balances in 6 decimal units so a starting bankroll reads as dollars.
 * Every conversion between them is here.
 */

import { ROUND_SECONDS } from "./generated/markets.ts";

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

/** 6-decimal paper units to a dollar string. */
export function fmtUsd(v: bigint, dp = 2): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / 1_000_000n;
  const frac = (a % 1_000_000n).toString().padStart(6, "0").slice(0, dp);
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${w}${dp > 0 ? "." + frac : ""}`;
}

/** Parse a decimal dollar string into 6-decimal paper units. */
export function parseUsd(s: string): bigint {
  const [w, f = ""] = s.replace(/[$,]/g, "").split(".");
  return BigInt(w || "0") * 1_000_000n + BigInt((f + "000000").slice(0, 6));
}

/** STRK is an 18 decimal token; every real stake and payout is in these units. */
export const STAKE_DECIMALS = 18;
export const ONE_STRK = 10n ** BigInt(STAKE_DECIMALS);

/** Token units to a display string, truncating rather than rounding up. */
export function fmtStrk(units: bigint, dp = 3): string {
  const neg = units < 0n;
  const a = neg ? -units : units;
  const whole = (a / ONE_STRK).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (a % ONE_STRK).toString().padStart(STAKE_DECIMALS, "0").slice(0, dp);
  return `${neg ? "-" : ""}${whole}${dp > 0 ? "." + frac : ""}`;
}

/** A human amount of STRK to token units, without a float ever touching the bigint side. */
export function parseStrk(amount: number | string): bigint {
  const s = typeof amount === "number" ? amount.toFixed(STAKE_DECIMALS) : amount;
  const [w, f = ""] = s.replace(/,/g, "").split(".");
  return BigInt(w || "0") * ONE_STRK + BigInt((f + "0".repeat(STAKE_DECIMALS)).slice(0, STAKE_DECIMALS));
}

export function fmtMultiplier(bps: bigint): string {
  return `${(Number(bps) / 10_000).toFixed(2)}x`;
}

export function fmtProb(p1e6: bigint): string {
  return `${(Number(p1e6) / 10_000).toFixed(1)}%`;
}

/** A round length in seconds, as a human duration. */
export function fmtSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 7_200) {
    const m = seconds / 60;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}m`;
  }
  const h = seconds / 3_600;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

/** Time left on a round, as a countdown. */
export function fmtCountdown(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const h = Math.floor(seconds / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** Milliseconds a round tier lasts. */
export function tierToMs(tier: number): number {
  return (ROUND_SECONDS[tier] ?? 0) * 1_000;
}
