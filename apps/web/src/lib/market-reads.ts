import { hash } from "starknet";
import { NETWORKS, type OnChainMarket } from "@molfi/sdk";
import { NETWORK, call } from "./rpc";

/**
 * Reading the market contract, in one place.
 *
 * Every route that touches the contract decodes the same two structs, and decoding them
 * twice is how they drift. The offsets are the interesting part and they are not obvious:
 * Cairo lays a struct out flat, a `u256` is two felts with the low limb first, and a `u128`
 * is one — so a reader that assumes one felt per field produces plausible nonsense rather
 * than an error. That mistake shipped once and reported a 1 STRK stake as 8 trillion.
 */

export const marketAddress = () => NETWORKS[NETWORK].market;

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

export async function readMarketCount(address: string): Promise<number> {
  const [count] = await call(address, hash.getSelectorFromName("market_count"));
  return Number(BigInt(count));
}

export async function readMarket(
  address: string,
  id: number,
  { withTable = false } = {},
): Promise<OnChainMarket & { token: string }> {
  const r = await call(address, hash.getSelectorFromName("get_market"), [
    "0x" + id.toString(16),
  ]);
  const market = decodeMarket(id, r);
  if (withTable) {
    const t = await call(address, hash.getSelectorFromName("get_table"), [
      "0x" + id.toString(16),
    ]);
    market.table = decodeTable(t);
  }
  return market;
}

export async function readPosition(
  address: string,
  commitment: string,
): Promise<OnChainPosition> {
  return decodePosition(
    await call(address, hash.getSelectorFromName("get_position"), [commitment]),
  );
}

/** bigints do not survive JSON; every one of them leaves as a decimal string. */
export function serialise<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as T;
}
