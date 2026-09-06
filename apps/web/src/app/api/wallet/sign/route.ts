import { NextResponse } from "next/server";
import { callerOf, privy, privyConfigured, walletFor } from "@/lib/privy-server";

/**
 * Sign one hash, with the caller's own wallet.
 *
 * The wallet is **not** taken from the request. It is read off the caller's verified identity
 * token, so there is no wallet id to tamper with and no ownership check to get wrong — the
 * only key this endpoint will ever use is the one belonging to whoever proved they are signed
 * in. The reference integration this was written from accepts a `walletId` from the body and
 * signs with it unauthenticated; that endpoint signs anything for anyone.
 *
 * What is signed is a Starknet transaction hash the client computed. The server does not
 * rebuild the transaction, so it cannot vouch for what the signature authorises — which is
 * precisely why the key is scoped to its owner: the worst a caller can do is authorise
 * something with their own wallet, which is what a wallet is for.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const no = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });

/** A felt is at most 252 bits. Anything longer is not a hash this chain produced. */
const FELT = /^0x[0-9a-fA-F]{1,64}$/;

export async function POST(req: Request) {
  if (!privyConfigured || !privy) return no(503, "signing is not configured on this deployment");

  const caller = await callerOf(req);
  if (!caller) return no(401, "sign in first — this needs a live Privy session");
  let body: { hash?: unknown };
  try {
    body = await req.json();
  } catch {
    return no(400, "the body must be JSON");
  }

  const hash = typeof body.hash === "string" ? body.hash : null;
  if (!hash) return no(400, "hash is required");
  if (!FELT.test(hash)) return no(400, "hash must be a felt: 0x and up to 64 hex digits");

  try {
    // Resolved from the caller's own session, never from the request body.
    const wallet = await walletFor(caller);
    const result = await privy.wallets().rawSign(wallet.id, { params: { hash } });
    return NextResponse.json(
      { signature: result.signature },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return no(502, `Privy would not sign: ${(e as Error).message}`.slice(0, 200));
  }
}
