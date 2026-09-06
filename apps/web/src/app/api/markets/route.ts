import { NextResponse } from "next/server";
import { hash } from "starknet";
import { MARKETS, NETWORKS } from "@molfi/sdk";
import { NETWORK, call, latestTimestamp } from "@/lib/rpc";

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

/**
 * How many markets a caller gets without asking for more.
 *
 * Comfortably more than the console or the live page renders, and small enough that the
 * fan-out stays a fixed cost rather than one that grows with the contract's age.
 */
const DEFAULT_LIMIT = 60;

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

export async function GET(req: Request) {
  const url = new URL(req.url);
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

    /**
     * Newest first, and bounded.
     *
     * The market list only grows — three new markets every round, for ever — and this route
     * used to read every one of them on every request. At forty-four that is a second; the
     * keeper adds roughly three hundred a day, so it is a wall rather than a slope, and the
     * first symptom would have been the console quietly failing to load markets in a week's
     * time. The console had already been bounded for exactly this reason; this route had not.
     *
     * The window is the recent tail because that is all any caller renders. Anything older
     * is reachable by id — the verifier reads the chain directly, and a stored position
     * carries its own market in the `/api/position` response — so nothing loses access to
     * history by this being bounded.
     */
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || DEFAULT_LIMIT, 1), 200);
    const ids = Array.from({ length: Math.min(total, limit) }, (_, i) => total - i).filter(
      (id) => id >= 1,
    );

    const markets = await Promise.all(
      ids.map(async (id) => {
        const r = await call(address, hash.getSelectorFromName("get_market"), [
          "0x" + id.toString(16),
        ]);
        // Market, in declaration order: pair, cutoff_at, round_seconds, token, sigma_1e4,
        // house_edge_bps, settled_price, settled_at, settled_block_at, settled_sources,
        // is_settled, staked, paid. Every u256 is two felts, low limb first.
        const pair = toLabel(r[0]);
        return {
          id,
          pair,
          known: MARKETS.some((m) => m.label === pair),
          cutoffAt: Number(BigInt(r[1])),
          roundSeconds: Number(BigInt(r[2])),
          token: r[3],
          sigma1e4: u256(r[4], r[5]).toString(),
          houseEdgeBps: Number(u256(r[6], r[7])),
          settledPrice: u256(r[8], r[9]).toString(),
          settledAt: Number(BigInt(r[10])),
          settledBlockAt: Number(BigInt(r[11])),
          settledSources: Number(BigInt(r[12])),
          isSettled: BigInt(r[13]) === 1n,
          staked: u256(r[14], r[15]).toString(),
          paid: u256(r[16], r[17]).toString(),
          bankroll: u256(r[18], r[19]).toString(),
          reserved: u256(r[20], r[21]).toString(),
        };
      }),
    );

    /**
     * The chain's clock, served alongside the markets.
     *
     * Every deadline in this app is a block timestamp — `open_position` refuses past the
     * cutoff, `settle` refuses before it — and the browser's clock is a different clock.
     * On a public network they agree to within seconds and the difference never shows; on a
     * chain running ahead or behind, a console using `Date.now()` offers trades the contract
     * will refuse and hides settlements that are already due. Serving the timestamp the
     * contract will actually compare against costs one field.
     */
    const chainNow = await latestTimestamp();

    return NextResponse.json(
      {
        network: NETWORK,
        deployed: true,
        contract: address,
        chainNow,
        /** Every market the contract holds, so a caller can tell this list is a window. */
        count: total,
        markets,
      },
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
