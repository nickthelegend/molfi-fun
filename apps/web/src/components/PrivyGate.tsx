"use client";

import { PrivyProvider, useIdentityToken, usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CoinMark, StarknetSpark } from "@/components/CoinMark";
import { PrivySigner } from "@/lib/privy-signer";
import { useMemo } from "react";

/**
 * The door in front of the console.
 *
 * molfi used to open straight onto a paper desk so a judge with no Starknet wallet could still
 * see the game. That was the right call when connecting meant installing a browser extension
 * and finding testnet STRK. With Privy it means an email address, and a desk that plays with
 * imaginary money is a worse first impression than one that asks for thirty seconds and then
 * plays with real money against a real chain.
 *
 * What is behind the door is the real thing. What is in front of it is one button and an
 * honest description of what happens when you press it.
 */

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

/**
 * The stand-in the development escape hands the console.
 *
 * The address is the keeper's — a real, public, funded account on Sepolia — so the balance
 * strip exercises the real read path against a real number instead of rendering a dash. The
 * wallet **id is empty on purpose**: signing looks the id up, so anything that tries to sign
 * with this fails loudly at the signer rather than quietly appearing to work. It renders the
 * deck, and that is all it can do.
 */
const devWallet: Wallet | null =
  process.env.NODE_ENV === "production"
    ? null
    : {
        id: "",
        address: "0x788e67ade3c9e65e04c391518e9de7036a548e9733193d7d6a63ab85f0e9e8f",
        publicKey: "0x0",
      };

export interface Wallet {
  id: string;
  address: string;
  publicKey: string;
}

/**
 * What the gate hands its children.
 *
 * The signer is built here rather than by the console, because it needs `getAccessToken` and
 * the identity token — both of which live in Privy's React context, which only exists inside
 * the provider. Handing down a wallet alone would mean the console reaching back for a context
 * it is not guaranteed to be inside.
 */
export type GateChildren = (wallet: Wallet, signer: PrivySigner) => React.ReactNode;

export function PrivyGate({ children }: { children: GateChildren }) {
  if (!APP_ID) {
    // An unconfigured deploy says so rather than rendering a button that cannot work.
    return (
      <Shell>
        <p className="text-[13px] leading-relaxed text-white/55">
          Wallets are not configured on this deployment, so there is nothing to sign in to.
          That is the honest state before the key is set rather than an error.
        </p>
      </Shell>
    );
  }
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#ff9f0a",
          logo: undefined,
          walletChainType: "ethereum-and-solana",
        },
        // Email first. The point of using Privy at all is that a visitor needs no extension,
        // no seed phrase and no testnet faucet before they can look at the product.
        loginMethods: ["email", "google", "wallet"],
        /**
         * No EVM or Solana wallet on login.
         *
         * molfi is a Starknet app and Privy's Starknet wallets are created server-side, so an
         * embedded Ethereum wallet made at sign-in would be an account the visitor did not ask
         * for, cannot use here, and would reasonably wonder about.
         */
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
      }}
    >
      <Inner>{children}</Inner>
    </PrivyProvider>
  );
}

