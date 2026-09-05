import { test } from "node:test";
import assert from "node:assert/strict";
import { auditMarket, fingerprint, type OnChainMarket } from "../src/audit.ts";
import { CALIBRATED_MARKETS } from "../src/generated/markets.ts";
import { PROB_ONE } from "../src/pricing.ts";

const btc15m = CALIBRATED_MARKETS.find((m) => m.key === "BTC")!.rounds[0];

/** A settled market that should pass every check. */
function honest(): OnChainMarket {
  return {
    id: 1,
    pair: "BTC/USD",
    cutoffAt: 1_800_000_900,
    sigma1e4: btc15m.sigma1e4,
    houseEdgeBps: 400n,
    isSettled: true,
    settledPrice: 7_967_722_750_000n,
    settledAt: 1_800_000_800,
    settledSources: 11,
    staked: 1_000n,
    paid: 900n,
    table: btc15m.probTable,
  };
}

const verdict = (m: OnChainMarket, key: string, known?: readonly bigint[]) =>
  auditMarket(m, known).checks.find((c) => c.key === key)?.verdict;

test("an honest settled market passes every check", () => {
  const a = auditMarket(honest(), btc15m.probTable);
  const failed = a.checks.filter((c) => c.verdict === "failed");
  assert.deepEqual(
    failed.map((c) => c.key),
    [],
  );
  assert.ok(a.sound);
});

test("every check names what it compared and why it matters", () => {
  // A verifier whose failures are unreadable is a verifier nobody acts on.
  for (const c of auditMarket(honest(), btc15m.probTable).checks) {
    assert.ok(c.claim.length > 10, `${c.key} has no claim`);
    assert.ok(c.matters.length > 30, `${c.key} does not say why it matters`);
    assert.ok(c.onChain.length > 0 && c.recomputed.length > 0, `${c.key} shows no values`);
  }
});

test("a substituted table is caught", () => {
  // The tamper that would otherwise be invisible: the contract settles honestly, pays
  // correctly, and offered odds nobody can check against the published calibration.
  const tampered = honest();
  const table = [...tampered.table];
  table[8] = table[8] + 1n;
  tampered.table = table;

  assert.equal(verdict(tampered, "table-is-the-published-one", btc15m.probTable), "failed");
  // And only that check: a one-unit change still leaves a valid CDF and a solvent market.
  assert.equal(verdict(tampered, "table-is-a-cdf", btc15m.probTable), "ok");
  assert.equal(verdict(tampered, "conservation", btc15m.probTable), "ok");
});

test("a dipped table is caught even with nothing to compare against", () => {
  const tampered = honest();
  const table = [...tampered.table];
  table[5] = 0n;
  tampered.table = table;
  assert.equal(verdict(tampered, "table-is-a-cdf"), "failed");
});

test("a table claiming certainty is caught", () => {
  const tampered = honest();
  const table = [...tampered.table];
  table[16] = PROB_ONE + 1n;
  tampered.table = table;
  assert.equal(verdict(tampered, "table-is-a-cdf"), "failed");
});

test("a stale settling print is caught", () => {
  const tampered = honest();
  // Published sixteen minutes before the cutoff, past the contract's own limit.
  tampered.settledAt = tampered.cutoffAt - 960;
  assert.equal(verdict(tampered, "price-was-fresh", btc15m.probTable), "failed");
});

test("a thin settling print is caught", () => {
  const tampered = honest();
  tampered.settledSources = 1;
  assert.equal(verdict(tampered, "price-was-broad", btc15m.probTable), "failed");
});

test("an insolvent market is caught", () => {
  const tampered = honest();
  tampered.paid = tampered.staked + 1n;
  const a = auditMarket(tampered, btc15m.probTable);
  assert.equal(verdict(tampered, "conservation", btc15m.probTable), "failed");
  assert.ok(!a.sound);
});

test("an undisclosed fee is caught", () => {
  const tampered = honest();
  tampered.houseEdgeBps = 900n;
  assert.equal(verdict(tampered, "fee-is-disclosed", btc15m.probTable), "failed");
});

test("an unsettled market leaves the price checks unrun rather than passing them", () => {
  // A verifier that reports "ok" for a check it could not run is worse than one that
  // reports nothing: it converts absence of evidence into evidence.
  const open = honest();
  open.isSettled = false;
  const a = auditMarket(open, btc15m.probTable);
  assert.equal(a.checks.find((c) => c.key === "settled")?.verdict, "unchecked");
  assert.ok(!a.checks.some((c) => c.key === "price-was-fresh"));
});

test("an unlisted pair is audited but not vouched for", () => {
  const odd = honest();
  odd.pair = "DOGE/USD";
  const a = auditMarket(odd);
  assert.equal(a.definition, null);
  assert.equal(verdict(odd, "table-is-the-published-one"), "unchecked");
});

test("the fingerprint changes when any knot changes", () => {
  const table = [...btc15m.probTable];
  const before = fingerprint(table);
  table[11] = table[11] + 1n;
  assert.notEqual(fingerprint(table), before);
});
