import { NextResponse } from "next/server";
import { auditMarket } from "@molfi/sdk";
import { NETWORK } from "@/lib/rpc";
import { marketAddress, readMarket, serialise } from "@/lib/market-reads";

/**
 * The verifier, as JSON.
 *
 * The same `auditMarket` the page renders, so a script can check a market without scraping
 * HTML and without trusting this server's summary — every check carries the value the chain
 * gave and the value recomputing gave, so a caller can redo the comparison themselves.
 *
 * No wallet, no account, no position. That is the requirement rather than a convenience: a
 * claim only a participant can check is not a claim anyone should accept.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const address = marketAddress();

  if (!address) {
    return NextResponse.json(
      {
        error: `molfi's market contract is not deployed on ${NETWORK}, so there is nothing to verify.`,
      },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  if (!/^\d+$/.test(id)) {
    return NextResponse.json(
      { error: "market id must be a positive integer" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const market = await readMarket(address, Number(id), { withTable: true });
    // A market that was never listed reads back as zeroes rather than reverting, so an
    // absent market has to be recognised rather than audited.
    if (market.cutoffAt === 0) {
      return NextResponse.json(
        { error: `the contract has no market #${id}` },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }

    const audit = auditMarket(market);
    return NextResponse.json(
      serialise({
        network: NETWORK,
        contract: address,
        readAt: new Date().toISOString(),
        sound: audit.sound,
        failed: audit.checks.filter((c) => c.verdict === "failed").map((c) => c.key),
        unchecked: audit.checks.filter((c) => c.verdict === "unchecked").map((c) => c.key),
        market: audit.market,
        checks: audit.checks,
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
