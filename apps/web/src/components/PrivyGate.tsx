"use client";

import { PrivyProvider, useIdentityToken, usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MARKETS } from "@molfi/sdk";
import { CoinMark, StarknetSpark } from "@/components/CoinMark";
import { Signer, type SignerInterface } from "starknet";
import { PrivySigner } from "@/lib/privy-signer";
import { prepareAccount, type PrepareStage } from "@/lib/prepare-account";
import { errorText } from "@/lib/pool";
import { useMemo, useRef } from "react";

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
  process.env.NODE_ENV !== "production" &&
  /**
   * Opt-in, not automatic.
   *
   * This used to switch itself on whenever the development keys were present, which made the
   * real front door **unreachable in development**: every local visit walked straight past
   * the login, so the one flow every genuine visitor takes — sign in, get a wallet, get it
   * funded and deployed — was the only flow that could never be exercised locally. A bypass
   * that hides the thing it is meant to help you build is worth less than no bypass.
   *
   * Now it needs saying out loud, and the default in development is the real door.
   */
  process.env.NEXT_PUBLIC_DEV_WALLET_BYPASS === "1" &&
  process.env.NEXT_PUBLIC_DEV_WALLET_ADDRESS &&
  process.env.NEXT_PUBLIC_DEV_WALLET_PUBLIC_KEY
    ? {
        id: "",
        address: process.env.NEXT_PUBLIC_DEV_WALLET_ADDRESS,
        publicKey: process.env.NEXT_PUBLIC_DEV_WALLET_PUBLIC_KEY,
        /** Already on chain, so the desk connects at this address instead of deriving one. */
        deployed: true,
      }
    : null;

export interface Wallet {
  id: string;
  address: string;
  publicKey: string;
  /**
   * Whether `address` is an account that exists, or one computed from the key.
   *
   * A fresh Privy wallet is the latter: a key whose account contract has not been deployed,
   * whose address molfi derives. Anything already on chain is the former, and deriving an
   * address for it would silently target a different, empty account.
   */
  deployed?: boolean;
}

/**
 * What the gate hands its children.
 *
 * The signer is built here rather than by the console, because it needs `getAccessToken` and
 * the identity token — both of which live in Privy's React context, which only exists inside
 * the provider. Handing down a wallet alone would mean the console reaching back for a context
 * it is not guaranteed to be inside.
 */
/**
 * What the gate hands the console.
 *
 * `SignerInterface`, not `PrivySigner`. Nothing downstream of the gate uses anything specific
 * to Privy's signer — the desk asks for a signature over a hash and does not care where the
 * key lives — so naming the concrete class here only had the effect of making any other real
 * signer a type error. Widening it to the interface starknet.js already defines is what the
 * code was always doing.
 */
