/**
 * Which deployment the API is serving.
 *
 * Matches are stored per deployment, but the read paths were not filtering on it. Point the
 * keeper at Sepolia while a devnet run's rows are still in the database and it will happily
 * serve those: a client is told it is on Sepolia, shown a devnet match, and any action it
 * takes is addressed to a contract on the wrong chain.
 *
 * Every match query goes through this, so the answer is always "matches on the chain we are
 * actually talking to".
 */

import { prisma } from "../db.js";

let cached: { network: string; gameAddress: string; id: number } | null = null;

/**
 * The active deployment's row id, resolved once per process.
 *
 * Resolved by contract address as well as network. A devnet that restarts gets new contract
 * addresses, and matching on the network alone would serve the previous deployment's matches
 * as though they belonged to the contracts now running.
 */
export async function activeDeploymentId(network: string, gameAddress: string): Promise<number> {
  if (cached?.network === network && cached.gameAddress === gameAddress) return cached.id;
  const row = await prisma.deployment.findUnique({
    where: { network_gameAddress: { network, gameAddress } },
  });
  if (!row) {
    // Before the first match is opened there is no row yet. -1 matches nothing, which is the
    // correct answer: this chain has no matches.
    return -1;
  }
  cached = { network, gameAddress, id: row.id };
  return row.id;
}

/** Clears the cache. Used by tests that switch networks inside one process. */
export function resetDeploymentScope(): void {
  cached = null;
}
