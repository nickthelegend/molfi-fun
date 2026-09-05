"use client";

import { RpcProvider } from "starknet";
import { NETWORKS, type NetworkName } from "@molfi/sdk";

/**
 * Starknet, and the addresses molfi talks to.
 *
 * The Monad version of this file configured viem against a 300ms chain with a multicall3
 * and an injected EIP-1193 wallet. None of that transfers: Starknet accounts are contracts,
 * the wallet standard is different, and — the part that actually shapes this app — the
 * private path runs through the STRK20 pool rather than through molfi's own contract.
 *
 * Contract addresses are protocol facts and live in the SDK. Only the network selection and
 * the RPC endpoint are configuration, because only those legitimately differ per deployment.
 */

export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK ?? "mainnet") as NetworkName;
export const activeNetwork = NETWORKS[NETWORK];

/**
 * The browser's RPC endpoint.
 *
 * Public by necessity — a browser cannot keep a secret — so it is deliberately *not* the
 * keyed endpoint the server routes use. Prices and market state come from `/api/*`, which
 * holds the key; this client is only for reads a wallet-connected user makes on their own
 * behalf.
 */
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? activeNetwork.rpcUrl;

export const provider = new RpcProvider({ nodeUrl: RPC_URL });

/** A Starknet address: a felt, so up to 64 hex digits and usually written short. */
const addr = (v: string | undefined | null): string | null =>
  v && /^0x[0-9a-fA-F]{1,64}$/.test(v) ? v : null;

export const ADDRESSES = {
  /** The STRK20 privacy pool. Every private action goes through it. */
  pool: addr(activeNetwork.privacyPool),
  /** STRK, the settlement token. */
  token: addr(activeNetwork.stakeToken),
  /** Pragma's aggregator, which settles every market. */
  oracle: addr(activeNetwork.oracle),
  /** molfi's anonymizer. Null until it is deployed on this network. */
  market: addr(process.env.NEXT_PUBLIC_MARKET ?? activeNetwork.market),
};

/** True only when there is a real deployment to talk to. */
export const LIVE_CONFIGURED = Boolean(ADDRESSES.market && ADDRESSES.pool && ADDRESSES.token);

/**
 * Why the live desk is unavailable, in words that say whose problem it is.
 *
 * Returns null when it is available. A blank screen and a disabled button are the same thing
 * to a user; the difference is whether anyone can tell why.
 */
export function liveBlockedReason(): string | null {
  if (!ADDRESSES.pool) return `No STRK20 pool is configured for ${NETWORK}.`;
  if (!ADDRESSES.token) return `No settlement token is configured for ${NETWORK}.`;
  if (!ADDRESSES.market) {
    return `molfi's market contract is not deployed on ${NETWORK} yet. The demo desk runs the same rules against real tape in the meantime.`;
  }
  return null;
}

export function explorerTx(hash: string): string | null {
  return activeNetwork.explorer ? `${activeNetwork.explorer}/tx/${hash}` : null;
}

export function explorerContract(address: string): string | null {
  return activeNetwork.explorer ? `${activeNetwork.explorer}/contract/${address}` : null;
}

/** Addresses are compared as numbers: 0x04ab and 0x4ab are the same account. */
export const sameAddress = (a?: string | null, b?: string | null): boolean =>
  Boolean(a && b && BigInt(a) === BigInt(b));

/** Shorten an address for display without losing the ends that identify it. */
export const shortAddress = (a: string, lead = 6, tail = 4): string =>
  a.length <= lead + tail + 1 ? a : `${a.slice(0, lead)}…${a.slice(-tail)}`;
