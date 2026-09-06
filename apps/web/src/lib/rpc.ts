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

/**
 * The oracle this deployment settles against.
 *
 * Taken from the network config rather than from Pragma's address book. They are the same
 * thing on mainnet and Sepolia, and deliberately not on devnet, where a stand-in stands in —
 * so reaching for the address book directly means a local run checks a contract that is not
 * there and reports its own oracle as down.
 */
export const ORACLE_ADDRESS = NETWORKS[NETWORK].oracle;

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

/**
 * The latest block's timestamp — the clock every deadline in this app is measured against.
 *
 * `open_position` refuses past the cutoff and `settle` refuses before it, both against the
 * block timestamp. The browser's clock is a different clock, and where the two disagree the
 * console offers trades the contract will refuse and hides settlements that are already due.
 * Cheap enough to serve with every market read.
 */
export async function latestTimestamp(): Promise<number> {
  const endpoints = [RPC_URL, FALLBACK_RPC_URL].filter(
    (e, i, all) => e && all.indexOf(e) === i,
  );
  let last: unknown = null;
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "starknet_getBlockWithTxHashes",
          params: ["latest"],
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      const body = (await res.json()) as { result?: { timestamp?: number } };
      if (typeof body.result?.timestamp === "number") return body.result.timestamp;
    } catch (e) {
      last = e;
    }
  }
  throw new RpcError(
    `could not read the chain's clock${last ? `: ${String((last as Error).message).slice(0, 80)}` : ""}`,
  );
}

/**
 * Whether the deployed class stores a position's band in the clear.
 *
 * Not a question the source can answer. `cairo/src/market.cairo` stores a pair of reach
 * ratios and never the band — but a class is deployed, not compiled, and the class currently
 * live on Sepolia predates that change: its `Position` carries `band_low` and `band_high`.
 * Commitments are indexed event keys, so on that class anyone can enumerate positions and
 * read the band each one bought.
 *
 * The privacy page states what leaks. It cannot state it from the repository, because the
 * repository is not what a reader's trade would execute against — so it asks the chain, and
 * corrects itself the moment a class without the band is deployed.
 *
 * `null` when the class could not be read: unknown is not "safe".
 */
export async function bandIsOnChain(contract: string): Promise<boolean | null> {
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "starknet_getClassAt",
          params: ["latest", contract],
        }),
        cache: "no-store",
      });
      const json = (await res.json()) as { result?: { abi?: unknown }; error?: unknown };
      if (!json.result) continue;
      const abi = typeof json.result.abi === "string" ? JSON.parse(json.result.abi) : json.result.abi;
      const flat: Array<Record<string, unknown>> = [];
      const walk = (items: unknown) => {
        for (const item of (items as Array<Record<string, unknown>>) ?? []) {
          flat.push(item);
          if (item.items) walk(item.items);
        }
      };
      walk(abi);
      const position = flat.find(
        (x) => x.type === "struct" && typeof x.name === "string" && /::Position$/.test(x.name),
      );
      if (!position) return null;
      const members = (position.members as Array<{ name?: string }>) ?? [];
      return members.some((m) => m.name === "band_low" || m.name === "band_high");
    } catch {
      // Try the next endpoint; a node having a bad minute is not an answer.
    }
  }
  return null;
}
