import { NextResponse } from "next/server";
import { hash } from "starknet";
import { NETWORKS, decodeRound, decodeTicket } from "@molfi/sdk";
import { NETWORK, call } from "@/lib/rpc";
import { serialise } from "@/lib/market-reads";

/**
 * One direction ticket, read from the contract that holds it.
 *
 * `/api/position/:commitment` already existed and reads the **range** market, which is the
 * wrong contract for a direction ticket and answers `exists: false` for every one of them.
 * That is worse than no answer: the console used it to decide whether a ticket was still
 * riding, so a real stake on a real round reported as a position that had never existed.
 * Two games, two contracts, two reads.
 *
 * The commitment is all a caller sends and all this needs. It is a Poseidon hash over a
 * secret only the trader holds, so it identifies a ticket without identifying a person, and
 * it reveals nothing about which way the ticket went — that is the point of the whole design
 * and it survives this endpoint being public.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const FELT = /^0x[0-9a-fA-F]{1,64}$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ commitment: string }> },
) {
  const { commitment } = await params;
  if (!FELT.test(commitment)) {
    return NextResponse.json(
      { error: "a commitment is a felt: 0x and up to 64 hex digits" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const address = NETWORKS[NETWORK].upDownMarket;
  if (!address) {
    return NextResponse.json(
      {
        network: NETWORK,
        deployed: false,
        reason: `molfi's up/down contract is not deployed on ${NETWORK} yet.`,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const raw = await call(address, hash.getSelectorFromName("get_ticket"), [commitment]);
    const ticket = decodeTicket(raw);

    /**
     * The round too, because a ticket alone cannot say whether it won.
     *
     * A direction ticket carries no direction — by design — so the outcome is the trader's
     * own secret compared against the round's two prices. Serving the round here means the
     * console makes that comparison from one read instead of two, and against the same block.
     */
    const round = ticket.exists
      ? decodeRound(
          ticket.roundId,
          await call(address, hash.getSelectorFromName("get_round"), [
            "0x" + ticket.roundId.toString(16),
          ]),
        )
      : null;

    return NextResponse.json(
      serialise({ network: NETWORK, contract: address, exists: ticket.exists, ticket, round }),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        network: NETWORK,
        contract: address,
        error: err instanceof Error ? err.message : "could not read the up/down contract",
      },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
