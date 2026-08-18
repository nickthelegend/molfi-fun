/**
 * Reads Starknet directly, from the server.
 *
 * The hub used to make claims about what was deployed. Claims are worth nothing on a page
 * whose whole argument is that you should not have to take its word for anything, so the
 * numbers here are read from a node at request time and the page says so when the read fails.
 *
 * No key is needed for any of this. The public Cartridge endpoint answers the two methods
 * used here, which keeps the hub deployable without a secret and keeps a rate-limited key
 * off a page that anybody can load.
 */

export const SEPOLIA_RPC =
  process.env.STARKNET_RPC_URL ?? "https://api.cartridge.gg/x/starknet/sepolia";

export const VOYAGER = "https://sepolia.voyager.online";

/** A deployed contract, as the registry describes it before anything is checked. */
export interface ContractEntry {
  address: string;
  name: string;
  role: string;
  /**
   * Who put it on chain.
   *
   * "ours" was deployed by this project. "integrated" was already live and is used as a
   * dependency. The distinction is not cosmetic: listing somebody else's deployment without
   * saying so reads as a claim to have built it, and the poker verifiers were deployed by
   * the mental-poker project rather than here.
   */
  origin: "ours" | "integrated";
  /** Where an integrated contract came from. */
  source?: string;
}

/** The same contract after the chain has been asked about it. */
export interface ContractStatus extends ContractEntry {
  classHash: string | null;
  /** Null means the read itself failed, which is different from the contract being absent. */
  live: boolean | null;
  error?: string;
  /** Sierra instruction count, read from the deployed class itself. */
  programLength?: number;
  /** Callable entry points, so "how much contract is this" has a second dimension. */
  externalFns?: number;
}

/**
 * The six addresses registered for the hackathon.
 *
 * This list is the same one in strk20.json at the repo root. It is duplicated here rather
 * than imported because the registry file is the submission's format and this is the site's,
 * and a build that breaks when a submission file moves would be a silly way to lose a demo.
 * The addresses are checked against the chain on every load, so a stale entry shows as dead
 * rather than as a lie.
 */
export const CONTRACTS: ContractEntry[] = [
  {
    address: "0x55ac4a110992e9ced1f3133a9bff040adaaa6aeee4ed57e9b9cb89cb7586ca",
    name: "CrewKillGame",
    origin: "ours",
    role: "Holds seats, rounds and the pot. Settles who was paid and why.",
  },
  {
    address: "0x38cea8475ecba6984807bf50eebc2d6174672f567d709d8b74c661904ec3bb8",
    name: "BallotBox",
    origin: "ours",
    role: "Takes votes as commitments so a vote cannot be read while it still matters.",
  },
  {
    address: "0x028fcd7d6937f5a2c1cefd07b6b26faedd0e99383b1f632e9754c4ba0941cbd9",
    name: "PokerTable",
    origin: "integrated",
    source: "github.com/dpinones/mental-poker",
    role: "Runs the hand. Holds the deck commitments and the betting round state.",
  },
  {
    address: "0x01aa31ac4826ddbdc9bb2a95a6d334e81be7ff32f7bae604c88b7437252781a4",
    name: "ShuffleVerifier",
    origin: "integrated",
    source: "github.com/dpinones/mental-poker",
    role: "Checks the proof that a shuffle permuted the deck without reading it.",
  },
  {
    address: "0x01b5e9a1b0f6550e62e18e3e397b9aded7d7b3dadfeb4f9f3653081c96d9c6c6",
    name: "DecryptVerifier",
    origin: "integrated",
    source: "github.com/dpinones/mental-poker",
    role: "Checks that a revealed card matches the card that was sealed.",
  },
  {
    address: "0x06e244442031a6a7f6dca61e3440f4989f6a2ee34bbf32e57bc6ccee8129c885",
    name: "KeyAggregator",
    origin: "integrated",
    source: "github.com/dpinones/mental-poker",
    role: "Combines per player keys into the one key the table decrypts against.",
  },
];

/**
 * Class sizes, remembered by class hash.
 *
 * A class hash identifies immutable code: the same hash is always the same program, so its
 * size can never change and re-reading it is pure waste. That matters here because six
 * parallel class reads against a public endpoint get throttled, and the page was showing
 * sizes for a different arbitrary subset on each load.
 *
 * Keyed on the hash rather than the address, so an upgrade to a new class is a cache miss
 * and gets measured afresh rather than reported with the old figure.
 */
const classSizes = new Map<string, { programLength: number; externalFns: number }>();

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
 * Asks the chain whether each registered contract is really there.
 *
 * A contract that is deployed answers with its class hash. One that was never deployed, or
 * was declared and never deployed, returns a contract-not-found error, and that distinction
 * is the entire point of the page this feeds.
 */
export async function contractStatuses(): Promise<ContractStatus[]> {
  const statuses = await Promise.all(
    CONTRACTS.map(async (entry): Promise<ContractStatus> => {
      try {
        const hash = await rpc("starknet_getClassHashAt", ["latest", entry.address]);

        // Size, from the deployed class rather than from a local build artefact. A judge
        // reading "23 external functions, 10,925 Sierra instructions" is being told how much
        // contract is actually on chain, which no amount of prose establishes.
        return { ...entry, classHash: String(hash), live: true };

      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        // Not found is a real answer about the contract. Anything else is a failed read,
        // and reporting a timeout as "not deployed" would be a lie in the honest direction.
        const absent = /not found|CONTRACT_NOT_FOUND/i.test(message);
        return {
          ...entry,
          classHash: null,
          live: absent ? false : null,
          error: absent ? "not deployed at this address" : message,
        };
      }
    }),
  );

  /**
   * Sizes, read one at a time.
   *
   * Six parallel class reads against a public endpoint get throttled, and whichever three
   * lost the race showed no size - a different three on each load, which reads as a bug
   * rather than as a busy node. Sequential is slower on the very first load and correct on
   * every load, and the cache above means the cost is paid once per class hash rather than
   * once per request.
   */
  for (const status of statuses) {
    if (!status.classHash) continue;

    const cached = classSizes.get(status.classHash);
    if (cached) {
      status.programLength = cached.programLength;
      status.externalFns = cached.externalFns;
      continue;
    }

    try {
      const klass = (await rpc("starknet_getClassAt", ["latest", status.address], 25_000)) as {
        sierra_program?: unknown[];
        entry_points_by_type?: { EXTERNAL?: unknown[] };
      };
      const programLength = klass.sierra_program?.length;
      const externalFns = klass.entry_points_by_type?.EXTERNAL?.length;
      if (programLength !== undefined && externalFns !== undefined) {
        classSizes.set(status.classHash, { programLength, externalFns });
        status.programLength = programLength;
        status.externalFns = externalFns;
      }
    } catch {
      // The size line is supporting detail. A row without it is still live and still useful,
      // so a failed size read never costs the page its contract status.
    }
  }

  return statuses;
}

/** Short form for display: 0x1234…cdef. Never used where the full value is needed. */
export function shortHex(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 2) return value;
  return `${value.slice(0, lead + 2)}…${value.slice(-tail)}`;
}
