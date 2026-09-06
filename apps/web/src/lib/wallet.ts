"use client";

import { createStore, type Store } from "@starknet-io/get-starknet-core";
import {
  Account,
  CallData,
  WalletAccountV6,
  compareVersions,
  hash,
  walletV6,
  type SignerInterface,
} from "starknet";
import type { STRK20_ACTION, STRK20_BALANCE_ENTRY } from "@starknet-io/types-js";
import { CHAIN_IDS } from "@molfi/sdk";
import { activeNetwork, provider } from "./chain";

/**
 * The wallet, and nothing else.
 *
 * molfi takes the Starknet Wallet API route, which the STRK20 docs are unambiguous about:
 * *"A normal dapp should not receive the user's viewing key."* So this file asks the user's
 * wallet to do private things and never holds key material, never discovers notes, and never
 * builds a proof. Everything private happens inside the wallet.
 *
 * The consequence worth stating: molfi cannot show a shielded balance the wallet will not
 * tell it, and cannot recover a position if its secret is lost. Both are the cost of not
 * holding your keys, and both are better than the alternative.
 */

/**
 * A discovered wallet, typed as whatever the store actually hands back.
 *
 * Deliberately derived rather than imported. get-starknet-core re-exports
 * `StarknetWallet` from its own pinned copy of
 * `@starknet-io/get-starknet-wallet-standard`, while the discovery store inside it resolves
 * a newer copy of the same package — so the name and the value disagree, and importing the
 * name produces a type nothing in this app can satisfy. Taking the type from the function
 * that produces the values leaves exactly one source of truth.
 */
export type StarknetWallet = ReturnType<Store["getWallets"]>[number];

export type Network = "mainnet" | "sepolia";

/** The chain ids, as a wallet reports them. */
export const CHAIN = {
  mainnet: CHAIN_IDS.mainnet,
  sepolia: CHAIN_IDS.sepolia,
} as const;

/**
 * The STRK20 surface. Optional on purpose.
 *
 * Wallet support varies and the docs say to detect capability rather than assume it —
 * offering a button every wallet rejects is worse than not offering it. `WalletAccountV6`
 * declares these methods, but declaring them and the extension answering them are different
 * things, so each is probed rather than trusted.
 */
export interface Strk20Account extends WalletAccountV6 {}

export interface Capabilities {
  /** Can send transactions through the pool. */
  privateActions: boolean;
  /** Can dry-run before committing, so a quote can be shown honestly. */
  dryRun: boolean;
  /** Can report a shielded balance. */
  balances: boolean;
}

export interface Connection {
  address: string;
  chainId: string;
  network: Network | "unknown";
  walletName: string;
  capabilities: Capabilities;
  /**
   * Anything that can `execute`.
   *
   * Widened from `Strk20Account` because a Privy-backed account is a plain starknet.js
   * `Account` — it has no wallet-standard object behind it and never will. The desk uses
   * exactly one method on this, `execute`, so the narrower type was buying nothing and
   * costing the ability to connect anything that is not a browser extension.
   */
  account: Account;
  /**
   * The wallet-standard object, when the connection came from an extension.
   *
   * Null for a Privy connection. Only the pool route needs it, and `capabilities` already
   * decides whether that route is offered, so a null here is a fact rather than a gap.
   */
  wallet: StarknetWallet | null;
}

/**
 * Hand a discovered wallet to starknet.js.
 *
 * A cast, and an unavoidable one. get-starknet-core 6.0.1 resolves
 * `@starknet-io/get-starknet-wallet-standard` to 6.0.5; starknet 10.5.0 pins its own copy at
 * 6.0.2. Both publish the identical type — `WalletWithFeatures<StarknetFeatures>` — so the
 * objects are interchangeable at runtime and merely nominally distinct to the compiler.
 *
 * Forcing one version across both with a workspace override would silence this by building
 * starknet against a wallet-standard it was not released with, which trades a compiler
 * complaint for a real risk. One cast at the single boundary where the two meet is the
 * smaller lie, and it is written down here rather than sprinkled at call sites.
 */
function asStarknetWallet(wallet: StarknetWallet) {
  return wallet as unknown as Parameters<typeof WalletAccountV6.connect>[1];
}

let store: Store | null = null;

/** The wallet-standard store, created once. Browser only. */
export function walletStore(): Store {
  if (!store) store = createStore();
  return store;
}

/** Every wallet the browser is currently offering. */
export function availableWallets(): StarknetWallet[] {
  if (typeof window === "undefined") return [];
  return walletStore().getWallets();
}

/**
 * The chain a wallet is currently on.
 *
 * Read from the wallet-standard account rather than from the provider, because those are
 * different questions: the provider is where molfi reads, and the wallet is where the user
 * would sign. When they disagree it is the wallet that decides whether a transaction lands.
 *
 * Wallet-standard writes chains as CAIP-2, `starknet:0x534e5f4d41494e`, so the suffix is the
 * chain id.
 */
