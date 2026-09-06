import { NextResponse } from "next/server";
import { hash } from "starknet";
import { NETWORKS } from "@molfi/sdk";
import { NETWORK, call } from "@/lib/rpc";

/**
 * What an address actually holds, read from the chain.
 *
 * Server-side rather than from the browser for the same reason every other read here is: the
 * node endpoint is keyed, and a balance is the one number on the deck a visitor will believe
 * without checking. There is deliberately no fallback — if the node cannot be reached this
 * answers with the reason, and the desk prints "unknown" rather than a zero. A wallet that
 * holds nothing and a wallet nobody could read look identical if you let them.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Addresses are felts. Anything else is not one, whatever it looks like. */
const FELT = /^0x[0-9a-fA-F]{1,64}$/;

const no = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address");
  if (!address) return no(400, "an address is required");
  if (!FELT.test(address)) return no(400, "address must be a felt: 0x and up to 64 hex digits");

  const token = NETWORKS[NETWORK].stakeToken;
  if (!token) return no(503, `no settlement token is configured for ${NETWORK}`);

  try {
    const r = await call(token, hash.getSelectorFromName("balanceOf"), [address]);
    // A u256 comes back as two felts, low limb first. Reading only the first would report a
    // balance of zero for anything above 2^128, and be right almost always — which is how a
    // decoding bug survives.
    const low = BigInt(r[0] ?? "0x0");
    const high = BigInt(r[1] ?? "0x0");
    const balance = low + (high << 128n);

    return NextResponse.json(
      {
        address,
        token,
        network: NETWORK,
        // A string, because JSON has no bigints and a balance in wei overflows a double at
        // about nine STRK.
        balance: balance.toString(),
        decimals: 18,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return no(502, `the node would not answer: ${(e as Error).message}`.slice(0, 200));
  }
}
