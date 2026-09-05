import { test } from "node:test";
import assert from "node:assert/strict";
import {
  POSITION_TAG,
  commitmentOf,
  newSecret,
  shortStringToFelt,
  u256Parts,
} from "../src/positions.ts";

test("the tag encodes to the felt Cairo writes as 'MOLFI_POSITION_V1'", () => {
  assert.equal(shortStringToFelt(POSITION_TAG), "0x4d4f4c46495f504f534954494f4e5f5631");
});

test("a u256 splits low limb first, the way Cairo's calldata reads it", () => {
  assert.deepEqual(u256Parts(1n), ["0x1", "0x0"]);
  assert.deepEqual(u256Parts((1n << 128n) + 5n), ["0x5", "0x1"]);
});

test("the commitment matches the one the contract derives", () => {
  // The fixed vector. `cairo/tests/test_market.cairo` opens a position with exactly these
  // inputs and looks it up by this hash, so the two implementations are pinned to each
  // other rather than each to its own arithmetic.
  const commitment = commitmentOf({
    secret: shortStringToFelt("secret"),
    marketId: 1,
    bandLow: 90_000n,
    bandHigh: 110_000n,
  });
  assert.equal(
    commitment,
    "0x4d41e3ad2552475273859e87b4fe034503ce567ad72fead91991ef5fc5b20bf",
  );
});

test("changing any part of the preimage changes the commitment", () => {
  // Every field has to be bound. A commitment that ignored the band would let a holder
  // claim against a band they never bought, which is the whole payout.
  const base = { secret: "0x1", marketId: 1, bandLow: 100n, bandHigh: 200n };
  const variants = [
    { ...base, secret: "0x2" },
    { ...base, marketId: 2 },
    { ...base, bandLow: 101n },
    { ...base, bandHigh: 201n },
  ];
  const seen = new Set([commitmentOf(base)]);
  for (const v of variants) {
    const c = commitmentOf(v);
    assert.ok(
      !seen.has(c),
      `commitment did not change for secret=${v.secret} market=${v.marketId} band=${v.bandLow}-${v.bandHigh}`,
    );
    seen.add(c);
  }
});

test("a fresh secret always fits in a felt", () => {
  // 2^252 is the field bound; a secret above it is silently reduced on chain and its
  // commitment becomes unreproducible.
  for (let i = 0; i < 50; i += 1) {
    assert.ok(BigInt(newSecret()) < 1n << 252n);
  }
});