export function chainIdOf(wallet: StarknetWallet): string {
  const chains = wallet.accounts?.[0]?.chains ?? wallet.chains ?? [];
  const first = chains[0];
  if (!first) return "";
  const colon = first.indexOf(":");
  return colon >= 0 ? first.slice(colon + 1) : first;
}

export function networkOf(chainId: string): Network | "unknown" {
  const want = chainId.toLowerCase();
  for (const [name, id] of Object.entries(CHAIN)) {
    if (id.toLowerCase() === want) return name as Network;
  }
  return "unknown";
}

/** The Wallet API version that first carries the STRK20 actions. */
export const STRK20_WALLET_API = "0.10.3";

/**
 * What a wallet can actually do — asked with a version query, never inferred from the shape
 * of the object and never probed with a data call.
 *
 * Two wrong answers preceded this one, and both would have hurt.
 *
 * It first tested `typeof account.strk20InvokeTransaction === "function"`, which is always
 * true: starknet.js binds the STRK20 helpers onto every `WalletAccountV6` it builds, as thin
 * wrappers that forward to the wallet. Every wallet therefore claimed STRK20 support, molfi
 * offered the pool route to wallets that cannot take it, and — because pool is listed first
 * — made it the default. The trade then failed inside the wallet, on the screen where
 * someone is committing money.
 *
 * The fix for that probed `strk20Balances`, and the STRK20 wallet-API guidance says in as
 * many words not to: it is a balance read, so wallets gate it behind a consent prompt for
 * data the app has no reason to see. A bad trade on any app, an absurd one on this app — and
 * worse in the other direction, since a wallet that gates or omits it would have had the
 * private route hidden from it. That is the one capability molfi exists to use.
 *
 * `wallet_supportedWalletApi` is the question the spec says to ask. It is a version list, it
 * prompts for nothing, and it reveals nothing.
 */
export async function capabilitiesOf(
  account: Strk20Account,
  wallet: StarknetWallet,
): Promise<Capabilities> {
  const none: Capabilities = { privateActions: false, dryRun: false, balances: false };

  let versions: string[];
  try {
    versions = (await walletV6.supportedWalletApi(asStarknetWallet(wallet))) as string[];
  } catch {
    // A wallet that will not answer the version query is not one to route a private
    // transaction through. molfi has a second route and it works from any wallet.
    return none;
  }

  const speaksStrk20 =
    Array.isArray(versions) &&
    versions.some((v) => {
      try {
        return compareVersions(String(v), STRK20_WALLET_API) >= 0;
      } catch {
        return false;
      }
    });
  if (!speaksStrk20) return none;

  return {
    privateActions: typeof account.strk20InvokeTransaction === "function",
    dryRun: typeof account.strk20PrepareInvoke === "function",
    balances: typeof account.strk20Balances === "function",
  };
}

/** Connect one wallet and read back who and where it is. */
export async function connectTo(
  wallet: StarknetWallet,
  token: string | null = null,
): Promise<Connection> {
  const account = (await WalletAccountV6.connect(
    provider,
    asStarknetWallet(wallet),
  )) as Strk20Account;

  const chainId = chainIdOf(wallet);

  return {
    address: account.address,
    chainId,
    network: networkOf(chainId),
    walletName: wallet.name,
    capabilities: await capabilitiesOf(account, wallet),
    account,
    wallet,
  };
}

/** Reconnect without prompting, for a wallet this browser has already authorised. */
export async function reconnect(
  wallet: StarknetWallet,
  token: string | null = null,
): Promise<Connection | null> {
  try {
    const account = (await WalletAccountV6.connectSilent(
      provider,
      asStarknetWallet(wallet),
    )) as Strk20Account;
    if (!account?.address) return null;
    return {
      address: account.address,
      chainId: chainIdOf(wallet),
      network: networkOf(chainIdOf(wallet)),
      walletName: wallet.name,
      capabilities: await capabilitiesOf(account, wallet),
      account,
      wallet,
    };
  } catch {
    // A silent reconnect that fails is not an error worth showing; the connect button
    // is right there.
    return null;
  }
}

/**
 * Whether this connection can act on the network molfi is pointed at.
 *
 * A wallet on the wrong chain is the most common way a working dapp looks broken:
 * everything connects, the buttons enable, and then each transaction fails with a provider
 * error naming neither the wallet nor the network.
 */
export function networkMismatch(
  connection: Connection,
  expectedChainId: string = activeNetwork.chainId,
): { mismatched: boolean; message: string } {
  // Compared by chain id, not by the name of the deployment.
  //
  // This used to read `NETWORK === "sepolia" ? "sepolia" : "mainnet"`, so anything that was
  // not literally the string "sepolia" was assumed to be mainnet — including devnet, which
  // runs on Sepolia's chain id. A local deployment therefore told every correctly-connected
  // wallet it was on the wrong network and refused to trade, which is a hard failure with a
  // message pointing at the wrong thing. The chain id is what the wallet and the node
  // actually agree on, so that is what gets compared.
  if (connection.chainId.toLowerCase() === expectedChainId.toLowerCase()) {
    return { mismatched: false, message: "" };
  }
  const where =
    connection.network === "unknown"
      ? `an unrecognised chain (${connection.chainId})`
      : `Starknet ${connection.network}`;
  const wanted = networkOf(expectedChainId);
  return {
    mismatched: true,
    message: `molfi is on ${wanted === "unknown" ? `chain ${expectedChainId}` : `Starknet ${wanted}`}. Your wallet is on ${where}, so every action would fail until you switch it.`,
  };
}

