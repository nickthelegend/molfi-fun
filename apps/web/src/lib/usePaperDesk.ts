"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OracleState } from "@/components/device/OracleStrip";
import {
  MARKETS,
  PaperEngine,
  PaperFeed,
  ROUND_SECONDS,
  type FireResult,
  type MarketDef,
  type PaperTicket,
} from "@molfi/sdk";
import { fetchJson } from "./fetchJson";

export interface PricePoint {
  /** Desk clock, in seconds. */
  at: number;
  price: bigint;
}

const HISTORY = 160;

/**
 * How long a round takes to watch, whatever length it is sold as.
 *
 * molfi's shortest round is fifteen minutes, because that is the shortest thing Pragma can
 * settle honestly. Nobody is going to sit through fifteen real minutes to see whether a demo
 * band held, so the desk clock runs fast and every round takes about this long on the wall
 * clock. The tape is replayed at full resolution either way — only the waiting is compressed,
 * and the screen says so.
 */
const ROUND_WALL_MS = 45_000;

/** How often the desk clock advances. Smooth enough to read as motion, cheap enough to run. */
const TICK_MS = 100;

/**
 * Fetch the market's real price and its recent one-minute tape.
 *
 * The demo desk starts where the market actually is and then replays real returns — no
 * invented starting marks and no bell curve. That matters for honesty, not realism: the
 * multiplier is priced off a distribution measured on this same tape, so a desk driven by a
 * Gaussian walk quotes one probability and delivers another. If the tape cannot be fetched
 * the desk says so rather than making one up.
 */
async function fetchRealTape(
  marketKey: string,
): Promise<{ price: bigint; returns: number[] }> {
  const j = await fetchJson<{
    price?: string | null;
    returns?: number[];
    error?: string;
    markError?: string | null;
  }>(`/api/price?market=${encodeURIComponent(marketKey)}&history=1`);
  // `markError` is the exchange's own reason and is worth more than "price unavailable" —
  // a 451 means the region is geo-blocked, which is a different fix from a 500.
  if (!j.price) {
    // fetchJson has already turned a non-200 or a timeout into a named error, so anything
    // reaching here answered with a body that simply had no price in it.
    throw new Error(j.markError ?? j.error ?? "the price service returned no price");
  }
  if (!j.returns || j.returns.length < 8) throw new Error("no recent tape to replay");
  return { price: BigInt(j.price), returns: j.returns };
}

/** How often the on-chain median is re-read. Pragma publishes far less often than this. */
const ORACLE_POLL_MS = 15_000;

export interface DeskState {
  /** The on-chain median every real position settles against, or null if unread. */
  oracle: OracleState | null;
  oracleError: string | null;
  /** False until a real price has been fetched for this market. */
  ready: boolean;
  /** Non-null when the real price could not be fetched. */
  priceError: string | null;
  market: MarketDef;
  tier: number;
  spot: bigint;
  history: PricePoint[];
  /** Desk clock, in seconds. */
  now: number;
  balance: bigint;
  tickets: PaperTicket[];
  openTickets: PaperTicket[];
  utilisationBps: bigint;
  pnl: bigint;
  lastSettled: PaperTicket | null;
  running: boolean;
}

/**
 * The paper desk. Runs the SDK's PaperEngine — which enforces the same rules the contract
 * does — against a price walk replaying the same measured tape the market prices with.
 */
