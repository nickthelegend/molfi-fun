import { NextResponse } from "next/server";
import { RPC_URL } from "@/lib/rpc";

/**
 * JSON-RPC proxy.
 *
 * The browser talks to Starknet through here rather than dialling a node directly. That is
 * the whole reason it exists: the endpoint molfi is configured with carries an API key, and
 * a key in client code is a key anybody can lift. It also sidesteps CORS and means the app
 * works from browsers that refuse cross-origin requests to a local devnet port.
 *
 * It forwards real JSON-RPC to a real node — nothing is synthesised. What it adds is a
 * method allowlist, so an endpoint reachable from any page cannot be used to drive node
 * administration or to fan out arbitrary traffic through our key.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Reads only, and only the ones this app makes.
 *
 * Notably absent: `starknet_addInvokeTransaction` and friends. Every transaction molfi sends
 * goes through the user's wallet, which submits it itself — proxying a signed transaction
 * would put this server in a path it has no business being in.
 */
const ALLOWED = new Set([
  "starknet_call",
  "starknet_chainId",
  "starknet_blockNumber",
  "starknet_blockHashAndNumber",
  "starknet_getBlockWithTxHashes",
  "starknet_getClassAt",
  "starknet_getClassHashAt",
  "starknet_getEvents",
  "starknet_getNonce",
  "starknet_getStorageAt",
  "starknet_getTransactionByHash",
  "starknet_getTransactionReceipt",
  "starknet_getTransactionStatus",
  "starknet_specVersion",
  "starknet_syncing",
]);

function allowed(method: unknown): boolean {
  return typeof method === "string" && ALLOWED.has(method);
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const calls = Array.isArray(body) ? body : [body];
  const blocked = calls.find((c) => !allowed((c as { method?: unknown })?.method));
  if (blocked) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: (blocked as { id?: number }).id ?? null,
        error: {
          code: -32601,
          message: `method not permitted: ${(blocked as { method?: string }).method}`,
        },
      },
      { status: 403 },
    );
  }

  try {
    const upstream = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (e) {
    // Say the chain is unreachable. Never answer a chain question with a made-up value.
    //
    // Returned as a JSON-RPC error with HTTP 200 rather than a 502: the proxy was reached,
    // it is the node behind it that is not answering. Clients turn a non-2xx into a generic
    // transport complaint, which points whoever is debugging at the request instead of at
    // the dead node.
    const id = Array.isArray(body) ? null : ((body as { id?: number | string })?.id ?? null);
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: `chain unreachable: ${(e as Error).message}` },
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
