/**
 * Network wiring.
 *
 * Pool and token addresses are protocol facts, not app config, so they live in code and are
 * checked against the chain when the app starts, rather than trusted. An app that reads a
 * pool address from an env file can be pointed at the wrong pool by a typo that nobody
 * notices until a settlement goes somewhere unexpected.
 *
 * The molfi contract addresses are the exception and are genuinely deployment state, so they
 * are null until a deploy fills them in. Null is honest; a placeholder address is not.
 */

// Pragma's oracle addresses come from the adapter that reads them, not a second copy here.
// Two lists of the same addresses is one list that will eventually be wrong.
import { PRAGMA } from "./pragma.ts";

export type NetworkName = "devnet" | "sepolia" | "mainnet";

export interface NetworkConfig {
  name: NetworkName;
  chainId: string;
  rpcUrl: string;
  /** The STRK20 privacy pool. On devnet this is a local pool the deploy script puts up. */
  privacyPool: string | null;
  /** Settlement token. STRK on the public networks. */
  stakeToken: string | null;
  /** Pragma's oracle aggregator. molfi settles against its median, never a single feed. */
  oracle: string | null;
  /** molfi's anonymizer, once deployed. Null means "not deployed here yet". */
  market: string | null;
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

/** STRK20 privacy pool, mainnet — the address the hackathon scores transactions against. */
export const MAINNET_PRIVACY_POOL =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

/** Chain ids as the wallet and the node report them. */
export const CHAIN_IDS = {
  mainnet: "0x534e5f4d41494e", // SN_MAIN
  sepolia: "0x534e5f5345504f4c4941", // SN_SEPOLIA
  devnet: "0x534e5f5345504f4c4941",
} as const;

/**
 * The molfi anonymizer, per network.
 *
 * Filled by the deploy step. Keeping these here rather than in the app means one place to
 * change after a deploy, and one place a verifier can read to check it is talking to the
 * same contract the console is.
 */
export const MOLFI_MARKET: Record<NetworkName, string | null> = {
  devnet: null,
  sepolia: null,
  mainnet: null,
};

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  devnet: {
    name: "devnet",
    chainId: CHAIN_IDS.devnet,
    rpcUrl: "http://127.0.0.1:5050",
    privacyPool: null,
    stakeToken: null,
    oracle: null,
    market: MOLFI_MARKET.devnet,
    explorer: "http://127.0.0.1:5050",
    realPool: false,
  },
  sepolia: {
    name: "sepolia",
    chainId: CHAIN_IDS.sepolia,
    rpcUrl: "https://api.cartridge.gg/x/starknet/sepolia",
    privacyPool: SEPOLIA_PRIVACY_POOL,
    stakeToken: STRK_TOKEN,
    oracle: PRAGMA.sepolia,
    market: MOLFI_MARKET.sepolia,
    explorer: "https://sepolia.starkscan.co",
    realPool: true,
  },
  mainnet: {
    name: "mainnet",
    chainId: CHAIN_IDS.mainnet,
    rpcUrl: "https://api.cartridge.gg/x/starknet/mainnet",
    privacyPool: MAINNET_PRIVACY_POOL,
    stakeToken: STRK_TOKEN,
    oracle: PRAGMA.mainnet,
    market: MOLFI_MARKET.mainnet,
    explorer: "https://starkscan.co",
    realPool: true,
  },
};

export const networkByChainId = (chainId: string): NetworkConfig | undefined => {
  const want = chainId.toLowerCase();
  return Object.values(NETWORKS).find((n) => n.chainId.toLowerCase() === want);
};
