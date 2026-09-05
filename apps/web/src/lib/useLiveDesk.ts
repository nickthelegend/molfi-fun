"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CallData } from "starknet";
import { MARKETS, ROUND_SECONDS, newSecret, type MarketDef, type PositionSecret } from "@molfi/sdk";
import { ADDRESSES, LIVE_CONFIGURED, liveBlockedReason, provider } from "./chain";
import {
  blockingReason,
  connectTo,
  reconnect,
  shieldedBalances,
  type Connection,
  type StarknetWallet,
} from "./wallet";
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
  markClaimed,
  remember,
  subscribe,
  type StoredPosition,
} from "./positions";
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

/** A stored position, joined with whatever the chain says about it. */
export interface LivePosition extends StoredPosition {
  onChain: {
    exists: boolean;
    claimed: boolean;
    stake: bigint;
    multiplierBps: bigint;
  } | null;
  market: LiveMarket | null;
  /** True when the market has settled and the settled price landed inside the band. */
  won: boolean | null;
}

export interface LiveState {
  ready: boolean;
  /** Why the live desk cannot be used at all, or null. Not an error — a configuration fact. */
  unavailable: string | null;
  error: string | null;
  connection: Connection | null;
  /** Why the connected wallet cannot act, or null. */
  blocked: string | null;
  wallets: StarknetWallet[];
  /** Shielded STRK, as the wallet reports it. molfi never holds a key to check. */
  shielded: bigint | null;
  markets: LiveMarket[];
  positions: LivePosition[];
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
  wallets: [],
  shielded: null,
  markets: [],
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
        const c = await reconnect(w);
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

  // ---- the markets the contract holds
  const refresh = useCallback(async () => {
    if (!addresses) return;
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
      const res = await fetch("/api/markets", { cache: "no-store" });
      if (!res.ok) throw new Error(`market list unavailable (${res.status})`);
      const body = (await res.json()) as {
        deployed?: boolean;
        reason?: string;
        error?: string;
        markets?: Array<Record<string, string | number | boolean>>;
      };
      if (body.error) throw new Error(body.error);

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

      const now = Math.floor(Date.now() / 1000);
      const dueMarkets = markets.filter((m) => !m.isSettled && m.cutoffAt <= now);

      // Positions are looked up by commitment, which is public and says nothing about who
      // is asking. This is the only read that could ever link a viewer to a position, and
      // it is a plain `starknet_call` from whatever node the browser is using.
      const positions: LivePosition[] = await Promise.all(
        allPositions().map(async (p) => {
          const m = markets.find((x) => x.id === p.marketId) ?? null;
          let onChain: LivePosition["onChain"] = null;
          try {
            // Through the app's own route, like the market list. It decodes the struct in
            // one place — a u256 is two felts and a u128 is one, and a second copy of those
            // offsets is a second thing to get wrong.
            const r = await fetch(`/api/position/${p.commitment}`, { cache: "no-store" });
            const body = (await r.json()) as {
              exists?: boolean;
              position?: {
                stake: string;
                multiplierBps: string;
                claimed: boolean;
                exists: boolean;
              };
            };
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
          const won =
            m?.isSettled && m.settledPrice > 0n
              ? m.settledPrice > p.bandLow && m.settledPrice < p.bandHigh
              : null;
          return { ...p, onChain, market: m, won };
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
        error: null,
        markets,
        dueMarkets,
        positions,
        shielded,
      }));
    } catch (e) {
      setState((s) => ({ ...s, error: errorText(e) }));
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
        const r = await fetch(
          `/api/price?market=${encodeURIComponent(market.key)}&history=1`,
          { cache: "no-store" },
        );
        const j = (await r.json()) as { price?: string | null; returns?: number[] };
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
    const read = async () => {
      try {
        const r = await fetch(`/api/price?market=${encodeURIComponent(market.key)}`, {
          cache: "no-store",
        });
        const j = (await r.json()) as {
          price?: string | null;
          error?: string;
          markError?: string | null;
        };
        if (stop) return;
        if (!r.ok || !j.price) {
          throw new Error(j.markError ?? j.error ?? `price service ${r.status}`);
        }
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
      const c = await connectTo(wallet);
      connectionRef.current = c;
      setState((s) => ({ ...s, connection: c, blocked: blockingReason(c), error: null }));
      void refresh();
      return c;
    } catch (e) {
      setState((s) => ({ ...s, error: errorText(e) }));
      throw e;
    }
  }, [refresh]);

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
    (marketId: number, bandLow: bigint, bandHigh: bigint, stake: bigint) =>
      queued(async () => {
        const c = connectionRef.current;
        if (!c || !addresses) throw new Error("connect a wallet first");

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
        });
        exportPosition(entry, { network: ADDRESSES.market, contract: addresses.market });

        setState((s) => ({ ...s, pending: "opening" }));
        const r = await submit(c, openActions(addresses, secret, stake));
        setState((s) => ({
          ...s,
          pending: null,
          lastTx: r.ok ? { hash: r.txHash!, label: "opened" } : s.lastTx,
        }));
        if (!r.ok) throw new Error(r.error);
        void refresh();
        return r.txHash!;
      }),
    [addresses, market.label, tier, refresh],
  );

  /** Claim a settled winning position into an open note the wallet then owns. */
  const claim = useCallback(
    (p: LivePosition) =>
      queued(async () => {
        const c = connectionRef.current;
        if (!c || !addresses) throw new Error("connect a wallet first");
        setState((s) => ({ ...s, pending: "claiming" }));
        const r = await submit(c, claimActions(addresses, p, c.address));
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
          const { transaction_hash } = await c.account.execute({
            contractAddress: addresses.market,
            entrypoint: "settle",
            calldata: CallData.compile([marketId]),
          });
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

  return {
    state,
    connect,
    disconnect,
    shield,
    unshield,
    fire,
    claim,
    settle,
    quoteOnChain,
    refresh,
    configured: LIVE_CONFIGURED,
  };
}

