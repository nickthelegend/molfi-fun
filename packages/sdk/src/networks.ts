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
  /**
   * The block the market contract's first event landed in.
   *
   * `starknet_getEvents` pages the chain in fixed windows — Sepolia's node covers 81,920
   * blocks per call — so a scan started at block 0 against a contract deployed fourteen
   * million blocks later answers with an empty page and a continuation token. Correct, and
   * useless to anyone who runs it once. Every printed scan starts here instead, so a single
   * command returns the events the page says it will.
   */
  firstEventBlock: number | null;
  /** Block explorer base, used for the tx links the demo needs to show. */
  explorer: string;
  /** True when the STRK20 pool is the real one and the SDK route applies. */
  realPool: boolean;
}

/** STRK on Starknet Sepolia and mainnet — same address on both. */
export const STRK_TOKEN =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/**
 * The Sepolia price relay: mainnet Pragma's median, republished so a testnet can settle.
 *
 * Not deployed on mainnet, where Pragma is alive and molfi reads it directly.
 */
export const SEPOLIA_PRICE_RELAY =
  "0x0275a7fdecdb539060b1e7cb2c857f88d505ed0a6c0ea2aafbbcc383456dfcbb";

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
  /**
   * Live, and settling.
   *
   * Pragma stopped publishing to Sepolia months ago, so an earlier deployment here could
   * open markets and never resolve one. This deployment reads the **price relay** instead —
   * a contract that republishes mainnet Pragma's own median — so the same settlement path
   * runs against a real, current, multi-publisher price. The keeper relays, settles, and
   * opens the next round, continuously.
   *
   * The relay is a testnet stand-in with one publisher, and every value it serves carries
   * the mainnet block it was read at. On mainnet molfi reads Pragma directly.
   */
  /**
   * The class where the band is never stored.
   *
   * Replaces `0x03b00e6e…`, which carried 52 settled markets and a `Position` struct holding
   * `band_low` and `band_high` in the clear — so on that deployment anyone could enumerate a
   * market and read what each position had bought, which is the one claim molfi is named for.
   * `/privacy` and `/verify` said so in a red banner drawn from the deployed ABI, and
   * `pnpm verify` D13 failed, for as long as the ~60 STRK declare went unpaid.
   *
   * This one stores `low_off_1e8` and `high_off_1e8` — the reach of the band from its own
   * midpoint, with the price divided out — which prices a position exactly and says nothing
   * about what it predicts. It also carries the public route (`open_position`,
   * `claim_position`, `quote_offsets`) the old class never had, and the three fixes from
   * `docs/AUDIT.md`.
   *
   * The history is the cost, and it is real: the 52 markets on the old address stay there and
   * their `/m/<id>` pages go with them. A privacy claim that holds is worth more than a
   * settlement count that does not.
   */
  sepolia: "0x053b17219aa45008548e3633b9fcd78ec9540b00d71fd34ec6217599d3298f1f",
  mainnet: null,
};

/**
 * An address may be overridden from the environment on any network, not just devnet.
 *
 * A redeploy changes the address, and a build that can only be pointed at whatever was
 * hardcoded has to be edited and re-released to follow it — which is how a console ends up
 * reading a contract that was replaced last week and reporting confidently on nothing.
 */
const marketFor = (network: NetworkName): string | null =>
  process.env.NEXT_PUBLIC_MARKET ?? process.env.MOLFI_MARKET ?? MOLFI_MARKET[network];

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  devnet: {
    name: "devnet",
    chainId: CHAIN_IDS.devnet,
    rpcUrl: "http://127.0.0.1:5050",
    /**
     * No pool locally. The deploying account stands in for it, so the open, settle and
     * claim paths run for real against the real contract — what a local run does not
     * exercise is the pool's own proof, which is StarkWare's code rather than molfi's.
     * Filled from the environment by the deploy script.
     */
    privacyPool: process.env.NEXT_PUBLIC_POOL ?? null,
    stakeToken: process.env.NEXT_PUBLIC_TOKEN ?? null,
    oracle: process.env.NEXT_PUBLIC_ORACLE ?? null,
    market: marketFor("devnet"),
    firstEventBlock: 0,
    explorer: "",
    realPool: false,
  },
  sepolia: {
    name: "sepolia",
    chainId: CHAIN_IDS.sepolia,
    rpcUrl: "https://api.cartridge.gg/x/starknet/sepolia",
    privacyPool: SEPOLIA_PRIVACY_POOL,
    stakeToken: STRK_TOKEN,
    /**
     * The relay, not Pragma. Pragma Sepolia has not published in months; the relay carries
     * mainnet Pragma's median across so markets here can actually settle.
     */
    oracle: SEPOLIA_PRICE_RELAY,
    market: marketFor("sepolia"),
    /**
     * Where **this** contract's first event landed — 14,648,162, the block it was deployed in.
     *
     * It read 14,605,143 after the redeploy, which was the *previous* contract's first block:
     * the address on `/verify`'s copyable `starknet_getEvents` had moved and this had not, so
     * the command handed to a sceptic scanned forty-three thousand blocks of nothing before
     * reaching anything. Correct, and useless to someone running it once — which is the whole
     * audience for that box.
     */
    firstEventBlock: 14_648_162,
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
    market: marketFor("mainnet"),
    firstEventBlock: null,
    explorer: "https://starkscan.co",
    realPool: true,
  },
};

export const networkByChainId = (chainId: string): NetworkConfig | undefined => {
  const want = chainId.toLowerCase();
  return Object.values(NETWORKS).find((n) => n.chainId.toLowerCase() === want);
};
