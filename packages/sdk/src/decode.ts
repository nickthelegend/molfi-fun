/**
 * Reading the two structs the market contract returns, in one place.
 *
 * The offsets are the interesting part and they are not obvious: Cairo lays a struct out
 * flat, a `u256` is two felts with the low limb first, and a `u128` is one — so a reader that
 * assumes one felt per field produces plausible nonsense rather than an error. That mistake
 * shipped once and reported a 1 STRK stake as 8 trillion.
 *
 * In the SDK rather than in the app because `scripts/integration.mjs` decodes with it too.
 * A test that reimplements the offsets it is checking proves only that two copies of a guess
 * agree with each other.
 */

import type { OnChainMarket } from "./audit.ts";

const u256 = (lo: string, hi: string) => (BigInt(hi) << 128n) | BigInt(lo);

/** felt → the short string it encodes, e.g. 'BTC/USD'. */
export function toLabel(felt: string): string {
  let n = BigInt(felt);
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  return String.fromCharCode(...bytes);
}

/**
 * `Market`, in declaration order:
 * pair, cutoff_at, round_seconds, token, sigma_1e4, house_edge_bps, settled_price,
 * settled_at, settled_block_at, settled_sources, is_settled, staked, paid, bankroll,
 * reserved.
 */
export function decodeMarket(id: number, r: string[]): OnChainMarket & { token: string } {
  return {
    id,
    pair: toLabel(r[0]),
    cutoffAt: Number(BigInt(r[1])),
    roundSeconds: Number(BigInt(r[2])),
    token: r[3],
    sigma1e4: u256(r[4], r[5]),
    houseEdgeBps: u256(r[6], r[7]),
    settledPrice: u256(r[8], r[9]),
    settledAt: Number(BigInt(r[10])),
    settledBlockAt: Number(BigInt(r[11])),
    settledSources: Number(BigInt(r[12])),
    isSettled: BigInt(r[13]) === 1n,
    staked: u256(r[14], r[15]),
    paid: u256(r[16], r[17]),
    bankroll: u256(r[18], r[19]),
    reserved: u256(r[20], r[21]),
    table: [],
  };
}

export interface OnChainPosition {
  marketId: number;
  /** `(mid - bandLow) * 1e8 / mid`. The band's reach, which is all the chain is told. */
  lowOff1e8: bigint;
  highOff1e8: bigint;
  stake: bigint;
  multiplierBps: bigint;
  claimed: boolean;
  exists: boolean;
  /** The address that may claim it, or zero for a position opened through the pool. */
  owner: string;
}

/**
 * `Position`: market_id (u64), low_off_1e8 (u256), high_off_1e8 (u256), stake (u128),
 * multiplier_bps (u256), claimed, exists, owner (ContractAddress).
 *
 * The band is deliberately not in here. What the contract stores is how far the band reaches
 * from its own midpoint, which is everything the price depends on and nothing about where the
 * band sits — so a reader of the chain can see that someone bought a 0.2%-wide band and not
 * which 0.2%. The band appears only when its holder claims.
 */
export function decodePosition(r: string[]): OnChainPosition {
  return {
    marketId: Number(BigInt(r[0])),
    lowOff1e8: u256(r[1], r[2]),
    highOff1e8: u256(r[3], r[4]),
    stake: BigInt(r[5]),
    multiplierBps: u256(r[6], r[7]),
    claimed: BigInt(r[8]) === 1n,
    exists: BigInt(r[9]) === 1n,
    owner: r[10],
  };
}

/** A market's stored probability table. A `Span<u256>` is a length then two felts per knot. */
export function decodeTable(r: string[]): bigint[] {
  const knots: bigint[] = [];
  for (let i = 1; i + 1 < r.length; i += 2) knots.push(u256(r[i], r[i + 1]));
  return knots;
}

/**
 * A direction round, exactly as `UpDownMarket.get_round` lays it out.
 *
 * Offsets are the whole risk here and they are not guessable: Cairo flattens a struct, a
 * `u256` is two felts with the low limb first, and a `u64`/`u32`/`bool` is one. A reader that
 * assumes one felt per field produces plausible nonsense rather than an error — that exact
 * mistake once reported a 1 STRK stake as 8 trillion. Counted against
 * `cairo/src/updown.cairo`'s `Round`, field by field.
 */
export interface OnChainRound {
  id: number;
  pair: string;
  cutoffAt: number;
  roundSeconds: number;
  token: string;
  /** The price every ticket in this round is measured against, fixed when it was listed. */
  referencePrice: bigint;
  referenceAt: number;
  referenceSources: number;
  houseEdgeBps: bigint;
  /** One number for both sides. If this ever differed per side the reserve would leak. */
  multiplierBps: bigint;
  settledPrice: bigint;
  settledAt: number;
  settledBlockAt: number;
  settledSources: number;
  isSettled: boolean;
  staked: bigint;
  paid: bigint;
  bankroll: bigint;
  reserved: bigint;
}

export function decodeRound(id: number, r: string[]): OnChainRound {
  return {
    id,
    pair: toLabel(r[0]),
    cutoffAt: Number(BigInt(r[1])),
    roundSeconds: Number(BigInt(r[2])),
    token: r[3],
    referencePrice: u256(r[4], r[5]),
    referenceAt: Number(BigInt(r[6])),
    referenceSources: Number(BigInt(r[7])),
    houseEdgeBps: u256(r[8], r[9]),
    multiplierBps: u256(r[10], r[11]),
    settledPrice: u256(r[12], r[13]),
    settledAt: Number(BigInt(r[14])),
    settledBlockAt: Number(BigInt(r[15])),
    settledSources: Number(BigInt(r[16])),
    isSettled: BigInt(r[17]) === 1n,
    staked: u256(r[18], r[19]),
    paid: u256(r[20], r[21]),
    bankroll: u256(r[22], r[23]),
    reserved: u256(r[24], r[25]),
  };
}

/** A direction ticket: what it cost, and nothing about which way it points. */
export interface OnChainTicket {
  roundId: number;
  stake: bigint;
  multiplierBps: bigint;
  claimed: boolean;
  exists: boolean;
  /** Zero for a pool ticket, where the secret is the only credential. */
  owner: string;
}

export function decodeTicket(r: string[]): OnChainTicket {
  return {
    roundId: Number(BigInt(r[0])),
    stake: BigInt(r[1]),
    multiplierBps: u256(r[2], r[3]),
    claimed: BigInt(r[4]) === 1n,
    exists: BigInt(r[5]) === 1n,
    owner: r[6],
  };
}
