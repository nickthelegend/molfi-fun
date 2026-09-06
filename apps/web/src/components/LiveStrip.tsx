"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtCountdown } from "@molfi/sdk";
import { fetchJson } from "@/lib/fetchJson";

/**
 * The front page, saying what the chain is doing right now.
 *
 * A landing page that only makes claims is asking to be taken on trust, and this project's
 * entire argument is that you should not have to. Three facts, all read from the deployed
 * contract: how many rounds have settled, when the last one did, and when the next one
 * closes. If a judge reads nothing else, they have seen that it runs.
 *
 * Deliberately a client component. Reading the chain server-side put fifteen seconds of node
 * latency in front of the first paint of the most important page in the app; the strip
 * arrives a moment late instead, and reserves its own height so nothing under it jumps.
 */
type Market = {
  id: number;
  pair: string;
  isSettled: boolean;
  cutoffAt: number;
  settledAt: number;
};

type MarketsResponse = { markets: Market[]; count: number; chainNow: number };

const ago = (seconds: number): string => {
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))}s ago`;
  if (seconds < 5_400) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 172_800) return `${Math.round(seconds / 3_600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
};

export function LiveStrip() {
  const [data, setData] = useState<MarketsResponse | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const read = () =>
      fetchJson<MarketsResponse>("/api/markets")
        .then((d) => alive && (setData(d), setFailed(null)))
        .catch((e: Error) => alive && setFailed(e.message));
    void read();
    const poll = setInterval(read, 30_000);
    // The countdown has to move between reads or it reads as a screenshot.
    const clock = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, []);

  // Interpolated from the chain's own clock, not the browser's: block time is what the
  // contract compares a cutoff against, and the two drift.
  const now = data ? data.chainNow + tick : 0;
  const settled = data ? data.markets.filter((m) => m.isSettled) : [];
  const open = data ? data.markets.filter((m) => !m.isSettled && m.cutoffAt > now) : [];
  const last = settled.reduce<Market | null>(
    (best, m) => (!best || m.settledAt > best.settledAt ? m : best),
    null,
  );
  const next = open.reduce<Market | null>(
    (best, m) => (!best || m.cutoffAt < best.cutoffAt ? m : best),
    null,
  );

  return (
    <Link
      href="/play"
      className="mono mt-5 flex h-[30px] items-center justify-center gap-2 rounded-lg bg-[#141414] px-3 text-[9px] leading-none tracking-[0.1em] text-white/40 transition-colors hover:bg-[#1b1b1b] hover:text-white/60"
    >
      {failed || !data ? (
        /**
         * A failed read wins over the numbers, even after a good one.
         *
         * This used to be `!data`, so the error only ever appeared if the *first* read
         * failed. Once one had succeeded the strip kept painting those numbers for as long
         * as the route stayed down — a settlement age counting up from a chain nobody could
         * read any more, on the one line of this page whose whole job is to say that molfi
         * is running. Stale is not live, and a strip that cannot tell the difference is
         * worse than one that says nothing.
         */
        <span className="text-white/25">{failed ? failed.toUpperCase() : "READING SEPOLIA…"}</span>
      ) : (
        <>
          <span className="relative flex h-1.5 w-1.5">
            {/* Only a real open round pulses. A dot that always breathes says nothing. */}
            {next ? (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-60" />
            ) : null}
            <span
              className={`relative inline-flex h-1.5 w-1.5 rounded-full ${next ? "bg-green" : "bg-white/25"}`}
            />
          </span>
          <span className="text-white/60">{data.count}</span>
          <span>ROUNDS</span>
          {last ? (
            <>
              <span className="text-white/15">·</span>
              <span>LAST {last.pair.replace("/USD", "")}</span>
              <span className="text-white/60">{ago(now - last.settledAt).toUpperCase()}</span>
            </>
          ) : null}
          <span className="text-white/15">·</span>
          {next ? (
            <>
              <span>CLOSES</span>
              <span className="tnum text-green">{fmtCountdown(next.cutoffAt - now)}</span>
            </>
          ) : (
            <span>NEXT ROUND PENDING</span>
          )}
        </>
      )}
    </Link>
  );
}
