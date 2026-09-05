/**
 * Network wiring.
 *
 * Pool and token addresses are protocol facts, not app config, so they live in code and are
 * checked against the chain when the keeper starts, rather than trusted.
 */

export type NetworkName = "devnet" | "sepolia" | "mainnet";

export interface NetworkConfig {
  name: NetworkName;
  chainId: string;
  rpcUrl: string;
  /** The STRK20 privacy pool. On devnet this is a local pool the deploy script puts up. */
  privacyPool: string | null;
  /** Settlement token. STRK on the public networks. */
  stakeToken: string | null;
  /** Block explorer base, used for the tx links the demo needs to show. */
  explorer: string;
  /** True when the STRK20 pool is the real one and the SDK route applies. */
  realPool: boolean;
}

/** STRK on Starknet Sepolia and mainnet — same address on both. */
export const STRK_TOKEN =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/** STRK20 privacy pool v2.0, Sepolia (strk20-by-example.org/sdk/getting-started). */
export const SEPOLIA_PRIVACY_POOL =
  "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