/**
 * Which way into the market a wallet can actually take.
 *
 * `pool` hides the trader, the size and the band. `direct` hides the band only — the chain
 * is sent a commitment and two widths, never the band itself — and works from any Starknet
 * account. Both are real routes to a real position, so a wallet without STRK20 support gets
 * the second rather than a refusal.
 */
export type Route = "pool" | "direct";

export function routesFor(connection: Connection | null): Route[] {
  if (!connection) return [];
  return connection.capabilities.privateActions ? ["pool", "direct"] : ["direct"];
}

/**
 * Why a wallet cannot be used, in words that say what to do about it.
 *
 * Returns null when it can. This used to refuse any wallet without STRK20 support, on the
 * grounds that falling back to acting in public would defeat the point. It did worse than
 * that: it made molfi untradeable for every wallet anyone actually had, and a market nobody
 * can trade defeats the point completely. The public route hides the band, which is the
 * claim molfi makes, so the refusal has become a note about what each route hides instead.
 */
export function blockingReason(connection: Connection | null): string | null {
  if (!connection) return "Connect a wallet to open a position.";
  const mismatch = networkMismatch(connection);
  if (mismatch.mismatched) return mismatch.message;
  return null;
}

/** What a route hides and what it does not, for the line shown next to the trade button. */
export function routeNote(route: Route, connection: Connection | null): string {
  if (route === "pool") {
    return "Through the STRK20 pool: the chain sees neither who opened this, nor for how much, nor which band.";
  }
  const why =
    connection && !connection.capabilities.privateActions
      ? `${connection.walletName} does not expose STRK20 actions, so this is the route available to it. `
      : "";
  return `${why}Direct from your address: the chain sees that you staked, and how much — but not the band. That is revealed only when you claim.`;
}

/** The shielded balance, read through the wallet rather than by holding a key. */
export async function shieldedBalances(
  connection: Connection,
  tokens: string[],
): Promise<STRK20_BALANCE_ENTRY[]> {
  /**
   * Gated twice on purpose.
   *
   * `capabilities.balances` is only ever true for a wallet-standard connection, so the cast
   * below is safe — but a cast that depends on a flag two lines up is exactly the kind that
   * rots. `wallet` being null is the structural fact that a Privy connection has no such
   * interface, and checking it makes the narrowing true rather than merely believed.
   */
  if (!connection.capabilities.balances || !connection.wallet) return [];
  return (connection.account as Strk20Account).strk20Balances(tokens as `0x${string}`[]);
}

export type { STRK20_ACTION };

/**
 * A connection backed by Privy rather than by a browser extension.
 *
 * The account address is **not** Privy's `wallet.address`. That value is counterfactual and
 * matches no standard account preset — checked against seven class hashes, three salts and two
 * constructor shapes. Privy supplies a *signer*; the account class is the integration's choice,
 * which is what Privy's own reference hands to StarkZap's `accountPreset`. molfi picks
 * OpenZeppelin's, already declared on Sepolia, and derives the address from it and the public
 * key. Verified end to end: the derived account deploys and its `__validate__` accepts a
 * signature made by `rawSign`.
 *
 * Capabilities are honest about what this cannot do. A Privy account has no wallet-standard
 * interface, so no STRK20 actions and no shielded balance — `routesFor` therefore offers the
 * direct route only, and the desk says so rather than failing at signing time.
 */
export async function connectPrivy(
  address: string,
  publicKey: string,
  signer: SignerInterface,
): Promise<Connection> {
  const account = new Account({ provider, address, signer });
  void publicKey;
  return {
    address,
    chainId: CHAIN_IDS[activeNetwork.name],
    // networkOf maps a chain id to the two networks a connection can be on; devnet shares
    // Sepolia's id, so deriving it this way keeps one source of truth rather than two.
    network: networkOf(CHAIN_IDS[activeNetwork.name]),
    walletName: "Privy",
    capabilities: { privateActions: false, dryRun: false, balances: false },
    account,
    wallet: null,
  };
}

/**
 * Where a Privy signer's account lives, before it exists.
 *
 * Deterministic, so the same key always resolves to the same address on every device and
 * after every reload — which is what makes it safe to fund one before it is deployed.
 */
export function privyAccountAddress(publicKey: string): string {
  return hash.calculateContractAddressFromHash(
    publicKey,
    OZ_ACCOUNT_CLASS,
    CallData.compile({ publicKey }),
    0,
  );
}

/**
 * OpenZeppelin's account, as already declared on Sepolia.
 *
 * Chosen rather than invented: it is the class `sncast` itself deploys, so it is present on
 * the network without molfi having to declare anything, and its constructor takes exactly the
 * one public key a Privy signer provides.
 */
export const OZ_ACCOUNT_CLASS =
  "0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564";
