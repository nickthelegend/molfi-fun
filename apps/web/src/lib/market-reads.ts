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

import {
  decodeMarket,
  decodePosition,
  decodeTable,
  type OnChainPosition,
} from "@molfi/sdk";

export {
  decodeMarket,
  decodePosition,
  decodeTable,
  toLabel,
  type OnChainPosition,
} from "@molfi/sdk";

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
