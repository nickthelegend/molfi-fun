/**
 * The calls a trade is made of, checked field by field.
 *
 * These are unit tests in the strict sense — no chain, no wallet — and what they pin is the
 * *shape* of the calldata. Shape is exactly what a chain cannot tell you politely: a felt in
 * the wrong slot deserialises into a different parameter and the contract refuses with a
 * message about the wrong thing, or worse, succeeds against a value nobody meant.
 *
 * `scripts/integration.mjs` runs these same builders against a real contract. Between the
 * two, a change that reorders a field fails here with a readable diff instead of failing
 * there with a deserialisation error.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { num } from "starknet";
import { claimCalls, openCalls, reachOf, type TradeAddresses } from "../src/trade.ts";
import { commitmentOf, u256Parts, type PositionSecret } from "../src/positions.ts";
import { offsetsOf, quoteOff, quote, NORMAL_TABLE } from "../src/pricing.ts";
import { claimTicketActions, openTicketActions } from "../src/pool-actions.ts";

const A: TradeAddresses = {
  pool: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
  token: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  market: "0x03b00e6e0efd3d35aeb6885ccb5e21a32f5f68a54222094196a7264da158b068",
};

const SPOT = 7_987_395_000_000n;
const HALF = (SPOT * 171_077n) / 100_000_000n;

const secret = (): PositionSecret => ({
  secret: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
  marketId: 7,
  bandLow: SPOT - HALF,
  bandHigh: SPOT + HALF,
});

const eq = (a: string, b: string) => BigInt(a) === BigInt(b);

test("an open is an exact approve followed by open_position", () => {
  const s = secret();
  const calls = openCalls(A, s, 5_000_000_000_000_000_000n);
  assert.equal(calls.length, 2);

  assert.ok(eq(calls[0].contractAddress, A.token), "approve goes to the token");
  assert.equal(calls[0].entrypoint, "approve");
  const [aLow, aHigh] = u256Parts(5_000_000_000_000_000_000n);
  // spender, then the u256 amount low limb first.
  assert.ok(eq((calls[0].calldata as string[])[0], A.market), "approves the market, nobody else");
  assert.ok(eq((calls[0].calldata as string[])[1], aLow));
  assert.ok(eq((calls[0].calldata as string[])[2], aHigh));

  assert.ok(eq(calls[1].contractAddress, A.market));
  assert.equal(calls[1].entrypoint, "open_position");
});

test("the approve is for exactly the stake, never unlimited", () => {
  const stake = 3_000_000_000_000_000_000n;
  const d = openCalls(A, secret(), stake).at(0)!.calldata as string[];
  const approved = (BigInt(d[2]) << 128n) | BigInt(d[1]);
  assert.equal(approved, stake, "an unlimited allowance to a market is a standing invitation");
});

test("open_position sends the commitment and the reach, and never the band", () => {
  const s = secret();
  const stake = 2_000_000_000_000_000_000n;
  const d = openCalls(A, s, stake).at(1)!.calldata as string[];
  const [lowOff, highOff] = reachOf(s);

  // market_id, commitment, low_off (u256), high_off (u256), amount (u256) = 8 felts.
  assert.equal(d.length, 8, "eight felts: the pool deserialises straight into the parameters");
  assert.equal(BigInt(d[0]), 7n, "market id");
  assert.ok(eq(d[1], commitmentOf(s)), "the commitment the browser derived");
  assert.ok(eq(d[2], u256Parts(lowOff)[0]) && eq(d[3], u256Parts(lowOff)[1]), "low reach");
  assert.ok(eq(d[4], u256Parts(highOff)[0]) && eq(d[5], u256Parts(highOff)[1]), "high reach");
  assert.ok(eq(d[6], u256Parts(stake)[0]) && eq(d[7], u256Parts(stake)[1]), "stake");

  // The whole claim of the route, asserted rather than described: neither band edge, nor the
  // secret, appears anywhere in what goes on chain.
  const wire = d.map((f) => BigInt(f));
  assert.ok(!wire.includes(s.bandLow), "the low edge is not in the calldata");
  assert.ok(!wire.includes(s.bandHigh), "the high edge is not in the calldata");
  assert.ok(!wire.includes(BigInt(s.secret)), "the secret is not in the calldata");
});

test("the reach is scale free — the same band shape on any price sends the same two felts", () => {
  // Why the band can be hidden at all. Doubling the price doubles both edges and leaves the
  // ratios untouched, so the two numbers on chain say "0.17% wide" and nothing about where.
  const cheap: PositionSecret = { secret: "0x1", marketId: 1, bandLow: 1_000_000n, bandHigh: 1_002_000n };
  const dear: PositionSecret = { secret: "0x1", marketId: 1, bandLow: 100_000_000n, bandHigh: 100_200_000n };
  assert.deepEqual(reachOf(cheap), reachOf(dear));
});

test("a claim reveals the band, and only then", () => {
  const s = secret();
  const calls = claimCalls(A, s);
  assert.equal(calls.length, 1, "one call: no allowance is needed to be paid");
  assert.equal(calls[0].entrypoint, "claim_position");
  const d = calls[0].calldata as string[];
  assert.equal(d.length, 6, "market_id, secret, band_low (u256), band_high (u256)");
  assert.equal(BigInt(d[0]), 7n);
  assert.ok(eq(d[1], s.secret), "the preimage, which the contract hashes back to the commitment");
  assert.ok(eq(d[2], u256Parts(s.bandLow)[0]) && eq(d[3], u256Parts(s.bandLow)[1]));
  assert.ok(eq(d[4], u256Parts(s.bandHigh)[0]) && eq(d[5], u256Parts(s.bandHigh)[1]));
});

test("the reach a trade sends prices identically to the band it came from", () => {
  // The desk quotes from `quote(spot, low, high)`; the chain charges from
  // `quote_off(low_off, high_off)`. If those ever disagreed, a trader would be shown one
  // number and charged another — so the equality is asserted, not assumed.
  const s = secret();
  const [lowOff, highOff] = reachOf(s);
  const mid = (s.bandLow + s.bandHigh) / 2n;
  const byBand = quote(NORMAL_TABLE, mid, s.bandLow, s.bandHigh, 171_077n, 400n);
  const byReach = quoteOff(NORMAL_TABLE, lowOff, highOff, 171_077n, 400n);
  assert.equal(byReach.multiplierBps, byBand.multiplierBps);
  assert.equal(byReach.prob1e6, byBand.prob1e6);
});

test("offsetsOf refuses a band that does not straddle the price it is measured against", () => {
  assert.throws(() => offsetsOf(100n, 100n, 200n), /SpotOutsideBand/);
  assert.throws(() => offsetsOf(100n, 50n, 100n), /SpotOutsideBand/);
});

test("two positions on the same band are different positions", () => {
  // The secret is what separates them. Without it, opening the same band twice would collide
  // on the commitment and the second open would be refused as a duplicate.
  const a = { ...secret(), secret: "0xaaa" };
  const b = { ...secret(), secret: "0xbbb" };
  assert.notEqual(commitmentOf(a), commitmentOf(b));
  const da = openCalls(A, a, 1n).at(1)!.calldata as string[];
  const db = openCalls(A, b, 1n).at(1)!.calldata as string[];
  assert.notEqual(num.toHex(da[1]), num.toHex(db[1]));
  // …but the reach is identical, so the chain cannot tell they are the same band.
  assert.equal(da[2], db[2]);
  assert.equal(da[4], db[4]);
});

/**
 * The pool route for the direction game, checked at the shape the wallet is handed.
 *
 * Two actions and no more: the withdraw that delivers the stake, and the invoke. The withdraw
 * is the leg that was missing from the range route once and made an invoke move no money at
 * all — the pool's `InvokeExternalInput` carries a contract and calldata and nothing else, so
 * without it the contract measures a delivery that never happened and refuses.
 */
