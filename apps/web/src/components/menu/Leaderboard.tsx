"use client";

import { useEffect, useState } from "react";
import { fmtUsd } from "@molfi/sdk";

interface Row {
  address: string;
  pnl: string;
  plays: number;
  wins: number;
}

interface Board {
  configured: boolean;
  rows: Row[];
  error?: string;
}

const MEDAL = ["#f5c518", "#c9d1d9", "#cd7f32"];

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Standings, aggregated from real TicketFired / TicketSettled logs on the deployed
 * market. There is no seeded field of invented players: an empty board means nobody
 * has settled a ticket yet, which is the truth.
 */
export function Leaderboard({ pnl, played }: { pnl: bigint; played: boolean }) {
  const [tab, setTab] = useState<"gainers" | "rekt">("gainers");
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/leaderboard", { cache: "no-store" });
        const j = (await r.json()) as Board;
        if (cancelled) return;
        if (!r.ok) setError(j.error ?? `leaderboard unavailable (${r.status})`);
        setBoard(j);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const all = board?.rows ?? [];
  const rows =
    tab === "gainers"
      ? all.filter((r) => BigInt(r.pnl) > 0n)
      : all.filter((r) => BigInt(r.pnl) < 0n).reverse();

  return (
    <div className="pb-28">
      <div className="flex rounded-full bg-[#161616] p-1">
        {(["gainers", "rekt"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-full py-2.5 text-[12px] font-bold tracking-[0.1em] transition-colors ${
              tab === t
                ? t === "gainers"
                  ? "bg-green-2 text-white"
                  : "bg-red-2 text-white"
                : "text-white/45"
            }`}
          >
            TOP {t === "gainers" ? "GAINERS" : "REKT"}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mt-6 text-center text-[13px] text-red">{error}</p>
      ) : board === null ? (
        <p className="label mt-8 text-center">reading the chain</p>
      ) : !board.configured ? (
        <p className="mt-8 text-center text-[13px] leading-relaxed text-white/45">
          Standings come from settled tickets on the deployed market.
          <br />
          No deployment is configured for this desk.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-8 text-center text-[13px] leading-relaxed text-white/45">
          {tab === "gainers" ? "Nobody is up yet." : "Nobody is down yet."}
          <br />
          Settle a ticket to appear here.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((r, i) => {
            const top3 = tab === "gainers" && i < 3;
            const v = BigInt(r.pnl);
            return (
              <div
                key={r.address}
                className={`flex items-center gap-3 rounded-2xl px-3 py-3 ${
                  top3 ? "bg-[#1b1710] ring-1 ring-amber/25" : "bg-[#141414]"
                }`}
              >
                {!top3 ? (
                  <span className="tnum w-4 text-center text-[12px] text-white/40">{i + 1}</span>
                ) : null}

                <span className="relative">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-[#242424] text-[13px] font-bold">
                    {r.address.slice(2, 4).toUpperCase()}
                  </span>
                  {top3 ? (
                    <span
                      className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-black"
                      style={{ background: MEDAL[i] }}
                    >
                      {i + 1}
                    </span>
                  ) : null}
                </span>

                <div className="min-w-0 flex-1">
                  <div
                    className={`tnum truncate text-[14px] font-bold ${top3 ? "text-amber" : "text-white"}`}
                  >
                    {short(r.address)}
                  </div>
                  <div className="truncate text-[11px] text-white/35">
                    {r.plays} settled · {r.wins} won
                  </div>
                </div>

                <span
                  className={`tnum text-[14px] font-bold ${
                    v < 0n ? "text-red" : i === 0 && tab === "gainers" ? "text-amber" : "text-green"
                  }`}
                >
                  {v < 0n ? "−" : "+"}
                  {fmtUsd(v < 0n ? -v : v)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-[420px] px-4 pb-4">
        <div className="flex items-center gap-3 rounded-2xl bg-[#1b1710] px-3 py-3 ring-1 ring-amber/30 backdrop-blur">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-purple text-[15px] font-bold">
            X
          </span>
          <div className="flex-1">
            <div className="label">Your rank</div>
            <div className="text-[14px] font-bold">
              {played ? (
                <span className={pnl >= 0n ? "text-green" : "text-red"}>
                  {pnl >= 0n ? "+" : "−"}
                  {fmtUsd(pnl < 0n ? -pnl : pnl)} on this desk
                </span>
              ) : (
                "Play a round to rank"
              )}
            </div>
          </div>
          <span className="tnum rounded-lg bg-[#242424] px-3 py-2 text-[13px] font-bold">#--</span>
        </div>
      </div>
    </div>
  );
}
