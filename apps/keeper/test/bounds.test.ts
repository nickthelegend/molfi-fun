/**
 * The fee bound is a product, and both times this was wrong it was wrong the same way.
 *
 * A Starknet V3 transaction is validated against `Σ max_amount × max_price_per_unit`, not
 * against what it ends up costing. Padding the amount by half and the price by half asks the
 * chain for 2.25x the fee — which is what starknet.js does internally, and what this code
 * then did again on top of it. The measured case below is the real one: a keeper holding
 * 0.0808 STRK, a relay costing 0.0416, and a day spent refusing to send it.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  AMOUNT_FLOOR,
  AMOUNT_MARGIN,
  FEE_MARGIN,
  PRICE_MARGIN,
  SPENDABLE,
  Unaffordable,
  boundTotal,
  boundsFrom,
  type BareEstimate,
} from "../src/bounds.ts";

/** The relay the keeper could not send, as the node actually measured it on Sepolia. */
const RELAY: BareEstimate = {
  fee: 41_559_320_527_873_792n, // 0.041559 STRK
  l1: { amount: 0n, price: 168_074_215_919_683n },
  l2: { amount: 1_422_912n, price: 29_024_058_564n },
  data: { amount: 448n, price: 665_496_060_072n },
};
const KEEPER_BALANCE = 80_843_186_574_050_224n; // 0.080843 STRK

/** `fee` has to be the sum of the parts, or every ratio below is measuring nothing. */
function consistent(e: BareEstimate): BareEstimate {
  const sum = e.l1.amount * e.l1.price + e.l2.amount * e.l2.price + e.data.amount * e.data.price;
  return { ...e, fee: sum };
}

test("the relay the keeper refused for a day is affordable", () => {
  const est = consistent(RELAY);
  const b = boundsFrom(est, KEEPER_BALANCE);
  const total = boundTotal(b);
  assert.ok(total <= KEEPER_BALANCE, `bound ${total} must fit in ${KEEPER_BALANCE}`);
  assert.ok(
    total <= (KEEPER_BALANCE * SPENDABLE) / 100n,
    "and must leave something behind for the next one",
  );
  assert.ok(total >= est.fee, "but must still cover the fee");
});

test("whenever a bound is produced at all, it fits the balance and covers the fee", () => {
  const est = consistent(RELAY);
  let produced = 0;
  for (const pct of [1n, 10n, 25n, 40n, 55n, 65n]) {
    const balance = (est.fee * 100n) / pct;
    const total = boundTotal(boundsFrom(est, balance));
    produced += 1;
    assert.ok(total <= balance, `at ${pct}% utilisation the bound ${total} exceeded ${balance}`);
    assert.ok(total >= est.fee, `at ${pct}% the bound ${total} fell under the fee ${est.fee}`);
  }
  assert.equal(produced, 6);
});

test("a balance that cannot cover the gas floor is refused, not shaved to fit", () => {
  const est = consistent(RELAY);
  // Above roughly 68% utilisation the floor no longer fits inside the spendable share. The
  // transaction would revert on Insufficient max L2Gas and pay its fee to do it, so the
  // refusal is the cheaper answer.
  for (const pct of [75n, 85n, 92n]) {
    const balance = (est.fee * 100n) / pct;
    assert.throws(
      () => boundsFrom(est, balance),
      (e: unknown) => (e as Error).name === "Unaffordable",
      `at ${pct}% utilisation it should have refused`,
    );
  }
});

test("the L2 amount always covers validation, which the estimate leaves out", () => {
  const est = consistent(RELAY);
  // Measured on the reverted relay: the node estimated 1,422,912 L2 gas with SKIP_VALIDATE
  // and execution used 1,742,400 — 22.5% more. Any bound this returns has to clear that.
  const ACTUAL_WITH_VALIDATION = 1_742_400n;
  for (const pct of [1n, 25n, 50n, 65n]) {
    const b = boundsFrom(est, (est.fee * 100n) / pct);
    assert.ok(
      b.l2_gas.max_amount >= ACTUAL_WITH_VALIDATION,
      `at ${pct}% the L2 bound ${b.l2_gas.max_amount} would revert against ${ACTUAL_WITH_VALIDATION}`,
    );
  }
});

test("with room to spare the bound is the fee plus the margin, not the margin squared", () => {
  const est = consistent(RELAY);
  const total = boundTotal(boundsFrom(est, est.fee * 100n)); // balance far above the fee
  const wanted = (est.fee * FEE_MARGIN) / 100n;
  // Integer division across three resources costs a few wei; nothing near a second 1.5x.
  const drift = total > wanted ? total - wanted : wanted - total;
  assert.ok(drift * 10_000n < wanted, `bound ${total} drifted from ${wanted}`);
  assert.ok(total < (est.fee * 200n) / 100n, "a squared margin would land near 2.25x");
});

