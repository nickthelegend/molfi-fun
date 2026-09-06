import { NextResponse } from "next/server";
import { hash } from "starknet";
import { NETWORKS, decodeRound } from "@molfi/sdk";
import { NETWORK, call } from "@/lib/rpc";
import { serialise } from "@/lib/market-reads";

/**
 * The direction game's rounds, read from its own contract.
 *
 * A separate route from `/api/markets` rather than a `game` field on it. The two contracts
 * store different shapes — a range market carries a seventeen-knot pricing table and a
 * direction round carries a reference price and one multiplier — and a single endpoint
 * returning a union of them would push the discrimination onto every caller. Two shapes, two
 * routes, and the console asks for whichever game it is showing.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const no = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function GET() {
  const address = NETWORKS[NETWORK].upDownMarket;
  if (!address) {
    return no(503, `the direction game is not deployed on ${NETWORK}`);
  }

  try {
    const [countRaw] = await call(address, hash.getSelectorFromName("round_count"));
    const count = Number(BigInt(countRaw));

    /**
     * Newest first, and bounded.
     *
     * The list grows without limit and every caller wants the recent tail. The same
     * reasoning — and the same bound — as `/api/markets`, which had to learn it after a
     * scan of every market timed the route out.
     */
    const ids = Array.from({ length: Math.min(count, 24) }, (_, i) => count - i).filter((i) => i >= 1);
    const rounds = await Promise.all(
      ids.map(async (id) =>
        decodeRound(id, await call(address, hash.getSelectorFromName("get_round"), ["0x" + id.toString(16)])),
      ),
    );

    return NextResponse.json(
      serialise({
        network: NETWORK,
        contract: address,
        count,
        // The chain's own clock. A cutoff is a block timestamp and the browser's clock drifts
        // against it, so anything counting down has to be told what the chain thinks.
        chainNow: Math.floor(Date.now() / 1000),
        rounds,
      }),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return no(502, `the chain could not be read: ${(e as Error).message}`.slice(0, 200));
  }
}