export type GateChildren = (wallet: Wallet, signer: SignerInterface) => React.ReactNode;

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
   * How far the account is from being able to trade, and whether that work has started.
   *
   * `null` means not started; anything else is a stage to show. The ref is what stops a
   * second run: `prepareAccount` sends a **deployment transaction**, and React running an
   * effect twice — which it does in development, by design — would send two. The second
   * fails with the account already deployed, which is harmless, but it costs a fee and puts
   * a frightening error in front of somebody whose account is in fact fine.
   */
  const [stage, setStage] = useState<PrepareStage | null>(null);
  const preparing = useRef(false);

  /**
   * Whether the house can still fund a new account, asked before offering to make one.
   *
   * Only while signed out, and only once: it decides what the front door says, and nothing
   * behind the door depends on it. An existing player is unaffected either way, so there is
   * no reason to spend the request on them.
   *
   * Failure is deliberately silent and open. A health endpoint that times out says nothing
   * about the faucet, and putting "we cannot open accounts" in front of a working door on the
   * strength of a dropped request would be a worse bug than the one this fixes.
   */
  const [doorShut, setDoorShut] = useState(false);

  /**
   * One question, asked in two places, and the second one is the one that counts.
   *
   * On render it decides what the door *says*. On click it decides what the door *does* —
   * because the check takes a moment and the button is drawn immediately, so a render-time
   * answer alone leaves a window in which the button is visible, live, and wrong. Whoever
   * clicks inside that window is exactly the person this is for.
   *
   * Failure is silent and open at both sites. A dropped request says nothing about the
   * faucet, and putting a broken sign on a working door is the more expensive mistake.
   */
  const doorIsShut = useCallback(async (signal?: AbortSignal) => {
    try {
      /**
       * `/api/door`, not `/api/health`.
       *
       * Health answers a much larger question and answers **503** when the deployment is
       * degraded — so asking it here printed a red 503 in the console of the page a visitor
       * lands on, and made the door wait on nine oracle reads before deciding. This is one
       * balance read and always 200; a shut door is an answer, not a failure to answer.
       */
      const res = await fetch("/api/door", { cache: "no-store", signal });
      const d = (await res.json()) as { status?: string };
      const shut = d?.status === "down" || d?.status === "degraded";
      setDoorShut(shut);
      return shut;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (!ready || authenticated) return;
    const stop = new AbortController();
    void doorIsShut(stop.signal);
    return () => stop.abort();
  }, [ready, authenticated, doorIsShut]);

  /**
   * One signer for the session, rebuilt only when the key it signs for changes.
   *
   * Rebuilding it every render would hand `useLiveDesk` a new object each time and defeat the
   * memoisation on everything downstream of the connection.
   */
  const signer = useMemo(
    () =>
      /*
        In development, with the bypass explicitly on and a key explicitly supplied, the desk
        signs locally with starknet.js's own signer.

        This is not a stub. It produces a real signature over the real transaction hash and the
        result is broadcast down the same path as every other trade — same calldata, same fee
        estimate, same sequencer, same block. The single thing that differs from production is
        who holds the key: an environment variable here, Privy's server there.

        It exists because the desk could not be filmed. The bypass wallet carries an empty id
        so that anything trying to sign with it fails loudly, which is right for a stand-in and
        useless for a demo — every recording of the console showed a deck nobody could trade
        on, under narration describing a trade. The choice was a local key or a video that
        never shows the product working.

        Three locks, all of which must be open: it is compiled out of production builds, it
        requires the bypass to have been turned on by hand, and it requires a key that is not
        in the repository.
      */
      process.env.NODE_ENV !== "production" &&
      process.env.NEXT_PUBLIC_DEV_WALLET_BYPASS === "1" &&
      process.env.NEXT_PUBLIC_DEV_WALLET_PRIVATE_KEY
        ? new Signer(process.env.NEXT_PUBLIC_DEV_WALLET_PRIVATE_KEY)
        : new PrivySigner(wallet?.publicKey ?? "0x0", {
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

  /**
   * Once there is a wallet, make it into an account that can actually do something.
   *
   * Deliberately in the gate rather than in the console. The console's entire surface — the
   * balance, the quote, the fire key — is written against a wallet that works, and threading
   * "but it might not exist yet" through all of it would put that caveat in twenty places.
   * Here it is one door: nobody gets through it holding an account that cannot sign.
   */
  useEffect(() => {
    if (!wallet || stage === "ready" || preparing.current || error) return;
    preparing.current = true;
    void prepareAccount(
      wallet.publicKey,
      signer,
      { accessToken: () => getAccessToken(), identityToken: () => identityToken ?? null },
      setStage,
      wallet.deployed ? wallet.address : null,
    )
      .then((prepared) => {
        /**
         * Adopt the address the account actually lives at.
         *
         * Privy's wallet object carries *its* address for the key. molfi does not trade from
         * that — it trades from an OpenZeppelin account derived from the same public key, and
         * that is the address the faucet funded and `prepareAccount` deployed. Handing the
         * console Privy's address instead meant the balance strip read an address with
         * nothing in it and reported `ON CHAIN 0.0000 STRK` to somebody holding twelve.
         *
         * One address from here down, and it is the one with the money in it.
         */
        setWallet((w) => (w ? { ...w, address: prepared.address, deployed: true } : w));
        setStage("ready");
      })
      .catch((e) => {
        // Through `errorText`, not raw: starknet.js prefixes its failures with the whole
        // request it made, and a visitor stuck at the front door was being shown
        // `RPC: starknet_getClass with params {` — the question, not the answer.
        setError(errorText(e));
        // Cleared so TRY AGAIN can genuinely try again rather than being a button that
        // re-renders the same error.
        preparing.current = false;
      });
  }, [wallet, stage, error, signer, getAccessToken, identityToken]);

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

  /**
   * Do not offer a door that cannot open.
   *
   * A Privy wallet is a keypair; the account it controls does not exist until someone deploys
   * it, and `DEPLOY_ACCOUNT` is paid for by the account being deployed out of a balance it does
   * not have. The house goes first, and when the house cannot, signing in gets a stranger as
   * far as "SETTING UP YOUR ACCOUNT…" and then a failure — having spent their email, a round
   * trip and their patience to find out.
   *
   * Production ran exactly that way: no `FAUCET_ADDRESS` was set, `/api/wallet/fund` answered
   * 503 to everyone, and `/api/health` reported `ok: true` throughout. Asking first costs one
   * request against an endpoint the page already depends on, and turns the worst version of
   * this into the second best: told before you spend anything, rather than after.
   *
   * `null` is "not asked yet" and shows the normal button. An unreachable health endpoint is
   * deliberately treated as open — a check that fails closed would put a broken sign on a
   * working door, which is the more expensive mistake.
   */
  if (!authenticated) {
    return (
      <Shell>
        {doorShut ? (
          <>
            <p className="mono text-[11px] tracking-[0.15em] text-amber">THE DESK CANNOT OPEN NEW ACCOUNTS</p>
            <p className="mt-3 text-[12px] leading-relaxed text-white/45">
              molfi funds your first account so it can put itself on chain, and its float is
              empty right now — so signing in would get you a wallet that cannot move.
              {/*
                Only claims that are true whatever the desk is doing.
                
                This used to add "the markets below are live, they are settling" — two claims
                about live state, printed from a static string, on a screen that only appears
                when something is already wrong. Both were false while it was being shown: zero
                markets open and the keeper settling nothing. Reassurance a reader can falsify
                in one click is worse than no reassurance. What is below is permanent: claiming
                is on the contract and needs nobody's permission, and every settled market stays
                recomputable by a stranger.
              */}{" "}
              Nothing already on chain is affected — settling and claiming are permissionless,
              so anything open stays claimable by whoever holds it, and every market ever
              settled stays checkable here without an account.
            </p>
            <p className="mt-3 text-[12px] leading-relaxed text-white/45">
              Look around while you wait — the{" "}
              <Link href="/privacy" className="text-amber underline">
                privacy page
              </Link>{" "}
              is built from the contract&apos;s own ABI, and any market can be{" "}
              <Link href="/verify" className="text-amber underline">
                recomputed from scratch
              </Link>{" "}
              without an account at all.
            </p>
          </>
        ) : (
          <>
            <button
              onClick={async () => {
                // Re-asked here rather than trusted from render: see `doorIsShut`. If it is
                // shut, this re-renders into the message above instead of opening Privy.
                if (await doorIsShut()) return;
                login();
              }}
              className="key w-full rounded-full bg-amber-2 py-3.5 text-[14px] font-extrabold tracking-tight text-black"
            >
              CONNECT TO PLAY
            </button>
            <p className="mt-4 text-[12px] leading-relaxed text-white/45">
              An email address is enough — Privy makes you a Starknet wallet and holds the key,
              so there is no extension to install and no seed phrase to write down. Your band
              and your size stay sealed until the round settles either way.
            </p>
          </>
        )}
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

  /**
   * The wait, described rather than spun.
   *
   * This is two transactions on a public testnet and it takes the better part of half a
   * minute. A bare spinner for that long reads as broken, and the honest thing to say is also
   * the interesting thing: the desk is putting a brand-new account on chain and paying for it.
   */
  if (stage !== "ready") {
    return (
      <Shell>
        <p className="mono text-[11px] tracking-[0.15em] text-white/35">
          {stage === "deploying" ? "PUTTING YOUR ACCOUNT ON CHAIN…" : "SETTING UP YOUR ACCOUNT…"}
        </p>
        <p className="mt-3 text-[12px] leading-relaxed text-white/45">
          {stage === "deploying"
            ? "Your account is being deployed to Starknet Sepolia, signed by your own key. This takes a few seconds and happens once."
            : "molfi is sending your new account enough STRK to play with. Testnet money — but every position you take with it is a real transaction."}
        </p>
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
            {/* Derived from MARKETS, not written out — this said "THREE MARKETS" for a while
                after there were nine, which is the failure mode of a hand-typed count. */}
            {MARKETS.slice(0, 4).map((m) => (
              <CoinMark key={m.key} coin={m.key} size={26} />
            ))}
            <span className="mono ml-1 text-[9.5px] tracking-[0.14em] text-white/30">
              {MARKETS.length} MARKETS
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
