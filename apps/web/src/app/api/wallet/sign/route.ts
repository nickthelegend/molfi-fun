import { NextResponse } from "next/server";
import { ec } from "starknet";
import { callerOf, privy, privyConfigured, walletFor } from "@/lib/privy-server";
import { DEV_WALLET, devSignerEnabled } from "@/lib/dev-wallet";

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
  const caller = privyConfigured && privy ? await callerOf(req) : null;

  /**
   * The development escape, and the reason it lives on the server.
   *
   * The desk cannot be driven end to end without a wallet, and the two real ways in — a
   * browser extension, or a Privy email round trip — are both unavailable to an automated
   * check. So there is a third way in, and the temptation is to hand the browser a private
   * key and let it sign locally. That is the version of this that leaks: a key in the bundle
   * is a key in every build artefact and every browser cache, and `NODE_ENV` guards are a
   * thin thing to put between a secret and the internet.
   *
   * Instead the key stays exactly where the Privy secret stays — here, server-side, read from
   * the environment, never serialised into a response. The browser's signer talks to this
   * endpoint the same way for both, and cannot tell which key answered.
   *
   * It is reachable only when there is no Privy session to use instead, only outside
   * production, and only when the variable is set — which it is not, anywhere it is deployed.
   */
  if (!caller && devSignerEnabled) {
    let devBody: { hash?: unknown };
    try {
      devBody = await req.json();
    } catch {
      return no(400, "the body must be JSON");
    }
    const devHash = typeof devBody.hash === "string" ? devBody.hash : null;
    if (!devHash || !FELT.test(devHash)) return no(400, "hash must be a felt");
    const sig = ec.starkCurve.sign(devHash, DEV_WALLET!.privateKey);
    /**
     * Concatenated and zero-padded, which is the shape Privy answers with.
     *
     * Deliberately the same shape rather than a more convenient one: if this route answered
     * with a pair and Privy with a string, the client would need a branch to tell them apart,
     * and that branch is a place where the development path and the real path can drift.
     * Padding matters — `r` or `s` with a leading zero byte is shorter than 64 hex digits,
     * and a split on `BigInt` rather than on length is exactly how that bug gets written.
     */
    const pad = (v: bigint) => v.toString(16).padStart(64, "0");
    return NextResponse.json(
      { signature: `0x${pad(sig.r)}${pad(sig.s)}` },
      { headers: { "cache-control": "no-store" } },
    );
  }

  if (!privyConfigured || !privy) return no(503, "signing is not configured on this deployment");
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
