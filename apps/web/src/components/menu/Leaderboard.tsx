"use client";

import { useEffect, useState } from "react";
import { fmtPrice, fmtStrk, fmtUsd } from "@molfi/sdk";

interface ChainMarket {
  id: number;
  pair: string;
  cutoffAt: number;
  isSettled: boolean;
  settledPrice: string;
  settledAt: number;
  settledSources: number;
  staked: string;
  paid: string;
}

interface Board {
  deployed: boolean;
  reason?: string;
  contract?: string;
  error?: string;
  markets: ChainMarket[];
}

/**
 * The board — of markets, not of people.
 *
 * XORR ranked addresses by profit, aggregated from its own settlement logs. molfi cannot
 * do that and never will: the contract stores a commitment and the pool never tells it who
 * called, so there is no address to attribute a win to. A ranking here would have to be
 * invented, and inventing one would quietly contradict the only claim the product makes.
 *
 * What *is* public, and has to be, is each market's totals: what went in and what came out.
 * Conservation — that a market can never pay more than it took — is only a promise if
 * nobody can check it, so those two numbers are on chain and shown here.
 */
export function Leaderboard({ pnl, played }: { pnl: bigint; played: boolean }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/markets", { cache: "no-store" });
        const j = (await r.json()) as Board;
        if (cancelled) return;
        if (!r.ok && !j.markets) setError(j.error ?? `market list unavailable (${r.status})`);
        setBoard(j);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const settled = (board?.markets ?? []).filter((m) => m.isSettled);
  const open = (board?.markets ?? []).filter((m) => !m.isSettled);

  return (
    <div className="pb-4">
      <div className="rounded-2xl bg-[#161616] p-4">
        <div className="label">Your session</div>
        <div className="tnum mt-1 text-[26px] font-bold leading-none">
          {played ? `${pnl >= 0n ? "+" : "−"}${fmtUsd(pnl < 0n ? -pnl : pnl)}` : "—"}
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-white/45">
          Kept in this browser, because there is nowhere else it could live. molfi has no
          account for it to belong to.
        </p>
      </div>

      <div className="mt-3 rounded-2xl bg-[#2a2010] p-4">
        <p className="text-[13px] leading-relaxed text-amber">
          <span className="font-bold">There is no player ranking, and there cannot be.</span>{" "}
          The chain stores a hash of each position and never learns who opened it, so nobody
          — including molfi — can attribute a win to an address. A table of names here would
          be a table of guesses.
        </p>
      </div>

      {error ? (
        <p className="mono mt-3 text-[11px] text-red">{error}</p>
      ) : !board ? (
        <p className="label mt-3">reading the chain…</p>
      ) : !board.deployed ? (
        <p className="mt-3 text-[13px] leading-relaxed text-white/50">
          {board.reason ?? "No market contract is deployed yet."}
        </p>
      ) : (
        <>
          <Section title="Open markets" markets={open} />
          <Section title="Settled markets" markets={settled} />
          {board.markets.length === 0 ? (
            <p className="mt-3 text-[13px] leading-relaxed text-white/50">
              No markets have been listed yet. An empty board means empty, not hidden.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function Section({ title, markets }: { title: string; markets: ChainMarket[] }) {
  if (markets.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="label">{title}</div>
      <ul className="mt-2 space-y-2">
        {markets.map((m) => {
          const staked = BigInt(m.staked);
          const paid = BigInt(m.paid);
          return (
            <li key={m.id} className="rounded-xl bg-[#161616] p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[14px] font-semibold">
                  {m.pair} <span className="text-white/30">#{m.id}</span>
                </span>
                {m.isSettled ? (
                  <span className="tnum text-[12px] text-white/70">
                    {fmtPrice(BigInt(m.settledPrice), 2)}
                  </span>
                ) : (
                  <span className="mono text-[10px] text-amber">OPEN</span>
                )}
              </div>
              <dl className="mono mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] tracking-wide">
                <Cell k="staked" v={`${fmtStrk(staked, 2)} STRK`} />
                <Cell k="paid" v={`${fmtStrk(paid, 2)} STRK`} />
                {m.isSettled ? (
                  <Cell k="publishers" v={String(m.settledSources)} />
                ) : null}
                {/* The invariant, printed. It is the whole reason these two numbers are
                    public: a market that had paid more than it took would show it here. */}
                <Cell
                  k="solvent"
                  v={paid <= staked ? "yes" : "NO"}
                  tone={paid <= staked ? "text-green" : "text-red"}
                />
              </dl>
              <a
                href={`/m/${m.id}`}
                className="mono mt-2 block text-[10px] tracking-wide text-amber underline"
              >
                recompute this market →
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Cell({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-white/30">{k}</dt>
      <dd className={tone ?? "text-white/70"}>{v}</dd>
    </div>
  );
}
