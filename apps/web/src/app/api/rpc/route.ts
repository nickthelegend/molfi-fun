import { NextResponse } from "next/server";

/**
 * JSON-RPC proxy.
 *
 * The browser talks to the chain through here rather than dialling the node directly.
 * That keeps the upstream endpoint (and any API key on it) out of the client bundle,
 * sidesteps CORS, and means the app works from browsers that refuse cross-origin
 * requests to a local port.
 *
 * It forwards real JSON-RPC to a real node — nothing is synthesised. What it does add
 * is a method allowlist, so an endpoint reachable from any page cannot be used to drive
 * node administration.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const UPSTREAM = process.env.RPC_UPSTREAM ?? process.env.NEXT_PUBLIC_RPC_FALLBACK ?? "http://127.0.0.1:8545";

/**
 * Signing with a key the node holds is a local-development affordance — it is how an
 * unlocked dev account works. It stays off unless explicitly enabled, so a deployed
 * instance can never be asked to send a transaction on someone else's behalf.
 */
const ALLOW_UNLOCKED = process.env.XORR_ALLOW_UNLOCKED_ACCOUNTS === "1";

const READ_METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getCode",
  "eth_getLogs",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_sendRawTransaction",
  "net_version",
  "web3_clientVersion",
]);

const UNLOCKED_METHODS = new Set(["eth_accounts", "eth_sendTransaction", "eth_sign", "eth_signTypedData_v4"]);

function allowed(method: unknown): boolean {
  if (typeof method !== "string") return false;
  if (READ_METHODS.has(method)) return true;
  return ALLOW_UNLOCKED && UNLOCKED_METHODS.has(method);
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
        error: { code: -32601, message: `method not permitted: ${(blocked as { method?: string }).method}` },
      },
      { status: 403 },
    );
  }

  try {
    const upstream = await fetch(UPSTREAM, {
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
    // Returned as a JSON-RPC error with HTTP 200 rather than a 502: the proxy was
    // reached, it is the node behind it that is not answering. Clients turn a non-2xx
    // into a generic transport complaint — "missing or invalid parameters" — which
    // points whoever is debugging at the request instead of at the dead node.
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
