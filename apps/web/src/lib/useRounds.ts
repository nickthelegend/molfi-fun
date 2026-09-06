"use client";

import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetchJson";

/**
 * The direction game's rounds, polled from the chain.
 *
 * Separate from `useLiveDesk` rather than folded into it. That hook owns a wallet connection,
 * a position store and a price history; a round list needs none of those and is read by the
 * console whether or not anyone has connected. Keeping it apart means the direction game can
 * be shown to somebody who has not signed in — which is the whole reason the round's reference
 * price and multiplier are public in the first place.
 */
export interface Round {
  id: number;
  pair: string;
  cutoffAt: number;
  roundSeconds: number;
  referencePrice: string;
  referenceSources: number;
  multiplierBps: string;
  settledPrice: string;
  settledSources: number;
  isSettled: boolean;
  staked: string;
  bankroll: string;
  reserved: string;
}

interface RoundsResponse {
  network: string;
  contract: string;
  count: number;
  chainNow: number;
  rounds: Round[];
}

export interface RoundsState {
  rounds: Round[];
  /** The one a ticket can still be opened against, or null. */
  open: Round | null;
  chainNow: number | null;
  error: string | null;
  /** Null while the first read is in flight — which is not the same as "none". */
  ready: boolean;
}

const POLL_MS = 8_000;

export function useRounds(pair: string): RoundsState {
  const [state, setState] = useState<RoundsState>({
    rounds: [],
    open: null,
    chainNow: null,
    error: null,
    ready: false,
  });

  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const d = await fetchJson<RoundsResponse>("/api/rounds");
        if (!alive) return;
        const rounds = d.rounds.filter((r) => r.pair === pair);
        /**
         * The round to trade is the open one whose cutoff is furthest away.
         *
         * "Furthest" rather than "first": the keeper lists the next round before the current
         * one expires, so for a moment two are open and the near one is seconds from closing.
         * Offering that one means a ticket bought at the very end of a round it cannot
         * meaningfully predict.
         */
        const open = rounds
          .filter((r) => !r.isSettled && r.cutoffAt > d.chainNow)
          .sort((a, b) => b.cutoffAt - a.cutoffAt)[0] ?? null;
        setState({ rounds, open, chainNow: d.chainNow, error: null, ready: true });
      } catch (e) {
        if (!alive) return;
        // A failed read must not leave stale rounds on screen looking live.
        setState((s) => ({ ...s, error: (e as Error).message, ready: true }));
      }
    };
    void read();
    const id = setInterval(read, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pair]);

  return state;
}