function Inner({ children }: { children: GateChildren }) {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  /**
   * One signer for the session, rebuilt only when the key it signs for changes.
   *
   * Rebuilding it every render would hand `useLiveDesk` a new object each time and defeat the
   * memoisation on everything downstream of the connection.
   */
  const signer = useMemo(
    () =>
      new PrivySigner(wallet?.publicKey ?? "0x0", {
        accessToken: () => getAccessToken(),
        identityToken: () => identityToken ?? null,
      }),
    [wallet?.publicKey, getAccessToken, identityToken],
  );

  /**
   * Ask the server for this account's Starknet wallet, making one on the first visit.
   *
   * Deliberately server-side. Privy's Starknet support is server-managed, so the browser has
   * no way to create the wallet itself and no business holding the key if it could.
   */
  const claim = useCallback(async () => {
    setClaiming(true);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("your session expired — sign in again");
      const res = await fetch("/api/wallet/starknet", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
          ...(identityToken ? { "x-privy-id-token": identityToken } : {}),
        },
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        wallet?: Wallet;
        error?: string;
      };
      if (!res.ok || !body.wallet) throw new Error(body.error ?? `the wallet service answered ${res.status}`);
      setWallet(body.wallet);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setClaiming(false);
    }
  }, [getAccessToken, identityToken]);

  useEffect(() => {
    /**
     * Fire on `authenticated`. Never wait for the identity token.
     *
     * This used to read `authenticated && identityToken`, on the reasoning that the lookup
     * needed the token and it arrived a beat later. Identity tokens turn out to be a per-app
     * Privy setting that this app does not have switched on, so `identityToken` was always
     * null, the effect never ran, and a visitor who had **successfully logged in** watched
     * "OPENING YOUR WALLET…" forever. Nothing errored; nothing was even requested.
     *
     * The server resolves the wallet from an idempotent create keyed on the user id, so the
     * token is an optimisation rather than a requirement — sent when present, never waited on.
     */
    if (authenticated && !wallet && !claiming && !error) void claim();
  }, [authenticated, identityToken, wallet, claiming, error, claim]);

  if (!ready) {
    return (
      <Shell>
        <p className="mono text-[11px] tracking-[0.15em] text-white/35">CHECKING YOUR SESSION…</p>
      </Shell>
    );
  }

  /**
   * A way past the door while developing, and only while developing.
   *
   * The gate needs a real email round trip, which makes the console unreachable from any
   * automated check — and a game nobody can open is a game nobody can test. `NODE_ENV` is
   * inlined by the bundler at build time, so on a production build this whole branch is
   * removed as dead code rather than merely skipped: there is no flag to flip, no header to
   * forge and no query string that reaches it.
   */
  if (!authenticated && process.env.NODE_ENV !== "production" && devWallet) {
    return <>{children(devWallet, signer)}</>;
  }

  if (!authenticated) {
    return (
      <Shell>
        <button
          onClick={() => login()}
          className="key w-full rounded-full bg-amber-2 py-3.5 text-[14px] font-extrabold tracking-tight text-black"
        >
          CONNECT TO PLAY
        </button>
        <p className="mt-4 text-[12px] leading-relaxed text-white/45">
          An email address is enough — Privy makes you a Starknet wallet and holds the key, so
          there is no extension to install and no seed phrase to write down. Your band and your
          size stay sealed until the round settles either way.
        </p>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <p className="text-[13px] leading-relaxed text-red">{error}</p>
        <button
          onClick={() => void claim()}
          className="key mt-4 w-full rounded-full bg-[#242424] py-3 text-[13px] font-semibold"
        >
          TRY AGAIN
        </button>
      </Shell>
    );
  }

  if (!wallet) {
    return (
      <Shell>
        <p className="mono text-[11px] tracking-[0.15em] text-white/35">OPENING YOUR WALLET…</p>
      </Shell>
    );
  }

  return <>{children(wallet, signer)}</>;
}

/** The card the door lives in, so every state is the same shape and nothing jumps. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="tiled grid min-h-dvh place-items-center px-5 py-10">
      <div className="w-full max-w-[380px]">
        <div className="rounded-[22px] bg-card p-7">
          <div className="flex items-center gap-2">
            <span className="text-purple">
              <StarknetSpark size={15} />
            </span>
            <span className="label">molfi · Starknet</span>
          </div>

          <h1 className="mt-3 text-[24px] font-extrabold leading-tight tracking-tight">
            Take a position nobody can see.
          </h1>

          <div className="mt-4 flex items-center gap-2">
            {["BTC", "ETH", "STRK"].map((c) => (
              <CoinMark key={c} coin={c} size={26} />
            ))}
            <span className="mono ml-1 text-[9.5px] tracking-[0.14em] text-white/30">
              THREE MARKETS
            </span>
          </div>

          <div className="mt-5">{children}</div>
        </div>

        <p className="mt-4 text-center text-[11px] text-white/25">
          <Link href="/privacy" className="underline hover:text-white/45">
            what leaks
          </Link>
          {" · "}
          <Link href="/verify" className="underline hover:text-white/45">
            check a position
          </Link>
          {" · "}
          <Link href="/keeper" className="underline hover:text-white/45">
            who settles these
          </Link>
        </p>
      </div>
    </main>
  );
}
