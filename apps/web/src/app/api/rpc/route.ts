import { NextResponse } from "next/server";
import { FALLBACK_RPC_URL, RPC_URL } from "@/lib/rpc";

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
 * The methods this app makes, and no others.
 *
 * This was reads only, on the reasoning that every transaction goes through the user's wallet
 * and the wallet submits it itself — so proxying a signed transaction would put this server
 * in a path it had no business being in. That was true of a browser extension. It stopped
 * being true the moment molfi grew a Privy wallet, because a Privy account has no extension
 * to submit for it: starknet.js signs in the browser and sends through *this* provider. The
 * allowlist therefore refused `starknet_estimateFee` and `starknet_addInvokeTransaction`, and
 * every Privy user's trade died before it reached the chain — visible only as an unreachable
 * chain, because a blocked method and a dead node look identical from inside starknet.js.
 *
 * Forwarding a signed transaction is not the exposure the original comment feared. The
 * transaction is already signed by a key this server has never held, and any edit here would
 * invalidate that signature — so the proxy cannot alter what it forwards, only decline to.
 * What it can be is a relay for traffic, which is equally true of `starknet_call`, and is a
 * question of rate rather than of authority.
 *
 * Still absent, deliberately: `starknet_addDeclareTransaction`, and everything a node exposes
 * for its own administration. Declaring is not something a page does.
 */
const ALLOWED = new Set([
  // Writes. The browser signs, this forwards, the chain decides.
  "starknet_addInvokeTransaction",
  /** A counterfactual account deploys itself on first use; nothing else can do it for it. */
  "starknet_addDeployAccountTransaction",
  // Asking what a transaction would cost or do, which every send does first.
  "starknet_estimateFee",
  "starknet_simulateTransactions",
  "starknet_call",
  "starknet_chainId",
  "starknet_blockNumber",
  "starknet_blockHashAndNumber",
  "starknet_getBlockWithTxHashes",
  "starknet_getClassAt",
  /**
   * By hash, not only by address.
   *
   * `deployAccount` looks the class up by its hash to decide which Cairo ABI it is talking
   * to — and it must, because the account does not exist yet, so there is no address to ask
   * about. Leaving this out meant every first-time deployment died on a blocked method, one
   * call before the transaction that would have created the account.
   */
  "starknet_getClass",
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

  // The same fallback the read helpers use, and for the same reason: a key pointed at a
  // network its app has not enabled answers every request with a 403, and a proxy that
  // passes that straight through takes the browser down with it while the server-rendered
  // routes carry on working. Two paths to the same chain behaving differently is worse than
  // either behaviour on its own.
  const endpoints = RPC_URL === FALLBACK_RPC_URL ? [RPC_URL] : [RPC_URL, FALLBACK_RPC_URL];

  try {
    let last: { status: number; text: string } | null = null;
    for (const endpoint of endpoints) {
      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
      const text = await upstream.text();
      // A 4xx or 5xx from the endpoint is the endpoint refusing us, not the chain refusing
      // the call — a reverted call comes back as a JSON-RPC error inside a 200.
      if (upstream.ok) {
        return new NextResponse(text, {
          status: upstream.status,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      }
      last = { status: upstream.status, text };
    }
    return new NextResponse(last!.text, {
      status: last!.status,
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
