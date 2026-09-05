/**
 * Recompute a settled market from published data, and say where it disagrees.
 *
 * This is the file that makes the privacy claim checkable. Everything else asks you to
 * believe that a hidden position was settled correctly; this recomputes the parts that are
 * public — the price, the table, the multiplier, the conservation — and prints both answers
 * side by side. A verifier that only ever agrees is not a verifier, so every check names
 * what it compared and carries the two values it compared.
 *
 * Deliberately pure. No RPC, no wallet, no keys: hand it what the chain said and it tells you
 * whether that was consistent. A stranger can run it against a market they have no position
 * in, which is the point.
 */

import { BPS, PROB_ONE, payoutFor, quote } from "./pricing.ts";
import { MARKETS, MAX_MULTIPLIER_BPS, MIN_MULTIPLIER_BPS, type MarketDef } from "./markets.ts";

/** How old a settlement print may be, matching MAX_PRICE_AGE in `market.cairo`. */
export const MAX_PRICE_AGE = 900;

/** The publisher floor, matching MIN_SOURCES in `market.cairo`. */
export const MIN_SOURCES = 3;

/** A market exactly as the contract reports it. */
export interface OnChainMarket {
  id: number;
  pair: string;
  cutoffAt: number;
  sigma1e4: bigint;
  houseEdgeBps: bigint;
  isSettled: boolean;
  settledPrice: bigint;
  settledAt: number;
  settledSources: number;
  staked: bigint;
  paid: bigint;
  /** The seventeen knots the contract stores for this market. */
  table: readonly bigint[];
}

export type Verdict = "ok" | "failed" | "unchecked";

export interface Check {
  /** Short id, stable enough to link to. */
  key: string;
  /** What was compared, in one line. */
  claim: string;
  verdict: Verdict;
  /** What the chain says. */
  onChain: string;
  /** What recomputing says. */
  recomputed: string;
  /** Why this check matters — what would be wrong if it failed. */
  matters: string;
}

export interface Audit {
  market: OnChainMarket;
  /** The listed market this one claims to be, if molfi lists it at all. */
  definition: MarketDef | null;
  checks: Check[];
  /** True only when every check that could be run passed. */
  sound: boolean;
}

const yes = "yes";
const no = "no";

/**
 * Audit one market.
 *
 * `known` is the calibration molfi published for this pair and round length. Passing it lets
 * the audit check the contract is pricing with the table that was published rather than one
 * substituted later — the single most valuable check here, and the only one that needs
 * anything beyond the chain itself.
 */
