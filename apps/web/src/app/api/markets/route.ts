import { NextResponse } from "next/server";
import { hash } from "starknet";
import { MARKETS, NETWORKS } from "@molfi/sdk";
import { NETWORK, call } from "@/lib/rpc.ts";

/**
 * The markets that exist on chain, read from the contract.
 *
 * Not from a database, and not from a list in this file. A console that shows markets it
 * merely believes in will happily offer you one the chain has never heard of, and you find
 * out when the transaction reverts. Everything below comes from `market_count` and
 * `get_market`.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

const u256 = (lo: string, hi: string) => (BigInt(hi) << 128n) | BigInt(lo);

/** felt → the short string it encodes, e.g. 'BTC/USD'. */
function toLabel(felt: string): string {
  let n = BigInt(felt);
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  return String.fromCharCode(...bytes);
}

export async function GET() {
  const address = NETWORKS[NETWORK].market;

  // Null is the truthful answer before a deploy, and it is worth saying out loud rather than
  // returning an empty list that reads as "no markets are open right now".
  if (!address) {
    return NextResponse.json(
      {
        network: NETWORK,
        deployed: false,
        reason: `molfi's market contract is not deployed on ${NETWORK} yet, so there is nothing to open a position in.`,
        markets: [],
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const [count] = await call(address, hash.getSelectorFromName("market_count"));
    const total = Number(BigInt(count));

    const markets = await Promise.all(
      Array.from({ length: total }, (_, i) => i + 1).map(async (id) => {
        const r = await call(address, hash.getSelectorFromName("get_market"), [
          "0x" + id.toString(16),
        ]);
        // Market, in declaration order: pair, cutoff_at, token, sigma_1e4, house_edge_bps,
        // settled_price, settled_at, settled_sources, is_settled, staked, paid.
        const pair = toLabel(r[0]);
        return {
          id,
          pair,
          known: MARKETS.some((m) => m.label === pair),
          cutoffAt: Number(BigInt(r[1])),
          token: r[2],
          sigma1e4: u256(r[3], r[4]).toString(),
          houseEdgeBps: Number(u256(r[5], r[6])),
          settledPrice: u256(r[7], r[8]).toString(),
          settledAt: Number(BigInt(r[9])),
          settledSources: Number(BigInt(r[10])),
          isSettled: BigInt(r[11]) === 1n,
          staked: u256(r[12], r[13]).toString(),
          paid: u256(r[14], r[15]).toString(),
        };
      }),
    );

    return NextResponse.json(
      { network: NETWORK, deployed: true, contract: address, markets },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        network: NETWORK,
        deployed: true,
        contract: address,
        error: err instanceof Error ? err.message : "could not read the market contract",
        markets: [],
      },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
