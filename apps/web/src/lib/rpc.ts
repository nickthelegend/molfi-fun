/**
 * One place that talks to a Starknet node.
 *
 * Server side only. The primary endpoint comes from the environment so a paid key never
 * reaches the browser, and there is a public endpoint behind it so a key that is missing,
 * expired, or pointed at a network the account has not enabled cannot take the whole app
 * down. A console that shows no price because somebody forgot a dashboard toggle is a
 * console nobody can evaluate.
 *
 * The fallback reads the same chain from a different node — it is not a cached value and it
 * is never a made-up one. `/api/health` reports which endpoint answered, so "it is working"
 * and "it is working on the backup" stay distinguishable.
 */

import { NETWORKS, type NetworkName } from "@molfi/sdk";

export const NETWORK = (process.env.MOLFI_NETWORK ?? "mainnet") as NetworkName;

/** The configured endpoint, if there is one. */
export const RPC_URL = process.env.STARKNET_RPC_URL ?? NETWORKS[NETWORK].rpcUrl;

/** The keyless public endpoint for this network. Rate limited, always there. */
export const FALLBACK_RPC_URL = NETWORKS[NETWORK].rpcUrl;

const ENDPOINTS = RPC_URL === FALLBACK_RPC_URL ? [RPC_URL] : [RPC_URL, FALLBACK_RPC_URL];

export class RpcError extends Error {}

/** Which endpoint last answered, so health can say whether the primary is working. */
let lastGood: string | null = null;
export const lastGoodEndpoint = () => lastGood;

/**
 * How many times one endpoint is tried before moving on.
 *
 * Public nodes drop connections under load, and a single ECONNRESET was enough to blank
 * every price on the page. Retrying is not papering over an outage: an endpoint that is
 * genuinely down fails every attempt and the caller still hears about it.
 */
const ATTEMPTS = 2;

async function once(
  endpoint: string,
  contract: string,
  selector: string,
  calldata: string[],
): Promise<string[]> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "starknet_call",
      params: [
        { contract_address: contract, entry_point_selector: selector, calldata },
        "latest",
      ],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) throw new RpcError(`the node returned ${res.status}`);
  const body = (await res.json()) as { result?: string[]; error?: { message?: string } };
  if (!body.result) throw new RpcError(body.error?.message ?? "the node returned no result");
  return body.result;
}

/** A `starknet_call`, returning the raw felt array. Throws with the node's own words. */
export async function call(
  contract: string,
  selector: string,
  calldata: string[] = [],
): Promise<string[]> {
  let last: unknown;
  for (const endpoint of ENDPOINTS) {
    for (let i = 0; i < ATTEMPTS; i += 1) {
      try {
        const out = await once(endpoint, contract, selector, calldata);
        lastGood = endpoint;
        return out;
      } catch (err) {
        last = err;
        // A revert is the contract's answer, not a flaky connection or a bad key. Retrying
        // it, or asking a second node, returns the same thing more slowly.
        if (err instanceof RpcError && !/\b(4\d\d|5\d\d)$/.test(err.message)) {
          if (!/not enabled|unauthor|forbidden/i.test(err.message)) throw err;
        }
        if (i < ATTEMPTS - 1) await new Promise((r) => setTimeout(r, 200));
      }
    }
  }
  throw new RpcError(
    last instanceof Error ? last.message : "no Starknet endpoint could be reached",
  );
}