export function usePaperDesk(initialMarketKey = "BTC") {
  const [marketKey, setMarketKey] = useState(initialMarketKey);
  const [tier, setTier] = useState(0); // 15 minutes, the shortest settleable round
  const [running, setRunning] = useState(true);
  const [, forceRender] = useState(0);

  const market = useMemo(
    () => MARKETS.find((m) => m.key === marketKey) ?? MARKETS[0],
    [marketKey],
  );

  const [oracle, setOracle] = useState<OracleState | null>(null);
  const [oracleError, setOracleError] = useState<string | null>(null);

  const engineRef = useRef<PaperEngine | null>(null);
  const feedRef = useRef<PaperFeed | null>(null);
  const historyRef = useRef<PricePoint[]>([]);
  const lastSettledRef = useRef<PaperTicket | null>(null);
  const [ready, setReady] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);

  if (!engineRef.current) engineRef.current = new PaperEngine();

  // Rebuild the feed when the market changes; the engine (and balance) persists.
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setPriceError(null);
    feedRef.current = null;

    void (async () => {
      try {
        const { price: start, returns } = await fetchRealTape(market.key);
        if (cancelled) return;

        // Start somewhere different each session so two desks are not in lockstep.
        const offset = Math.floor(Math.random() * returns.length);
        const feed = new PaperFeed(market, start, returns, offset);

        /**
         * Fill the backlog BACKWARDS, so the desk opens exactly where the market is.
         *
         * A dead-straight trace reads as broken, so the chart needs history — but
         * walking the feed forward to produce it moved the opening price a hundred and
         * sixty replayed seconds away from the real one. The desk then claimed, in the
         * README and in this file, to "start where the market actually is" while
         * opening about fifteen basis points from it.
         *
         * Running the same real returns in reverse from the fetched price gives a
         * backlog that leads up to it instead of away from it: the trace is just as
         * real, and the price on screen when the desk opens is the price the market is
         * at. The feed itself still starts at that price and steps forward from there.
         */
        const seeded: PricePoint[] = [];
        const back: bigint[] = [];
        let p = Number(start);
        for (let i = 1; i <= HISTORY; i++) {
          const r = returns[((offset - i) % returns.length + returns.length) % returns.length];
          p = p / Math.exp(r);
          back.push(BigInt(Math.max(1, Math.round(p))));
        }
        back.reverse();
        // The backlog is drawn at the same desk-seconds-per-sample the live trace uses,
        // so the two halves of the chart share one time axis.
        const step = ROUND_SECONDS[0] / HISTORY;
        const firstAt = engineRef.current!.now - HISTORY * step;
        back.forEach((price, i) => seeded.push({ at: firstAt + i * step, price }));
        feedRef.current = feed;
        historyRef.current = seeded;
        setReady(true);
        forceRender((n) => n + 1);
      } catch (e) {
        if (!cancelled) setPriceError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [market]);

  /**
   * The on-chain median, polled alongside the demo.
   *
   * Read even on the paper desk, and deliberately so: the whole point of the strip it feeds
   * is that a trader can see the state of the thing that would settle a real position before
   * they take one. Hiding it in demo mode would make the demo teach that the oracle does not
   * matter, which is the opposite of true.
   */
  useEffect(() => {
    let stop = false;
    const read = async () => {
      try {
        const j = await fetchJson<{
          oracle?: OracleState | null;
          oracleError?: string | null;
          error?: string;
        }>(`/api/price?market=${encodeURIComponent(market.key)}`);
        if (stop) return;
        if (j.error) throw new Error(j.error);
        setOracle(j.oracle ?? null);
        setOracleError(j.oracleError ?? null);
      } catch (e) {
        if (!stop) {
          setOracle(null);
          setOracleError((e as Error).message);
        }
      }
    };
    void read();
    const id = setInterval(read, ORACLE_POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [market.key]);

  // The desk clock. Faster than the wall clock, and the rate depends on the round being
  // traded so a four hour band does not take thirty-two times as long to watch as a
  // fifteen minute one.
  const secondsPerTick = useMemo(
    () => (ROUND_SECONDS[tier] ?? ROUND_SECONDS[0]) / (ROUND_WALL_MS / TICK_MS),
    [tier],
  );

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const engine = engineRef.current!;
      const feed = feedRef.current;
      if (!feed) return; // no real price yet — the clock does not run on nothing

      const price = feed.step(secondsPerTick);
      const settled = engine.tick(price, secondsPerTick);
      if (settled.length > 0) lastSettledRef.current = settled[settled.length - 1];

      const h = historyRef.current;
      h.push({ at: engine.now, price });
      if (h.length > HISTORY) h.shift();

      forceRender((n) => n + 1);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running, secondsPerTick]);

  const engine = engineRef.current!;
  const spot = feedRef.current?.price ?? 0n;

  const fire = useCallback(
    (low: bigint, high: bigint, stake: bigint): FireResult => {
      if (spot === 0n) return { ok: false, error: { kind: "bad-band" } };
      const r = engineRef.current!.fire(market, spot, low, high, stake, tier);
      forceRender((n) => n + 1);
      return r;
    },
    [market, spot, tier],
  );

  const stack = useCallback(
    (parentId: number, stake: bigint): FireResult => {
      if (spot === 0n) return { ok: false, error: { kind: "bad-band" } };
      const r = engineRef.current!.stack(market, parentId, spot, stake);
      forceRender((n) => n + 1);
      return r;
    },
    [market, spot],
  );

  const reset = useCallback(() => {
    engineRef.current = new PaperEngine();
    lastSettledRef.current = null;
    forceRender((n) => n + 1);
  }, []);

  const state: DeskState = {
    oracle,
    oracleError,
    ready: ready && feedRef.current !== null,
    priceError,
    market,
    tier,
    spot,
    history: historyRef.current,
    now: engine.now,
    balance: engine.balance,
    tickets: engine.tickets,
    openTickets: engine.openTickets,
    utilisationBps: engine.utilisationBps,
    pnl: engine.pnl,
    lastSettled: lastSettledRef.current,
    running,
  };

  return {
    state,
    engine,
    setMarketKey,
    setTier,
    setRunning,
    fire,
    stack,
    reset,
    roundSeconds: ROUND_SECONDS,
    secondsPerTick,
  };
}
