"use client";

import { useState } from "react";
import { fmtPrice, fmtStrk } from "@molfi/sdk";
import Link from "next/link";
import { fetchJson } from "@/lib/fetchJson";

/**
 * What the chain hands an observer, for one position, side by side with what it withholds.
 *
 * The verifier elsewhere in this app checks a *market*. This checks a *position*, which is
 * the thing a trader actually wants to know about — and it is the only page that answers the
 * question the whole product turns on by showing the answer rather than describing it.
 *
 * Deliberately takes a commitment typed in rather than one this browser owns. A page that
 * can only inspect your own positions proves nothing about what a stranger can see; a page
 * that inspects any commitment, from any browser, with no wallet, is the demonstration.
 *
 * Every field comes from `get_position` on the deployed contract through `/api/position`.
 * Nothing here is computed from what molfi remembers locally.
 */
type Answer = {
  exists: boolean;
  commitment: string;
  contract: string;
  network: string;
  position?: {
    marketId: number;
    stake: string;
    multiplierBps: string;
    claimed: boolean;
    lowOff1e8?: string;
    highOff1e8?: string;
    bandLow?: string;
    bandHigh?: string;
    owner?: string;
  };
  market?: { pair: string; isSettled: boolean; settledPrice: string } | null;
  won?: boolean | null;
};

function Cell({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[#171717] py-2 last:border-0">
      <dt className="mono shrink-0 text-[10px] tracking-[0.1em] text-dim">{k}</dt>
      <dd className={`mono tnum truncate text-right text-[11px] ${tone ?? "text-white/80"}`}>{v}</dd>
    </div>
  );
}

export function Observer({ bandOnChain }: { bandOnChain: boolean | null }) {
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const look = async () => {
    const c = input.trim();
    if (!c) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      setAnswer(await fetchJson<Answer>(`/api/position/${encodeURIComponent(c)}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const p = answer?.position;

  return (
    <section className="mt-3 rounded-[22px] bg-card p-6">
      <div className="label">the observer&rsquo;s view</div>
      <h2 className="mt-2 text-[18px] font-extrabold leading-snug">
        Look up any position. You do not need to own it.
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-white/55">
        A commitment is public — it is an indexed key on every{" "}
        <code className="text-white/70">PositionOpened</code> event. Paste one and this reads{" "}
        <code className="text-white/70">get_position</code> straight off the deployed contract,
        with no wallet and nothing of molfi&rsquo;s in between, and shows you exactly what a
        stranger watching the chain can and cannot learn.
      </p>

      <div className="mt-4 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void look()}
          placeholder="0x… a position commitment"
          spellCheck={false}
          className="mono min-w-0 flex-1 rounded-xl bg-[#0d0d0d] px-3 py-2.5 text-[11px] text-white outline-none ring-1 ring-white/8 focus:ring-amber/60"
        />
        <button
          onClick={() => void look()}
          disabled={busy || !input.trim()}
          className="rounded-xl bg-amber-2 px-4 py-2.5 text-[13px] font-extrabold text-black disabled:opacity-40"
        >
          {busy ? "READING" : "LOOK"}
        </button>
      </div>

      {error ? (
        <p className="mono mt-3 text-[11px] leading-relaxed text-red">{error}</p>
      ) : null}

      {answer && !answer.exists ? (
        <p className="mt-4 text-[13px] leading-relaxed text-white/55">
          No position on this contract carries that commitment. That is a real answer, not an
          error — the contract stores positions by commitment and knows nothing else about
          them, so &ldquo;never opened&rdquo; and &ldquo;not yours&rdquo; look identical from
          outside, which is the point.
        </p>
      ) : null}

      {answer?.exists && p ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-[#131313] p-4">
            <div className="mono text-[9.5px] tracking-[0.15em] text-red">
              WHAT THE CHAIN REVEALS
            </div>
            <dl className="mt-2">
              <Cell k="market" v={`#${p.marketId}${answer.market ? ` · ${answer.market.pair}` : ""}`} />
              {/* Formatted, not raw. This printed `2000000000000000000` on a page whose whole
                  argument is that a stranger can read the chain for themselves — and the first
                  thing it showed them was eighteen decimals of unlabelled integer. */}
              <Cell k="stake" v={`${fmtStrk(BigInt(p.stake))} STRK`} />
              <Cell k="multiplier" v={`${(Number(p.multiplierBps) / 10_000).toFixed(4)}x`} />
              <Cell k="claimed" v={p.claimed ? "yes" : "not yet"} />
              {p.owner && BigInt(p.owner) !== 0n ? (
                <Cell k="owner" v={p.owner} tone="text-red" />
              ) : null}
              {p.lowOff1e8 ? <Cell k="reach down" v={`${p.lowOff1e8} / 1e8`} /> : null}
              {p.highOff1e8 ? <Cell k="reach up" v={`${p.highOff1e8} / 1e8`} /> : null}
              {/* Prices, so they are shown as prices. These only appear at all on a class that
                  stores the band in the clear — the leak this page exists to make visible — and
                  a leak is easier to recognise when it is legible. */}
              {p.bandLow ? <Cell k="band low" v={fmtPrice(BigInt(p.bandLow))} tone="text-red" /> : null}
              {p.bandHigh ? <Cell k="band high" v={fmtPrice(BigInt(p.bandHigh))} tone="text-red" /> : null}
            </dl>
          </div>

          <div className="rounded-xl bg-[#131313] p-4">
            <div className="mono text-[9.5px] tracking-[0.15em] text-green">
              WHAT IT CANNOT
            </div>
            <ul className="mt-2 space-y-2 text-[12px] leading-relaxed text-white/55">
              {bandOnChain ? null : (
                <li>
                  <span className="text-white/80">The band.</span> Only how far it reaches from
                  its own midpoint, with the price divided out — enough to charge the right
                  price, and nothing about what it predicts.
                </li>
              )}
              {p.owner && BigInt(p.owner) !== 0n ? null : (
                <li>
                  <span className="text-white/80">Whose it is.</span> Opened through the pool,
                  so the contract recorded no address at all. The secret is the only
                  credential.
                </li>
              )}
              <li>
                <span className="text-white/80">Whether it is one of several.</span> Nothing
                links two commitments to one holder.
              </li>
              {bandOnChain ? (
                <li className="text-red">
                  The band is <em>not</em> in this column on the class deployed here — it is in
                  the other one. See the banner above.
                </li>
              ) : null}
            </ul>
          </div>
        </div>
      ) : null}

      {answer?.exists ? (
        <p className="mono mt-3 text-[10px] leading-relaxed tracking-wide text-white/30">
          READ FROM {answer.contract} ON STARKNET {answer.network.toUpperCase()} ·{" "}
          <Link href={`/m/${p?.marketId}`} className="text-amber underline">
            recompute market #{p?.marketId}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
