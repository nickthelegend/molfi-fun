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
import {
  CALIBRATED_MARKETS,
  MARKETS,
  MAX_MULTIPLIER_BPS,
  MIN_MULTIPLIER_BPS,
  ROUND_SECONDS,
  type MarketDef,
} from "./markets.ts";

/**
 * The calibration molfi published for a pair and round length, if it published one.
 *
 * Looked up by both, because a table fitted for fifteen minutes is the wrong table for four
 * hours and comparing against the wrong one would report a substitution that never happened.
 */
export function publishedTable(
  pair: string,
  roundSeconds: number,
): readonly bigint[] | undefined {
  const m = CALIBRATED_MARKETS.find((c) => c.label === pair);
  return m?.rounds.find((r) => r.seconds === roundSeconds)?.probTable;
}

/** How old a settlement print may be, matching MAX_PRICE_AGE in `market.cairo`. */
export const MAX_PRICE_AGE = 900;

/** The publisher floor, matching MIN_SOURCES in `market.cairo`. */
export const MIN_SOURCES = 3;

/** A market exactly as the contract reports it. */
export interface OnChainMarket {
  id: number;
  pair: string;
  cutoffAt: number;
  /** How long the round was, in seconds, as the contract recorded it. */
  roundSeconds: number;
  sigma1e4: bigint;
  houseEdgeBps: bigint;
  isSettled: boolean;
  settledPrice: bigint;
  /** When the oracle published the settling print. */
  settledAt: number;
  /** When `settle` ran — the moment the contract measured the print's age against. */
  settledBlockAt: number;
  settledSources: number;
  staked: bigint;
  paid: bigint;
  /** What the house put behind this market. */
  bankroll: bigint;
  /** Payouts committed to positions still open. */
  reserved: bigint;
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
 * The published calibration is looked up from the market's own pair and recorded round
 * length, so the check that the contract prices with the table molfi published needs
 * nothing from the caller but the chain's own answer.
 */
export function auditMarket(m: OnChainMarket): Audit {
  const definition = MARKETS.find((d) => d.label === m.pair) ?? null;
  const known = publishedTable(m.pair, m.roundSeconds);
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

  // ---- the round is one molfi lists ------------------------------------------------------
  add({
    key: "round-is-listed",
    claim: "The round length is one molfi publishes a calibration for",
    verdict: ROUND_SECONDS.includes(m.roundSeconds as never) ? "ok" : "failed",
    onChain: `${m.roundSeconds}s`,
    recomputed: `listed: ${ROUND_SECONDS.join("s, ")}s`,
    matters:
      "A round length nothing was fitted for has no published table behind it, so its odds cannot be checked against anything — and if it is shorter than the oracle's publish interval it settles against a price that was already public when it opened.",
  });

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
    // The exact comparison the contract made: the print's age at the moment `settle` ran.
    // Comparing against the cutoff instead looks equivalent and is not — a print published
    // shortly *after* the cutoff is both legitimate and fresher, and that reading reported
    // a negative age for a market that had settled correctly.
    const age =
      m.settledAt > 0 && m.settledBlockAt > 0 ? m.settledBlockAt - m.settledAt : null;
    add({
      key: "price-was-fresh",
      claim: `The settling print was under ${MAX_PRICE_AGE}s old when the market settled`,
      verdict: age === null ? "unchecked" : age <= MAX_PRICE_AGE ? "ok" : "failed",
      onChain: `published ${m.settledAt}, settled ${m.settledBlockAt}`,
      recomputed: age === null ? "no timestamp" : `${age}s old at settlement`,
      matters:
        "A stale print settles every position in this market against a price that had already moved.",
    });

    add({
      key: "settled-after-cutoff",
      claim: "The market was not settled before its cutoff",
      verdict:
        m.settledBlockAt === 0
          ? "unchecked"
          : m.settledBlockAt >= m.cutoffAt
            ? "ok"
            : "failed",
      onChain: `settled ${m.settledBlockAt}, cutoff ${m.cutoffAt}`,
      recomputed:
        m.settledBlockAt === 0
          ? "no settle timestamp"
          : `${m.settledBlockAt - m.cutoffAt}s after cutoff`,
      matters:
        "Settling early resolves every band against a price from inside the round, which is a different question from the one anyone was betting on.",
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
  //
  // A market pays winners more than they staked — that is what a multiplier is — so the
  // bound is the stakes it took *plus* the bankroll the house put behind it, not the stakes
  // alone. Checking against stakes alone is not merely strict, it is wrong: it fails every
  // market that has correctly paid its first winner.
  const backing = m.staked + m.bankroll;
  add({
    key: "conservation",
    claim: "The market has never paid out more than the stakes and bankroll behind it",
    verdict: m.paid <= backing ? "ok" : "failed",
    onChain: `paid ${m.paid}, staked ${m.staked}, bankroll ${m.bankroll}`,
    recomputed: m.paid <= backing ? `${backing - m.paid} still held` : "insolvent",
    matters:
      "This is the only promise molfi makes about the money, and it is the reason all three totals are public. If it fails, someone's payout is funded by someone else's stake.",
  });

  add({
    key: "commitments-are-covered",
    claim: "Everything still owed to open positions is already covered",
    verdict: m.paid + m.reserved <= backing ? "ok" : "failed",
    onChain: `reserved ${m.reserved}, paid ${m.paid}, backing ${backing}`,
    recomputed:
      m.paid + m.reserved <= backing
        ? `${backing - m.paid - m.reserved} unallocated`
        : `${m.paid + m.reserved - backing} short`,
    matters:
      "The stronger promise, and the one that has to hold while a market is still open. Solvency measured only at claim time discovers a shortfall after the position was sold — the trader held a winning band all round and it does not pay. The contract reserves the full payout when a position opens, and this is that reservation checked from outside.",
  });

  // ---- the quote the contract would give -------------------------------------------------
  //
  // Priced at the settled price where there is one, and at a nominal spot where there is
  // not. The check is about the stored table and sigma, not about the price — tying it to a
  // settled price meant it never ran on an open market, which is exactly when a trader would
  // want to know the odds they are being offered can be reproduced.
  const NOMINAL_SPOT = 100_000_000_000n;
  const spot = m.settledPrice > 0n ? m.settledPrice : NOMINAL_SPOT;
  /**
   * Without the stored table there is nothing to reproduce, and saying so is the answer.
   *
   * `decodeMarket` only fills `table` when the caller asked for it, so an audit run on a
   * market read without one used to walk off the end of an empty array and throw
   * "Cannot mix BigInt and other types" out of the pricing kernel — a 500 for the caller,
   * from a function whose entire job is to report on things it cannot confirm.
   */
  if (m.sigma1e4 > 0n && m.table.length === 0) {
    add({
      key: "quote-is-reproducible",
      claim: "A one-sigma band prices to a sellable multiplier under the stored table",
      verdict: "unchecked",
      onChain: `sigma ${m.sigma1e4}, edge ${m.houseEdgeBps} bps`,
      recomputed: "the stored table was not read, so the quote cannot be recomputed",
      matters:
        "The desk and the contract run mirrored copies of the same integer kernel. This runs the kernel over what the contract stored, so a table and sigma that could only produce nonsense are caught here.",
    });
  } else if (m.sigma1e4 > 0n) {
    const half = (spot * m.sigma1e4) / 100_000_000n;
    if (half > 0n && half < spot) {
      const q = quote(m.table, spot, spot - half, spot + half, m.sigma1e4, m.houseEdgeBps);
      const inRange = q.multiplierBps >= MIN_MULTIPLIER_BPS && q.multiplierBps <= MAX_MULTIPLIER_BPS;
      add({
        key: "quote-is-reproducible",
        claim: "A one-sigma band prices to a sellable multiplier under the stored table",
        verdict: inRange ? "ok" : "failed",
        onChain: `sigma ${m.sigma1e4}, edge ${m.houseEdgeBps} bps${m.settledPrice > 0n ? "" : ", priced at a nominal spot"}`,
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
