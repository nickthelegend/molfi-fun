"use client";

import type { SignerInterface } from "starknet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CallData } from "starknet";
import {
  MARKETS,
  ROUND_SECONDS,
  claimDirectionCalls,
  newSecret,
  openDirectionCalls,
  type DirectionSecret,
  type MarketDef,
  outcomeOf,
  type PositionSecret,
} from "@molfi/sdk";
import { ADDRESSES, LIVE_CONFIGURED, liveBlockedReason, provider } from "./chain";
import {
  blockingReason,
  connectTo,
  reconnect,
  connectPrivy,
  privyAccountAddress,
  NO_TIP,
  routeNote,
  routesFor,
  shieldedBalances,
  type Connection,
  type Route,
  type StarknetWallet,
} from "./wallet";
import { claimCalls, openCalls, submitDirect } from "./direct";
import {
  claimActions,
  errorText,
  openActions,
  shieldActions,
  submit,
  unshieldActions,
  type PoolAddresses,
} from "./pool";
import {
  allPositions,
  exportPosition,
  forget,
  markClaimed,
  isDirection,
  remember,
  rememberDirection,
  subscribe,
  type StoredPosition,
} from "./positions";
import { fetchJson } from "./fetchJson";
import type { PricePoint } from "./usePaperDesk";

/**
 * The live desk.
 *
 * Everything on screen is read from the chain or from the user's own wallet. Nothing here
 * is simulated: if the node is down the desk says so rather than falling back to invented
 * numbers.
 *
 * The shape is different from the Monad build in one way that matters. There, the desk read
 * `ticketsOf(account)` and the chain told it what the player owned. Here the chain stores a
 * commitment and nothing that links it to anyone — so positions come from the local store,
 * and the chain is asked only to confirm what it already holds under a commitment the
 * browser derived. That is not a limitation working around privacy; it *is* the privacy.
 */

const HISTORY = 160;
const READ_EVERY_MS = 8_000;

export interface LiveMarket {
  id: number;
  pair: string;
  cutoffAt: number;
  isSettled: boolean;
  settledPrice: bigint;
  settledAt: number;
  settledSources: number;
  staked: bigint;
  paid: bigint;
  bankroll: bigint;
  reserved: bigint;
  sigma1e4: bigint;
  houseEdgeBps: number;
}

/**
 * A stored position, joined with whatever the chain says about it.
 *
 * An intersection rather than `extends`, because `StoredPosition` is a union of the two games
 * and an interface extending a union does not distribute over it — every field of both arms
 * becomes unreachable. `A & B` over a union does distribute, so a reader that has narrowed on
 * `game` still sees the right half.
 */
export type LivePosition = StoredPosition & {
  onChain: {
    exists: boolean;
    claimed: boolean;
    stake: bigint;
    multiplierBps: bigint;
  } | null;
  market: LiveMarket | null;
  /** True when the market has settled and the settled price landed inside the band. */
  won: boolean | null;
};

export interface LiveState {
  ready: boolean;
  /** Why the live desk cannot be used at all, or null. Not an error — a configuration fact. */
  unavailable: string | null;
  error: string | null;
  connection: Connection | null;
  /** Why the connected wallet cannot act, or null. */
  blocked: string | null;
  /**
   * Whether the deployed contract has the public trading route.
   *
   * Probed, not assumed. An older deployment only has `privacy_invoke`, and offering a
   * direct trade against it produces `ENTRYPOINT_NOT_FOUND` after the user has already
   * approved a stake. Null while the probe is in flight.
   */
  directRoute: boolean | null;
  wallets: StarknetWallet[];
  /** Shielded STRK, as the wallet reports it. molfi never holds a key to check. */
  shielded: bigint | null;
  markets: LiveMarket[];
  positions: LivePosition[];
  /**
   * The chain's clock, and when this browser read it.
   *
   * Deadlines are block timestamps, so anything comparing against them has to use the
   * chain's clock rather than the browser's. Interpolated between polls from the local
   * monotonic clock, which is fine for a countdown and exact enough for a cutoff.
   */
  chainNow: number | null;
  chainNowReadAt: number;
  /**
   * Every market past its cutoff that nobody has settled.
   *
   * Settlement is permissionless on purpose — a market whose resolution depends on the
   * operator showing up is not one you should take the other side of — so the desk shows
   * the whole queue and lets anyone clear it.
   */
  dueMarkets: LiveMarket[];
  spot: bigint;
  history: PricePoint[];
  pending: string | null;
  lastTx: { hash: string; label: string } | null;
}

