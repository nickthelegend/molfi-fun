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
    roundSeconds: 900,
    sigma1e4: btc15m.sigma1e4,
    houseEdgeBps: 400n,
    isSettled: true,
    settledPrice: 7_967_722_750_000n,
    settledAt: 1_800_000_880,
    settledBlockAt: 1_800_000_910,
    settledSources: 11,
    staked: 1_000n,
    paid: 1_250n,
    bankroll: 10_000n,
    reserved: 0n,
    table: btc15m.probTable,
  };
}

const verdict = (m: OnChainMarket, key: string) =>
  auditMarket(m).checks.find((c) => c.key === key)?.verdict;

test("an honest settled market passes every check", () => {
  const a = auditMarket(honest());
  const failed = a.checks.filter((c) => c.verdict === "failed");
  assert.deepEqual(
    failed.map((c) => c.key),
    [],
  );
  assert.ok(a.sound);
});

test("every check names what it compared and why it matters", () => {
  // A verifier whose failures are unreadable is a verifier nobody acts on.
  for (const c of auditMarket(honest()).checks) {
    assert.ok(c.claim.length > 10, `${c.key} has no claim`);
    assert.ok(c.matters.length > 30, `${c.key} does not say why it matters`);
    assert.ok(c.onChain.length > 0 && c.recomputed.length > 0, `${c.key} shows no values`);
  }
});

test("the published table is found from the chain's own answer alone", () => {
  // The check that matters most has to run without the caller supplying anything: a
  // verifier that only works when you already hand it the right table is a verifier that
  // trusts whoever ran it.
  assert.equal(verdict(honest(), "table-is-the-published-one"), "ok");
});

test("a substituted table is caught", () => {
  // The tamper that would otherwise be invisible: the contract settles honestly, pays
  // correctly, and offered odds nobody can check against the published calibration.
  const tampered = honest();
  const table = [...tampered.table];
  table[8] = table[8] + 1n;
  tampered.table = table;

  assert.equal(verdict(tampered, "table-is-the-published-one"), "failed");
  // And only that check: a one-unit change still leaves a valid CDF and a solvent market.
  assert.equal(verdict(tampered, "table-is-a-cdf"), "ok");
  assert.equal(verdict(tampered, "conservation"), "ok");
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
  // Published sixteen minutes before it was used, past the contract's own limit.
  tampered.settledAt = tampered.settledBlockAt - 960;
  assert.equal(verdict(tampered, "price-was-fresh"), "failed");
});

test("a print published after the cutoff is fresh, not stale", () => {
  // The reading that was wrong before the contract recorded its settle time: comparing the
  // publish time against the cutoff reported a negative age for a market that had settled
  // correctly, on a print that was newer than the cutoff rather than older.
  const late = honest();
  late.settledAt = late.cutoffAt + 30;
  late.settledBlockAt = late.cutoffAt + 60;
  assert.equal(verdict(late, "price-was-fresh"), "ok");
  assert.equal(verdict(late, "settled-after-cutoff"), "ok");
});

test("settling before the cutoff is caught", () => {
  const early = honest();
  early.settledBlockAt = early.cutoffAt - 1;
  assert.equal(verdict(early, "settled-after-cutoff"), "failed");
});

test("a round length nothing was fitted for is caught", () => {
  const odd = honest();
  odd.roundSeconds = 300;
  assert.equal(verdict(odd, "round-is-listed"), "failed");
  // And the table check cannot run, because there is no published table to compare with.
  assert.equal(verdict(odd, "table-is-the-published-one"), "unchecked");
});

test("a thin settling print is caught", () => {
  const tampered = honest();
  tampered.settledSources = 1;
  assert.equal(verdict(tampered, "price-was-broad"), "failed");
});

test("paying a winner more than their stake is solvent, not insolvent", () => {
  // The reading that was wrong before the contract had a bankroll: a market that had
  // correctly paid its first winner 1.25x reported as insolvent, because the bound used
  // was the stakes alone. Every honest market would have failed this check.
  assert.equal(verdict(honest(), "conservation"), "ok");
});

test("an insolvent market is caught", () => {
  const tampered = honest();
  tampered.paid = tampered.staked + tampered.bankroll + 1n;
  const a = auditMarket(tampered);
  assert.equal(verdict(tampered, "conservation"), "failed");
  assert.ok(!a.sound);
});

test("a market that has promised more than it can cover is caught", () => {
  // Caught while the market is still open, which is the only time it can be acted on.
  const overcommitted = honest();
  overcommitted.reserved = overcommitted.staked + overcommitted.bankroll;
  assert.equal(verdict(overcommitted, "commitments-are-covered"), "failed");
  assert.equal(verdict(overcommitted, "conservation"), "ok");
});

test("an undisclosed fee is caught", () => {
  const tampered = honest();
  tampered.houseEdgeBps = 900n;
  assert.equal(verdict(tampered, "fee-is-disclosed"), "failed");
});

test("an unsettled market leaves the price checks unrun rather than passing them", () => {
  // A verifier that reports "ok" for a check it could not run is worse than one that
  // reports nothing: it converts absence of evidence into evidence.
  const open = honest();
  open.isSettled = false;
  const a = auditMarket(open);
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

test("the quote check runs on an open market too", () => {
  // It used to require a settled price, so it never ran on an open market — which is
  // precisely when a trader would want to know the odds they are being offered can be
  // reproduced from what the contract stores. The check is about the table and sigma, not
  // about the price.
  const open = honest();
  open.isSettled = false;
  open.settledPrice = 0n;
  const a = auditMarket(open);
  const q = a.checks.find((c) => c.key === "quote-is-reproducible");
  assert.ok(q, "the quote check is absent on an open market");
  assert.equal(q.verdict, "ok");
  assert.match(q.onChain, /nominal spot/);
});

test("a market with nonsense sigma cannot reproduce a sellable quote", () => {
  const broken = honest();
  broken.sigma1e4 = 1n; // a hundred-millionth of a percent: every band is certain
  assert.equal(
    auditMarket(broken).checks.find((c) => c.key === "quote-is-reproducible")?.verdict,
    "failed",
  );
});
