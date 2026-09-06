"use client";

import { createStore, type Store } from "@starknet-io/get-starknet-core";
import { WalletAccountV6 } from "starknet";
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
  account: Strk20Account;
  wallet: StarknetWallet;
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

/**
 * What a wallet can actually do — asked, not inferred from the shape of the object.
 *
 * This used to test `typeof account.strk20InvokeTransaction === "function"` and always got
 * `true`. starknet.js binds the STRK20 helpers onto every `WalletAccountV6` it builds; each
 * one is a thin wrapper that forwards `wallet_strk20InvokeTransaction` to the wallet, and
 * whether the wallet answers is a question only asking can settle. So every wallet reported
 * itself STRK20-capable, molfi offered the pool route to wallets that cannot take it, and —
 * worse — made it the *default*, because the pool route is listed first. The trade then
 * failed inside the wallet with a message about an unsupported method, on the one screen
 * where a trader is committing money.
 *
 * The probe is `strk20Balances`, which is a read: no signature, no prompt, nothing spent. A
 * wallet that answers it speaks STRK20; one that rejects it does not, whatever methods
 * happen to exist on the object.
 *
 * Only a successful answer counts as support. Treating an ambiguous failure as "probably
 * fine" is how the original bug behaved, and offering a route that cannot work is worse than
 * withholding one that might — molfi has a second route, and it works from any wallet.
 */
export async function capabilitiesOf(
  account: Strk20Account,
  token: string | null,
): Promise<Capabilities> {
  const none: Capabilities = { privateActions: false, dryRun: false, balances: false };
  if (!token || typeof account.strk20Balances !== "function") return none;

  try {
    await account.strk20Balances([token as `0x${string}`]);
  } catch {
    return none;
  }

  return {
    privateActions: typeof account.strk20InvokeTransaction === "function",
    dryRun: typeof account.strk20PrepareInvoke === "function",
    balances: true,
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
    capabilities: await capabilitiesOf(account, token),
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
      capabilities: await capabilitiesOf(account, token),
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
  if (!connection.capabilities.balances) return [];
  return connection.account.strk20Balances(tokens as `0x${string}`[]);
}

export type { STRK20_ACTION };