const EMPTY: LiveState = {
  ready: false,
  unavailable: null,
  error: null,
  connection: null,
  blocked: null,
  directRoute: null,
  wallets: [],
  shielded: null,
  markets: [],
  chainNow: null,
  chainNowReadAt: 0,
  positions: [],
  dueMarkets: [],
  spot: 0n,
  history: [],
  pending: null,
  lastTx: null,
};

/**
 * One transaction at a time, per session.
 *
 * Two in flight from the same account collide on a nonce: the wallet hands both the same
 * one, the second is rejected as a replacement, and the desk reports a failure for a
 * position the user did open. A queue rather than a lock, because refusing the second press
 * would be worse than sequencing it.
 */
let txQueue: Promise<unknown> = Promise.resolve();

function queued<T>(job: () => Promise<T>): Promise<T> {
  const run = txQueue.then(job, job);
  // Keep the chain alive after a rejection; one failure must not wedge every later call.
  txQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}


/** felt → the short string it encodes, e.g. 'BTC/USD'. */
function toLabel(felt: string): string {
  let n = BigInt(felt);
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  return String.fromCharCode(...bytes);
}

export function useLiveDesk(market: MarketDef, tier: number) {
  const [state, setState] = useState<LiveState>({
    ...EMPTY,
    unavailable: liveBlockedReason(),
  });
  const connectionRef = useRef<Connection | null>(null);
  /**
   * Whether a chain read is already in flight.
   *
   * The poll runs on a fixed interval, and nothing stopped a second one starting while the
   * first was still going. When the node is slow that is a feedback loop rather than a
   * nuisance: a read that takes longer than the interval means two reads overlap, which
   * makes the node slower, which makes more of them overlap. Observed against a public
   * endpoint — the market read climbed from a second to twenty-five as the polls stacked up.
   * Skipping a tick costs eight seconds of staleness; not skipping costs the endpoint.
   */
  const reading = useRef(false);
  const historyRef = useRef<PricePoint[]>([]);
  const [stored, setStored] = useState<StoredPosition[]>([]);

  const addresses: PoolAddresses | null = useMemo(
    () =>
      ADDRESSES.pool && ADDRESSES.token && ADDRESSES.market
        ? { pool: ADDRESSES.pool, token: ADDRESSES.token, market: ADDRESSES.market }
        : null,
    [],
  );

  // ---- the local position store, which is the only index of what this browser owns
  useEffect(() => {
    setStored(allPositions());
    return subscribe(setStored);
  }, []);

  // ---- the wallets the browser is offering, and any already-authorised one
  useEffect(() => {
    if (typeof window === "undefined") return;
    let stop = false;
    void (async () => {
      const { walletStore } = await import("./wallet");
      const store = walletStore();
      const publish = () => {
        if (!stop) setState((s) => ({ ...s, wallets: [...store.getWallets()] }));
      };
      publish();
      const unsubscribe = store.subscribe(publish);

      for (const w of store.getWallets()) {
        const c = await reconnect(w, ADDRESSES.token);
        if (c && !stop) {
          connectionRef.current = c;
          setState((s) => ({ ...s, connection: c, blocked: blockingReason(c) }));
          break;
        }
      }
      if (stop) unsubscribe();
    })();
    return () => {
      stop = true;
    };
  }, []);

  /**
   * Ask the contract whether it can be traded directly.
   *
   * `quote_offsets` is a view and costs nothing, and it exists only on a deployment that
   * also has `open_position` — the two shipped together. A revert here is the honest answer
   * that this contract is pool-only, and the console then stops offering the direct route
   * rather than letting someone find out by paying for a transaction that cannot work.
   */
  useEffect(() => {
    if (!addresses) return;
    let stop = false;
    void (async () => {
      try {
        await provider.callContract({
          contractAddress: addresses.market,
          entrypoint: "quote_offsets",
          calldata: CallData.compile([1, { low: 171_077n, high: 0n }, { low: 171_077n, high: 0n }]),
        });
        if (!stop) setState((s) => ({ ...s, directRoute: true }));
      } catch (e) {
        // Only an unknown entrypoint means "no direct route". Every other failure — an
        // unreachable node, a market id that does not exist yet — says nothing about the
        // contract's shape, and treating those as a missing route would hide a working one.
        //
        // The whole error, not `errorText`. starknet.js puts the request params on the first
        // line and the actual reason twenty lines below it, so the one-line summary this app
        // shows users is exactly the part that never contains the answer.
        const text = String((e as Error)?.message ?? e);
        if (/entrypoint does not exist|ENTRYPOINT_NOT_FOUND|not found in contract/i.test(text)) {
          if (!stop) setState((s) => ({ ...s, directRoute: false }));
        } else if (!stop) {
          setState((s) => ({ ...s, directRoute: true }));
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [addresses]);

  // ---- the markets the contract holds
  const refresh = useCallback(async () => {
    if (!addresses || reading.current) return;
    reading.current = true;
    try {
      /**
       * One request for the whole market list, not one per market.
       *
       * This used to walk `market_count` and then call `get_market` for every id from the
       * browser. That is N+1 RPC calls every eight seconds, and N grows forever — the keeper
       * lists three more markets every quarter of an hour. Measured on the live site it was
       * ninety calls in eighty seconds and climbing, all of them against a public endpoint
       * that rate limits.
       *
       * `/api/markets` already does exactly this read server-side, from one origin, on the
       * keyed endpoint, with the decoding in one place. Asking it once is strictly better in
       * every direction: fewer requests, cached, and no second copy of the struct offsets to
       * drift out of step.
       */
      /**
       * A market list that cannot be read must not take the position list with it.
       *
       * This used to throw straight out of the read cycle, which meant `positions` was never
       * computed and the desk showed "Nothing here yet" — while the local store, the only
       * index of what this browser owns, still held them. A slow node made a payout look
       * lost. The market data is enrichment for a row; its absence degrades the row to
       * "unread", which the join below already handles, and never removes it.
       */
      let body: {
        deployed?: boolean;
        reason?: string;
        error?: string;
        markets?: Array<Record<string, string | number | boolean>>;
        chainNow?: number;
      } = {};
      let marketsError: string | null = null;
      try {
        body = await fetchJson<typeof body>("/api/markets");
        if (body.error) throw new Error(body.error);
      } catch (e) {
        marketsError = errorText(e);
      }

      const markets: LiveMarket[] = (body.markets ?? []).map((m) => ({
        id: Number(m.id),
        pair: String(m.pair),
        cutoffAt: Number(m.cutoffAt),
        roundSeconds: Number(m.roundSeconds),
        sigma1e4: BigInt(String(m.sigma1e4)),
        houseEdgeBps: Number(m.houseEdgeBps),
        settledPrice: BigInt(String(m.settledPrice)),
        settledAt: Number(m.settledAt),
        settledBlockAt: Number(m.settledBlockAt),
        settledSources: Number(m.settledSources),
        isSettled: Boolean(m.isSettled),
        staked: BigInt(String(m.staked)),
        paid: BigInt(String(m.paid)),
        bankroll: BigInt(String(m.bankroll)),
        reserved: BigInt(String(m.reserved)),
      }));

      // The chain's clock, not this machine's. A console that decides what is due from
      // `Date.now()` hides settlements the contract already accepts, and offers opens it
      // will refuse, whenever the two disagree.
      const chainNow = typeof body.chainNow === "number" ? body.chainNow : null;
      const now = chainNow ?? Math.floor(Date.now() / 1000);
      const dueMarkets = markets.filter((m) => !m.isSettled && m.cutoffAt <= now);

      // Positions are looked up by commitment, which is public and says nothing about who
      // is asking. This is the only read that could ever link a viewer to a position, and
      // it is a plain `starknet_call` from whatever node the browser is using.
      const positions: LivePosition[] = await Promise.all(
        allPositions().map(async (p) => {
          // A direction ticket belongs to a round on the other contract, so it has no entry
          // in this list. Its own round is read by the console from /api/rounds.
          let market = isDirection(p) ? null : markets.find((x) => x.id === p.marketId) ?? null;
          let onChain: LivePosition["onChain"] = null;
          try {
            /**
             * Two games, two contracts, two routes.
             *
             * A direction ticket lives on the up/down contract and `/api/position` reads the
             * range market, so asking it about one does not fail — it answers `exists: false`,
             * confidently, about a contract that has never heard of the commitment. Anything
             * downstream that trusts that answer concludes a real stake on a real round is a
             * ticket that was never opened. It is the wrong question rather than a wrong
             * answer, and the fix is to ask the right contract.
             */
            if (isDirection(p)) {
              const t = await fetchJson<{
                exists?: boolean;
                ticket?: { stake: string; multiplierBps: string; claimed: boolean; exists: boolean };
                round?: Record<string, string | number | boolean>;
              }>(`/api/ticket/${p.commitment}`);
              if (t.exists && t.ticket) {
                onChain = {
                  stake: BigInt(t.ticket.stake),
                  multiplierBps: BigInt(t.ticket.multiplierBps),
                  claimed: t.ticket.claimed,
                  exists: true,
                };
              } else if (t.exists === false) {
                onChain = { stake: 0n, multiplierBps: 0n, claimed: false, exists: false };
              }
              /**
               * Won, lost or tied — decided here, from the round's own two prices.
               *
               * The ticket does not say which way it went and never will; the direction is in
               * the secret this browser holds. So the outcome is that secret compared against
               * a comparison anyone can make, which is exactly the property the game is for.
               */
              const rd = t.round;
              const won =
                rd && Boolean(rd.isSettled) && BigInt(String(rd.settledPrice)) > 0n
                  ? (() => {
                      const o = outcomeOf(
                        BigInt(String(rd.referencePrice)),
                        BigInt(String(rd.settledPrice)),
                      );
                      // A tie returns the stake, so it is not a loss — there is something to
                      // claim either way, and calling it lost would hide a refund.
                      return o === "tie" ? true : o === p.direction;
                    })()
                  : null;
              return { ...p, onChain, market: null, won };
            }

            // Through the app's own route, like the market list. It decodes the struct in
            // one place — a u256 is two felts and a u128 is one, and a second copy of those
            // offsets is a second thing to get wrong.
            const body = await fetchJson<{
              exists?: boolean;
              position?: {
                stake: string;
                multiplierBps: string;
                claimed: boolean;
                exists: boolean;
              };
              market?: Record<string, string | number | boolean>;
            }>(`/api/position/${p.commitment}`);

            // The market list is a recent window, so a position older than it would
            // otherwise have no market and sit "unresolved" for ever. The position route
            // returns the market it belongs to; use that when the window does not reach it.
            if (!market && body.market) {
              const b = body.market;
              market = {
                id: Number(b.id),
                pair: String(b.pair),
                cutoffAt: Number(b.cutoffAt),
                sigma1e4: BigInt(String(b.sigma1e4)),
                houseEdgeBps: Number(b.houseEdgeBps),
                settledPrice: BigInt(String(b.settledPrice)),
                settledAt: Number(b.settledAt),
                settledSources: Number(b.settledSources),
                isSettled: Boolean(b.isSettled),
                staked: BigInt(String(b.staked)),
                paid: BigInt(String(b.paid)),
                bankroll: BigInt(String(b.bankroll)),
                reserved: BigInt(String(b.reserved)),
              };
            }

            if (body.exists && body.position) {
              onChain = {
                stake: BigInt(body.position.stake),
                multiplierBps: BigInt(body.position.multiplierBps),
                claimed: body.position.claimed,
                exists: body.position.exists,
              };
            } else if (body.exists === false) {
              onChain = { stake: 0n, multiplierBps: 0n, claimed: false, exists: false };
            }
          } catch {
            // A position that could not be read is shown as unknown, not as absent. Those
            // are different facts and only one of them means "this does not exist".
          }
          /**
           * Whether this position is in the money, for the games that can say.
           *
           * A range position wins on the settled price landing inside its band, inclusive at
           * both edges — the same comparison the contract makes, so the desk and the chain
           * agree. A direction ticket's outcome depends on its round's reference, which lives
           * on the other contract and is not in `markets`; it reads `null` here rather than
           * guessing, and the console resolves it from the round.
           */
          const won =
            !isDirection(p) && market?.isSettled && market.settledPrice > 0n
              ? market.settledPrice >= p.bandLow && market.settledPrice <= p.bandHigh
              : null;
          return { ...p, onChain, market, won };
        }),
      );

      let shielded: bigint | null = null;
      const c = connectionRef.current;
      if (c?.capabilities.balances && addresses.token) {
        try {
          const balances = await shieldedBalances(c, [addresses.token]);
          const entry = balances.find((b) => BigInt(b.token) === BigInt(addresses.token));
          shielded = entry ? BigInt(entry.balance) : 0n;
        } catch {
          // A wallet that will not answer leaves the balance unknown rather than zero.
          // Rendering an unknown balance as "0.000 STRK" is a lie with a decimal point.
          shielded = null;
        }
      }

      setState((s) => ({
        ...s,
        ready: true,
        // Still reported, still visible over the chart — the desk just no longer forgets
        // what it owns while saying so.
        error: marketsError,
        markets,
        chainNow,
        chainNowReadAt: Date.now(),
        dueMarkets,
        positions,
        shielded,
      }));
    } catch (e) {
      setState((s) => ({ ...s, error: errorText(e) }));
    } finally {
      reading.current = false;
    }
  }, [addresses, stored]);

  useEffect(() => {
    if (!addresses) return;
    void refresh();
    const id = setInterval(() => void refresh(), READ_EVERY_MS);
    return () => clearInterval(id);
  }, [addresses, refresh]);

  // ---- the mark, from the same route the paper desk uses
  /**
   * Seed the chart from real tape before the first poll.
   *
   * The live desk built its history from its own polls, which meant arriving at the console
   * and watching a flat line for several minutes — every sample five seconds apart on a
   * price that moves in basis points, on the screen that is supposed to be the product. The
   * paper desk never had this problem because it seeds a backlog and the live one did not.
   *
   * Seeded from the same one-minute closes the tables were fitted on, so nothing here is
   * invented: it is the market's actual recent path, ending where the market actually is.
   * Cleared and refetched when the market changes, because BTC's history is not ETH's.
   */
  useEffect(() => {
    let stop = false;
    historyRef.current = [];
    setState((s) => ({ ...s, history: [] }));

    void (async () => {
      try {
        const j = await fetchJson<{ price?: string | null; returns?: number[] }>(
          `/api/price?market=${encodeURIComponent(market.key)}&history=1`,
        );
        if (stop || !j.price || !j.returns || j.returns.length < 8) return;
        // Only seed if the live poll has not already filled it — a slow history fetch must
        // not overwrite fresher points that arrived while it was in flight.
        if (historyRef.current.length > 1) return;

        // Walk the real returns backwards from the current price, so the backlog leads up to
        // where the market is rather than away from it.
        const now = Math.floor(Date.now() / 1000);
        const start = Number(BigInt(j.price));
        const back: PricePoint[] = [];
        let p = start;
        const take = Math.min(HISTORY, j.returns.length);
        for (let i = 1; i <= take; i += 1) {
          p /= Math.exp(j.returns[j.returns.length - i]);
          back.push({ at: now - i * 60, price: BigInt(Math.max(1, Math.round(p))) });
        }
        back.reverse();
        historyRef.current = back;
        setState((s) => ({ ...s, history: [...back] }));
      } catch {
        // No seed is a flat line for a minute, which is the behaviour this replaces rather
        // than a new failure. The live poll below is the thing that must not break.
      }
    })();

    return () => {
      stop = true;
    };
  }, [market.key]);

  useEffect(() => {
    let stop = false;

    /**
     * Clear the price the moment the market changes, before the new one is asked for.
     *
     * Without this the header kept the previous market's number under the new market's name
     * for as long as the fetch took — about a second, measured. Switching from ETH to SOL
     * showed "SOL 2,519.75", formatted to SOL's decimals so it looked entirely plausible. On
     * a screen someone opens a position from, a real price under the wrong label is worse
     * than no price: a dash is obviously not actionable, and a wrong number is not.
     *
     * The history goes with it. It is a trace of a different asset and drawing it under the
     * new one would be the same lie in chart form.
     */
    historyRef.current = [];
    setState((s) => ({ ...s, spot: 0n, history: [] }));

    const read = async () => {
      try {
        const j = await fetchJson<{
          price?: string | null;
          error?: string;
          markError?: string | null;
        }>(`/api/price?market=${encodeURIComponent(market.key)}`);
        if (stop) return;
        if (!j.price) throw new Error(j.markError ?? j.error ?? "the price service returned nothing");
        const price = BigInt(j.price);
        const h = historyRef.current;
        if (h.length === 0 || h[h.length - 1].price !== price) {
          h.push({ at: Math.floor(Date.now() / 1000), price });
          if (h.length > HISTORY) h.shift();
        }
        setState((s) => ({ ...s, spot: price, history: [...h] }));
      } catch (e) {
        if (!stop) setState((s) => ({ ...s, error: errorText(e) }));
      }
    };
    void read();
    const id = setInterval(read, 5_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [market.key]);

  const connect = useCallback(async (wallet: StarknetWallet) => {
    try {
      const c = await connectTo(wallet, ADDRESSES.token);
      connectionRef.current = c;
      setState((s) => ({ ...s, connection: c, blocked: blockingReason(c), error: null }));
      void refresh();
      return c;
    } catch (e) {
      setState((s) => ({ ...s, error: errorText(e) }));
      throw e;
    }
  }, [refresh]);

  /**
   * Connect the account behind a Privy session.
   *
   * The address is derived rather than taken from Privy: `wallet.address` is counterfactual
   * and belongs to no account class, so molfi computes where an OpenZeppelin account holding
   * that public key would live and uses that. Deterministic, so the same login lands on the
   * same address from any device.
   *
   * The account may not be deployed yet — a Starknet account is an address until someone pays
   * to make it a contract — and that is deliberately not this function's problem. It connects;
   * `deployIfNeeded` below is what makes it able to act.
   */
  const connectWithPrivy = useCallback(
    async (publicKey: string, signer: SignerInterface, at?: string) => {
      try {
        /**
         * Derived from the key, unless the caller knows better.
         *
         * A Privy wallet is a key with no account contract behind it yet, so its address is
         * computed — the same key resolves to the same address on every device, which is what
         * makes it safe to fund one before it exists. An account that is *already* deployed
         * has an address of its own and deriving one would point at an empty address that
         * merely happens to be reachable with the same key.
         */
        const address = at ?? privyAccountAddress(publicKey);
        const c = await connectPrivy(address, publicKey, signer);
        connectionRef.current = c;
        setState((s) => ({ ...s, connection: c, blocked: blockingReason(c), error: null }));
        void refresh();
        return c;
      } catch (e) {
        setState((s) => ({ ...s, error: errorText(e) }));
        throw e;
      }
    },
    [refresh],
  );

  const disconnect = useCallback(() => {
    connectionRef.current = null;
    setState((s) => ({ ...s, connection: null, blocked: null, shielded: null }));
  }, []);

  /** Public STRK into the pool. The public leg names you; nothing after it does. */
  const shield = useCallback(
    (amount: bigint) =>
      queued(async () => {
        const c = connectionRef.current;
        if (!c || !addresses) throw new Error("connect a wallet first");
        setState((s) => ({ ...s, pending: "shielding" }));
        const r = await submit(c, shieldActions(addresses, amount));
        setState((s) => ({
          ...s,
          pending: null,
          lastTx: r.ok ? { hash: r.txHash!, label: "shielded" } : s.lastTx,
        }));
        if (!r.ok) throw new Error(r.error);
        void refresh();
        return r.txHash!;
      }),
    [addresses, refresh],
  );

  /** Private balance back out to a public address. Public again, and by design. */
  const unshield = useCallback(
    (amount: bigint, to: string) =>
      queued(async () => {
        const c = connectionRef.current;
        if (!c || !addresses) throw new Error("connect a wallet first");
        setState((s) => ({ ...s, pending: "withdrawing" }));
        const r = await submit(c, unshieldActions(addresses, amount, to));
        setState((s) => ({
          ...s,
          pending: null,
          lastTx: r.ok ? { hash: r.txHash!, label: "withdrawn" } : s.lastTx,
        }));
        if (!r.ok) throw new Error(r.error);
        void refresh();
        return r.txHash!;
      }),
    [addresses, refresh],
  );

  /**
   * Open a position.
   *
   * The secret is generated and written to disk *before* the transaction is offered, not
   * after it lands. A file saved on success is a file that does not exist when the tab is
   * closed at the wrong moment, and the position it would have claimed is then unreachable
   * by anyone.
   */
  const fire = useCallback(
    (marketId: number, bandLow: bigint, bandHigh: bigint, stake: bigint, route?: Route) =>
      queued(async () => {
        const c = connectionRef.current;
        if (!c || !addresses) throw new Error("connect a wallet first");

        // Default to the most private route the wallet can take, and never silently take a
        // less private one than was asked for.
        const available = routesFor(c);
        const chosen = route ?? available[0];
        if (!available.includes(chosen)) {
          throw new Error(
            chosen === "pool"
              ? `${c.walletName} does not expose STRK20 actions, so it cannot open a position through the pool.`
              : "That route is not available with this wallet.",
          );
        }

        const secret: PositionSecret = {
          secret: newSecret(),
          marketId,
          bandLow,
          bandHigh,
        };
        const entry = remember(secret, {
          pair: market.label,
          seconds: ROUND_SECONDS[tier] ?? 0,
          stake,
          route: chosen,
        });
        exportPosition(entry, { network: ADDRESSES.market, contract: addresses.market });

        setState((s) => ({ ...s, pending: "opening" }));
        const r =
          chosen === "pool"
            ? await submit(c, openActions(addresses, secret, stake))
            : await submitDirect(c, openCalls(addresses, secret, stake));
        // A confirmation that times out says nothing about whether the transaction landed,
        // so it must not be allowed to throw past the point where the secret is safe.
        if (r.ok && chosen === "direct") {
          await provider.waitForTransaction(r.txHash!).catch(() => undefined);
        }
        setState((s) => ({
          ...s,
          pending: null,
          lastTx: r.ok ? { hash: r.txHash!, label: "opened" } : s.lastTx,
        }));
        if (!r.ok) {
          /**
           * Only discard the secret when nothing can have been sent.
           *
           * This used to forget unconditionally, and that was the worst bug in the app. A
           * reload, a closed tab or a dropped connection between the wallet accepting the
           * request and the response coming back makes `submitDirect` report failure for a
           * transaction that lands perfectly well — and the secret it deleted was the only
           * thing that could ever have claimed the stake sitting in the contract. Verified
           * in a browser: the position opened on chain and its preimage was erased 1.6
           * seconds later.
           *
           * A refusal before the signature is certain, so that secret is worth nothing and
           * goes. Everything else is kept. A stored secret for a position that never opened
           * costs one row and shows as absent against the chain; a discarded one for a
           * position that did costs the whole stake, permanently, for everyone.
           */
          if (r.maybeSubmitted === false) forget(entry.commitment);
          throw new Error(
            r.maybeSubmitted === false
              ? r.error
              : `${r.error} — your position may still have opened; it is saved and will appear if it did`,
          );
        }
        void refresh();
        return r.txHash!;
      }),
    [addresses, market.label, tier, refresh],
  );

  /**
   * Open a direction ticket against the up/down contract.
   *
   * A separate function from `fire` rather than a branch inside it, because almost nothing is
   * shared: a different contract, a different commitment domain, no band, no route choice —
   * the direction game has no pool leg, so there is only the direct route to offer.
   *
   * The secret is stored before the transaction is sent and kept unless the send is *certain*
   * not to have reached the chain, which is the same rule `fire` learned the hard way: a
   * dropped connection between the wallet accepting and the response arriving makes a
   * successful open look like a failure, and the secret it would have discarded is the only
   * thing that could ever claim the stake.
   */
  const fireDirection = useCallback(
    (roundId: number, direction: "up" | "down", stake: bigint) =>
      queued(async () => {
        const c = connectionRef.current;
        if (!c || !addresses) throw new Error("connect a wallet first");
        if (!ADDRESSES.upDownMarket) {
          throw new Error(`the direction game is not deployed on ${ADDRESSES.name}`);
        }

        const secret: DirectionSecret = { secret: newSecret(), roundId, direction };
        const entry = rememberDirection(secret, {
          pair: market.label,
          seconds: ROUND_SECONDS[tier] ?? 0,
          stake,
        });

        setState((s) => ({ ...s, pending: "opening" }));
        const r = await submitDirect(
          c,
          openDirectionCalls(
            { ...addresses, upDownMarket: ADDRESSES.upDownMarket },
            secret,
            stake,
          ),
        );
        if (r.ok) await provider.waitForTransaction(r.txHash!).catch(() => undefined);
        setState((s) => ({
          ...s,
          pending: null,
          lastTx: r.ok ? { hash: r.txHash!, label: "opened" } : s.lastTx,
        }));
        if (!r.ok) {
          if (r.maybeSubmitted === false) forget(entry.commitment);
          throw new Error(
            r.maybeSubmitted === false
              ? r.error
              : `${r.error} — your ticket may still have opened; it is saved and will appear if it did`,
          );
        }
        void refresh();
        return r.txHash!;
      }),
    [addresses, market.label, tier, refresh],
  );

  /** Claim a settled winning position into an open note the wallet then owns. */
  /**
   * Claim a settled winning position.
   *
   * Which route it goes back out by is not a choice — it is a property of how the position
   * was opened. A pool position has no owner on chain and is claimed into a note by whoever
   * holds the secret; a direct one is bound to the address that opened it and is paid back
   * there. The contract refuses the wrong pairing by name, so the stored route decides.
   */
  const claim = useCallback(
    (p: LivePosition) =>
      queued(async () => {
        const c = connectionRef.current;
        if (!c || !addresses) throw new Error("connect a wallet first");
        setState((s) => ({ ...s, pending: "claiming" }));
        /**
         * Which game first, then which route.
         *
         * A direction ticket is claimed on the other contract entirely, and it has no pool
         * leg yet — so the route question, which is about how a *range* position gets its
         * payout back, does not arise for it.
         */
        const r = isDirection(p)
          ? await submitDirect(
              c,
              claimDirectionCalls({ upDownMarket: ADDRESSES.upDownMarket! }, p),
            )
          : p.route === "direct"
            ? await submitDirect(c, claimCalls(addresses, p))
            : await submit(c, claimActions(addresses, p, c.address));
        if (r.ok && (isDirection(p) || p.route === "direct")) {
          await provider.waitForTransaction(r.txHash!).catch(() => undefined);
        }
        setState((s) => ({
          ...s,
          pending: null,
          lastTx: r.ok ? { hash: r.txHash!, label: "claimed" } : s.lastTx,
        }));
        if (!r.ok) throw new Error(r.error);
        markClaimed(p.commitment, r.txHash!);
        void refresh();
        return r.txHash!;
      }),
    [addresses, refresh],
  );

  /**
   * Settle a market. Permissionless, and a plain public call.
   *
   * Nothing about settlement is private — it reads an oracle and writes a price — so it
   * runs through the ordinary account path rather than the pool. Routing it through the
   * pool would spend an anonymity set on a transaction that reveals nothing.
   */
  const settle = useCallback(
    (marketId: number) =>
      queued(async () => {
        const c = connectionRef.current;
        if (!c || !addresses) throw new Error("connect a wallet first");
        setState((s) => ({ ...s, pending: "settling" }));
        try {
          const { transaction_hash } = await c.account.execute(
            {
              contractAddress: addresses.market,
              entrypoint: "settle",
              calldata: CallData.compile([marketId]),
            },
            NO_TIP,
          );
          await provider.waitForTransaction(transaction_hash);
          setState((s) => ({
            ...s,
            pending: null,
            lastTx: { hash: transaction_hash, label: "settled" },
          }));
          void refresh();
          return transaction_hash;
        } catch (e) {
          setState((s) => ({ ...s, pending: null }));
          throw new Error(errorText(e));
        }
      }),
    [addresses, refresh],
  );

  /** Quote a band against the deployed contract, not a local guess. */
  const quoteOnChain = useCallback(
    async (marketId: number, low: bigint, high: bigint, spot: bigint) => {
      if (!addresses) return null;
      try {
        const r = await provider.callContract({
          contractAddress: addresses.market,
          entrypoint: "quote_band",
          calldata: CallData.compile({
            market_id: marketId,
            spot: { low: spot & ((1n << 128n) - 1n), high: spot >> 128n },
            low: { low: low & ((1n << 128n) - 1n), high: low >> 128n },
            high: { low: high & ((1n << 128n) - 1n), high: high >> 128n },
          }),
        });
        // The multiplier is a u256: two felts, low limb first.
        return (BigInt(r[1]) << 128n) | BigInt(r[0]);
      } catch {
        return null;
      }
    },
    [addresses],
  );

  /**
   * The routes available right now, most private first.
   *
   * The wallet decides whether the pool route is possible; the deployed contract decides
   * whether the direct one is. Both have to agree before a button is offered.
   */
  const routes = useMemo(
    () =>
      routesFor(state.connection).filter((r) => r !== "direct" || state.directRoute !== false),
    [state.connection, state.directRoute],
  );

  /**
   * The reason nothing can be traded, or null.
   *
   * The wallet's own problems first — those are the ones the user can fix. A wallet with no
   * STRK20 support against a pool-only deployment is the one case where both halves are fine
   * and there is still no way in, and it needs saying explicitly rather than as a disabled
   * button.
   */
  const blocked = useMemo(() => {
    if (state.blocked) return state.blocked;
    if (state.connection && routes.length === 0) {
      return `${state.connection.walletName} cannot open a private position, and this deployment of the market has no public route. Connect a STRK20-capable wallet, or wait for the market to be redeployed.`;
    }
    return null;
  }, [state.blocked, state.connection, routes.length]);

  return {
    state: blocked === state.blocked ? state : { ...state, blocked },
    routes,
    routeNote,
    connect,
    connectWithPrivy,
    disconnect,
    shield,
    unshield,
    fire,
    fireDirection,
    claim,
    settle,
    quoteOnChain,
    refresh,
    configured: LIVE_CONFIGURED,
  };
}

