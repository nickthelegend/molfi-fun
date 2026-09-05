/**
 * Reads Starknet directly, from the server.
 *
 * The page makes claims about what is deployed and what the chain is doing. Claims are worth
 * nothing on a site whose whole argument is that you should not have to take its word for
 * anything, so the numbers here are read from a node at request time, and the page says so
 * when a read fails rather than printing a zero.
 *
 * No key is needed. The public Cartridge endpoint answers everything used here, which keeps
 * the site deployable without a secret and a rate-limited key off a page anyone can load.
 */

export const SEPOLIA_RPC =
  process.env.STARKNET_RPC_URL ?? "https://api.cartridge.gg/x/starknet/sepolia";

export const VOYAGER = "https://sepolia.voyager.online";

async function rpc(method: string, params: unknown[], timeoutMs = 6000): Promise<unknown> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(SEPOLIA_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: abort.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`node returned ${res.status}`);
    const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new Error(body.error.message ?? "node rejected the call");
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

/** Current Sepolia head, or null if the node could not be reached. */
export async function blockNumber(): Promise<number | null> {
  try {
    const result = await rpc("starknet_blockNumber", []);
    return typeof result === "number" ? result : null;
  } catch {
    return null;
  }
}

/**
 * Whether a contract is really deployed at an address.
 *
 * Returns true when the chain answers with a class hash, false when it says the contract is
 * not there, and null when the read itself failed. The third case matters: reporting a
 * timeout as "not deployed" is a lie in the honest-sounding direction.
 */
export async function isDeployed(address: string): Promise<boolean | null> {
  try {
    await rpc("starknet_getClassHashAt", ["latest", address]);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    return /not found|CONTRACT_NOT_FOUND/i.test(message) ? false : null;
  }
}

/** Short form for display: 0x1234…cdef. Never used where the full value is needed. */
export function shortHex(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 2) return value;
  return `${value.slice(0, lead + 2)}…${value.slice(-tail)}`;
}
