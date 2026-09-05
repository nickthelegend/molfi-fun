import { NextResponse } from "next/server";
import { NETWORK } from "@/lib/rpc";
import { marketAddress, readMarket, readPosition, serialise } from "@/lib/market-reads";

/**
 * One position, by commitment.
 *
 * The only way to look a position up, and deliberately so. The chain stores
 * `poseidon(tag, secret, market, band)` and nothing that links it to anyone, so there is no
 * "positions of this address" call here and there cannot be one — that absence is the
 * product, not a missing feature.
 *
 * The commitment itself is public and knowing it proves nothing: deriving it needs the
 * secret, and holding it is what claims the payout. So this route reveals nothing that the
 * chain does not already publish to anyone who asks for that key.
 *
 * It cannot tell you whether a position won, and that absence is load bearing. The chain
 * stores how far the band reached from its own midpoint, never where it sat, so nothing here
 * — and nothing anywhere until the holder claims — can compare it to the settled price. Pass
 * `?low=&high=` and this route will answer for *that* band, which is arithmetic on two
 * numbers you supplied and reveals nothing you did not already know.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** A band supplied by the caller, or null. Rejected rather than coerced if it is nonsense. */
function bandFrom(low: string | null, high: string | null): { low: bigint; high: bigint } | null {
  if (!low || !high) return null;
  try {
    const l = BigInt(low);
    const h = BigInt(high);
    return h > l ? { low: l, high: h } : null;
  } catch {
    return null;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ commitment: string }> },
) {
  const { commitment } = await params;
  const address = marketAddress();

  if (!address) {
    return NextResponse.json(
      { error: `molfi's market contract is not deployed on ${NETWORK}.` },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(commitment)) {
    return NextResponse.json(
      { error: "commitment must be a felt in hex" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const position = await readPosition(address, commitment);
    if (!position.exists) {
      // Absent, not hidden. A commitment nobody has opened reads back as zeroes, and
      // saying so is honest — it reveals nothing, because anyone could have asked.
      return NextResponse.json(
        { network: NETWORK, contract: address, commitment, exists: false },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const market = await readMarket(address, position.marketId);

    // The band is the caller's own, or absent. Absent is the normal case and null is the
    // honest answer to it: a settled market whose position cannot be evaluated is not a
    // loss, it is a question this route is not able to answer.
    const url = new URL(_req.url);
    const band = bandFrom(url.searchParams.get("low"), url.searchParams.get("high"));
    const won =
      band && market.isSettled && market.settledPrice > 0n
        ? market.settledPrice > band.low && market.settledPrice < band.high
        : null;

    return NextResponse.json(
      serialise({
        network: NETWORK,
        contract: address,
        commitment,
        exists: true,
        position,
        market,
        /**
         * Null while the market is open, and null without a band: unresolved, unknowable
         * and lost are three different things and only one of them is a loss.
         */
        won,
        band: band ? { low: band.low.toString(), high: band.high.toString() } : null,
        claimable: won === true && !position.claimed,
        payoutUnits:
          won === true
            ? ((position.stake * position.multiplierBps) / 10_000n).toString()
            : "0",
      }),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