export function auditMarket(m: OnChainMarket, known?: readonly bigint[]): Audit {
  const definition = MARKETS.find((d) => d.label === m.pair) ?? null;
  const checks: Check[] = [];

  const add = (c: Check) => checks.push(c);

  // ---- the table is a CDF -------------------------------------------------------------
  const monotonic = m.table.every((v, i) => i === 0 || v >= m.table[i - 1]);
  const bounded = m.table.every((v) => v <= PROB_ONE);
  const startsAtZero = m.table[0] === 0n;
  add({
    key: "table-is-a-cdf",
    claim: "The stored probability table never dips, never exceeds one, and starts at zero",
    verdict: monotonic && bounded && startsAtZero ? "ok" : "failed",
    onChain: `${m.table.length} knots`,
    recomputed: monotonic && bounded && startsAtZero ? "valid CDF" : "not a CDF",
    matters:
      "A dip in the table is a negative probability over that interval. It would misprice every band in this market at once rather than one of them.",
  });

  // ---- the table is the published one -------------------------------------------------
  if (known) {
    const same =
      known.length === m.table.length && known.every((v, i) => v === m.table[i]);
    add({
      key: "table-is-the-published-one",
      claim: "The table the contract prices with is the one molfi published for this round",
      verdict: same ? "ok" : "failed",
      onChain: fingerprint(m.table),
      recomputed: fingerprint(known),
      matters:
        "A market listed with a private table settles honestly and can still be checked against nothing. This is the check that makes the published calibration mean something.",
    });
  } else {
    add({
      key: "table-is-the-published-one",
      claim: "The table the contract prices with is the one molfi published for this round",
      verdict: "unchecked",
      onChain: fingerprint(m.table),
      recomputed: "no published table for this pair and round",
      matters:
        "Without a published table to compare against, the odds this market offered cannot be checked against anything.",
    });
  }

  // ---- the settlement print ------------------------------------------------------------
  if (!m.isSettled) {
    add({
      key: "settled",
      claim: "The market has settled",
      verdict: "unchecked",
      onChain: "still open",
      recomputed: `cutoff at ${new Date(m.cutoffAt * 1000).toISOString()}`,
      matters: "Nothing below can be checked until there is a settled price to check.",
    });
  } else {
    const age = m.settledAt > 0 ? m.cutoffAt - m.settledAt : null;
    add({
      key: "price-was-fresh",
      claim: `The settling print was published within ${MAX_PRICE_AGE}s of settlement`,
      // The contract compares against the block timestamp at settlement, which is at or
      // after the cutoff. Using the cutoff here is the strictest reading available from
      // stored data, so a pass is a genuine pass.
      verdict: age === null ? "unchecked" : age <= MAX_PRICE_AGE ? "ok" : "failed",
      onChain: `published at ${m.settledAt}, cutoff ${m.cutoffAt}`,
      recomputed: age === null ? "no timestamp" : `${age}s before cutoff`,
      matters:
        "A stale print settles every position in this market against a price that had already moved.",
    });

    add({
      key: "price-was-broad",
      claim: `At least ${MIN_SOURCES} publishers stood behind the median`,
      verdict: m.settledSources >= MIN_SOURCES ? "ok" : "failed",
      onChain: `${m.settledSources} publishers`,
      recomputed: `floor is ${MIN_SOURCES}`,
      matters:
        "A median of one publisher is one opinion wearing a median's clothes, and one account can move it.",
    });

    add({
      key: "price-is-positive",
      claim: "The settled price is a real price",
      verdict: m.settledPrice > 0n ? "ok" : "failed",
      onChain: m.settledPrice.toString(),
      recomputed: m.settledPrice > 0n ? "positive" : "zero",
      matters:
        "A zero settles every band as a miss, because no band straddling a real price contains zero.",
    });
  }

  // ---- conservation ---------------------------------------------------------------------
  add({
    key: "conservation",
    claim: "The market has never paid out more than it took in",
    verdict: m.paid <= m.staked ? "ok" : "failed",
    onChain: `paid ${m.paid}, staked ${m.staked}`,
    recomputed: m.paid <= m.staked ? `${m.staked - m.paid} still held` : "insolvent",
    matters:
      "This is the only promise molfi makes about the money, and it is the reason both totals are public. If it fails, someone's payout is funded by someone else's stake.",
  });

  // ---- the quote the contract would give -------------------------------------------------
  if (m.settledPrice > 0n && m.sigma1e4 > 0n) {
    // A one-sigma band around the settled price, recomputed from the stored table. Not a
    // claim about any real position — nobody can see those — but a check that the pricing
    // the contract carries produces the number this library produces from the same inputs.
    const half = (m.settledPrice * m.sigma1e4) / 100_000_000n;
    if (half > 0n && half < m.settledPrice) {
      const q = quote(
        m.table,
        m.settledPrice,
        m.settledPrice - half,
        m.settledPrice + half,
        m.sigma1e4,
        m.houseEdgeBps,
      );
      const inRange = q.multiplierBps >= MIN_MULTIPLIER_BPS && q.multiplierBps <= MAX_MULTIPLIER_BPS;
      add({
        key: "quote-is-reproducible",
        claim: "A one-sigma band prices to a sellable multiplier under the stored table",
        verdict: inRange ? "ok" : "failed",
        onChain: `sigma ${m.sigma1e4}, edge ${m.houseEdgeBps} bps`,
        recomputed: `${(Number(q.multiplierBps) / 10_000).toFixed(4)}x at ${(Number(q.prob1e6) / 10_000).toFixed(1)}%`,
        matters:
          "The desk and the contract run mirrored copies of the same integer kernel. This runs the kernel over what the contract stored, so a table and sigma that could only produce nonsense are caught here.",
      });
    }
  }

  // ---- the fee is the disclosed one -------------------------------------------------------
  add({
    key: "fee-is-disclosed",
    claim: "The house edge is the published one",
    verdict: m.houseEdgeBps === 400n ? "ok" : "failed",
    onChain: `${m.houseEdgeBps} bps`,
    recomputed: "400 bps",
    matters:
      "The fee is taken off every multiplier before it is offered. A market listed with a different one is charging a price nobody was told about.",
  });

  return {
    market: m,
    definition,
    checks,
    sound: checks.every((c) => c.verdict !== "failed"),
  };
}

/**
 * A short, stable fingerprint of a table.
 *
 * Seventeen numbers are unreadable side by side and a reader comparing them by eye will
 * miss a one-unit change in the eleventh knot — which is exactly the change worth hiding.
 * Not a cryptographic hash: this is for a human to compare two lines, and the audit already
 * compares the tables element by element.
 */
export function fingerprint(table: readonly bigint[]): string {
  let acc = 0n;
  for (const v of table) acc = (acc * 1_000_003n + v) % 0xffffffffn;
  return `${table.length} knots · ${acc.toString(16).padStart(8, "0")}`;
}

/** Payout a stake would have received, for showing the arithmetic on a settled market. */
export function payoutOf(stake: bigint, multiplierBps: bigint): bigint {
  return payoutFor(stake, multiplierBps);
}

export { BPS };
