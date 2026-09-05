/**
 * One place that talks to a Starknet node.
 *
 * Server side only. The RPC url comes from the environment so a paid key never reaches the
 * browser, and the fallback is a public endpoint rather than a hard failure — a console that
 * cannot show a price because nobody set an env var is a console nobody can evaluate.
 */

import { NETWORKS, type NetworkName } from "@molfi/sdk";

export const NETWORK = (process.env.MOLFI_NETWORK ?? "mainnet") as NetworkName;

export const RPC_URL = process.env.STARKNET_RPC_URL ?? NETWORKS[NETWORK].rpcUrl;

export class RpcError extends Error {}

/**
 * How many times a call is attempted before giving up.
 *
 * Public endpoints drop connections under load, and a single ECONNRESET was enough to blank
 * every price on the page. Retrying twice is not papering over a real outage — an endpoint
 * that is actually down fails all three and the caller still hears about it.
 */
const ATTEMPTS = 3;

async function once(contract: string, selector: string, calldata: string[]): Promise<string[]> {
  const res = await fetch(RPC_URL, {
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
  const body = (await res.json()) as {
    result?: string[];
    error?: { message?: string };
  };
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
  for (let i = 0; i < ATTEMPTS; i += 1) {
    try {
      return await once(contract, selector, calldata);
    } catch (err) {
      last = err;
      // A revert is the contract's answer, not a flaky connection. Retrying it wastes time
      // and returns the same thing.
      if (err instanceof RpcError && !/\d{3}$/.test(err.message)) throw err;
      if (i < ATTEMPTS - 1) await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  throw new RpcError(
    last instanceof Error ? last.message : "the node could not be reached",
  );
}
