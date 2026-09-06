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
  AMOUNT_MARGIN,
  FEE_MARGIN,
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
  // From a balance twenty-five times the fee down to one that barely covers it. At the very
  // top of that range a refusal is the right answer — the spendable share is below the fee by
  // a wei of integer division — so the invariant is about the bounds it *does* return.
  let produced = 0;
  for (const pct of [1n, 10n, 25n, 50n, 75n, 85n, 90n, 91n, 92n, 93n]) {
    const balance = (est.fee * 100n) / pct;
    let total: bigint;
    try {
      total = boundTotal(boundsFrom(est, balance));
    } catch (e) {
      assert.equal((e as Error).name, "Unaffordable", `at ${pct}% it failed for the wrong reason`);
      continue;
    }
    produced += 1;
    assert.ok(total <= balance, `at ${pct}% utilisation the bound ${total} exceeded ${balance}`);
    assert.ok(total >= est.fee, `at ${pct}% the bound ${total} fell under the fee ${est.fee}`);
  }
  assert.ok(produced >= 8, `only ${produced} of ten balances produced a bound at all`);
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
  // A balance that only just covers the fee leaves no room for price headroom.
  const b = boundsFrom(est, (est.fee * 100n) / 90n);
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
