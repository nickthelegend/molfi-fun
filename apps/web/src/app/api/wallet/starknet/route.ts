import { NextResponse } from "next/server";
import { callerOf, privy, privyConfigured, walletFor } from "@/lib/privy-server";

/**
 * The caller's Starknet wallet, created on first ask.
 *
 * Server-managed: molfi's backend holds the signing relationship and the wallet is owned by
 * the authenticated Privy user, so the browser never sees a key and never needs one. What it
 * gets back is an address, a public key and an opaque wallet id — all three public, none of
 * them able to move anything without a signature from this server.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const no = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  if (!privyConfigured || !privy) {
    return no(503, "wallets are not configured on this deployment");
  }

  const caller = await callerOf(req);
  if (!caller) return no(401, "sign in first — this needs a live Privy session");

  try {
    /**
     * Idempotent by user, not by call — enforced by Privy rather than by us.
     *
     * A visitor who reloads has to land on the same address, or the STRK they funded a minute
     * ago belongs to a wallet they can no longer reach.
     */
    const wallet = await walletFor(caller);
    return NextResponse.json(
      { wallet, created: !caller.wallet },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    // Named, because "something went wrong" on the one screen between a visitor and the game
    // is the difference between a bug report and a bounce.
    return no(502, `Privy would not answer: ${(e as Error).message}`.slice(0, 200));
  }
}