test("amounts carry a margin of their own, so a re-execution has somewhere to go", () => {
  const est = consistent(RELAY);
  const b = boundsFrom(est, KEEPER_BALANCE);
  assert.equal(b.l2_gas.max_amount, (est.l2.amount * AMOUNT_MARGIN) / 100n);
  assert.ok(b.l2_gas.max_amount > est.l2.amount, "an unpadded amount is not a bound");
});

test("prices are never bounded below what the node quoted", () => {
  const est = consistent(RELAY);
  // The tightest balance that still produces a bound leaves the least room for price
  // headroom; even there the price may not fall under spot, or it cannot be included.
  const b = boundsFrom(est, (est.fee * 100n) / 65n);
  assert.ok(b.l2_gas.max_price_per_unit >= est.l2.price, "a bound under spot cannot be included");
});

test("a real shortfall is still refused, and names both numbers", () => {
  const est = consistent(RELAY);
  const tooPoor = est.fee / 2n;
  assert.throws(
    () => boundsFrom(est, tooPoor),
    (e: unknown) => {
      assert.ok(e instanceof Unaffordable);
      assert.match(e.message, new RegExp(String(est.fee)));
      assert.match(e.message, new RegExp(String(tooPoor)));
      return true;
    },
  );
});

test("a zero-cost estimate does not divide by zero", () => {
  const zero: BareEstimate = {
    fee: 0n,
    l1: { amount: 0n, price: 0n },
    l2: { amount: 0n, price: 0n },
    data: { amount: 0n, price: 0n },
  };
  assert.equal(boundTotal(boundsFrom(zero, KEEPER_BALANCE)), 0n);
});

/**
 * The bug this file exists to catch, in the one shape it had not been asked about.
 *
 * Every earlier test here checked that the bound **fits** — that the keeper stops refusing
 * affordable work and stops asking for more than it holds. None checked that the price bound
 * clears spot by anything, and with `FEE_MARGIN` and `AMOUNT_MARGIN` both at 150 it cleared
 * it by nothing at all: the amounts took the entire headroom and `cap / paddedTotal` came out
 * at exactly 1.00. The relay batch that exposed it missed by 0.014%.
 */
test("the price bound clears spot by the price margin, with a balance to spare", () => {
  const est = consistent(RELAY);
  // A hundred STRK — nothing here is constrained by affordability.
  const b = boundsFrom(est, 100_000_000_000_000_000_000n);

  for (const [name, bound, spot] of [
    ["l1_gas", b.l1_gas, est.l1.price],
    ["l1_data_gas", b.l1_data_gas, est.data.price],
    ["l2_gas", b.l2_gas, est.l2.price],
  ] as const) {
    assert.equal(
      bound.max_price_per_unit,
      (spot * PRICE_MARGIN) / 100n,
      `${name} must be bounded at ${PRICE_MARGIN}% of spot, not at spot`,
    );
    assert.ok(
      bound.max_price_per_unit > spot,
      `${name} bounded at ${bound.max_price_per_unit} against a spot of ${spot} — a single tick fails validation`,
    );
  }
});

test("FEE_MARGIN is the product of the two margins it has to pay for", () => {
  // Written down because the three numbers came apart once already, silently, and the only
  // symptom was transactions that were included until the moment gas moved.
  assert.equal(FEE_MARGIN, (AMOUNT_MARGIN * PRICE_MARGIN) / 100n);
});

/**
 * Under real pressure the two margins cannot both be paid, and which one gives is a decision
 * rather than an accident. The amounts give first — a bound below the gas a call needs cannot
 * execute at all, while one at spot is merely at risk of missing inclusion — but never below
 * the floor, and the price keeps its margin the whole way down.
 */
test("a tight balance gives back amount margin before price margin", () => {
  const est = consistent(RELAY);
  const spot = boundTotal({
    l1_gas: { max_amount: est.l1.amount, max_price_per_unit: est.l1.price },
    l1_data_gas: { max_amount: est.data.amount, max_price_per_unit: est.data.price },
    l2_gas: { max_amount: est.l2.amount, max_price_per_unit: est.l2.price },
  });
  // Enough for the floor at a full price margin, and not a great deal more.
  const balance = (spot * AMOUNT_FLOOR * PRICE_MARGIN) / 10_000n / 80n * 100n;
  const b = boundsFrom(est, balance);

  assert.ok(
    b.l2_gas.max_price_per_unit > est.l2.price,
    "the price still has to clear spot when the balance is tight",
  );
  assert.ok(
    b.l2_gas.max_amount >= (est.l2.amount * AMOUNT_FLOOR) / 100n,
    "and the amount must never fall under what execution needs",
  );
  assert.ok(boundTotal(b) <= (balance * SPENDABLE) / 100n, "while still fitting the balance");
});