test("a pool ticket is a withdraw and an invoke, in that order", () => {
  const a = { pool: "0x1", token: "0x2", upDownMarket: "0x3" };
  const s = { secret: "0xabc", roundId: 7, direction: "up" as const };
  const actions = openTicketActions(a, s, 5_000_000_000_000_000_000n);

  assert.equal(actions.length, 2, "exactly two actions");
  assert.equal(actions[0].type, "withdraw");
  assert.equal(
    (actions[0] as { recipient: string }).recipient,
    "0x3",
    "the stake goes to the up/down contract, not the pool",
  );
  assert.equal(actions[1].type, "invoke");
  assert.equal((actions[1] as { contract: string }).contract, "0x3");

  // The calldata is `privacy_invoke`'s signature in order. Seven felts, no more: an eighth
  // would mean something is being sent that the contract does not take, and a wrong order is
  // a deserialisation error with nothing readable in it.
  const cd = (actions[1] as { calldata: string[] }).calldata;
  assert.equal(cd.length, 7, "seven felts, matching privacy_invoke");
  assert.equal(BigInt(cd[0]), 0n, "operation 0 is open");
  assert.equal(BigInt(cd[1]), 7n, "round id");
  assert.equal(BigInt(cd[2]), 0n, "up is felt 0");
  assert.equal(BigInt(cd[4]), 5_000_000_000_000_000_000n, "the stake");
  assert.equal(cd[5], "0xabc", "the secret");
});

/**
 * The claim opens the note before it invokes, and references it by placeholder.
 *
 * Order is not cosmetic: the note has to exist for the invoke to name, and the pool
 * substitutes `${openNoteIds[0]}` at assembly time. Reversing these produces a call that
 * references a note that does not exist yet.
 */
test("a pool claim opens the note first and names it in the calldata", () => {
  const a = { pool: "0x1", token: "0x2", upDownMarket: "0x3" };
  const s = { secret: "0xdef", roundId: 9, direction: "down" as const };
  const actions = claimTicketActions(a, s, "0xrecipient");

  assert.equal(actions[0].type, "transfer");
  assert.equal((actions[0] as { amount: string }).amount, "OPEN", "an open note");
  const cd = (actions[1] as { calldata: string[] }).calldata;
  assert.equal(BigInt(cd[0]), 1n, "operation 1 is claim");
  assert.equal(BigInt(cd[2]), 1n, "down is felt 1");
  assert.equal(cd[6], "${openNoteIds[0]}", "the note placeholder the wallet substitutes");
});
