"use client";

import { fmtCountdown, fmtPrice, fmtStrk } from "@molfi/sdk";
import type { LiveMarket, LivePosition } from "@/lib/useLiveDesk";

/**
 * The claim the whole product rests on, put next to the thing making it.
 *
 * molfi's pitch is that the chain holds your stake and not your band. Every other surface
 * explains that in prose — a privacy page, a verify page, a paragraph on the landing page —
 * and the one screen where it is actually happening said nothing about it at all.
 *
 * So this is the round as the chain has it, and the position as the chain has it, beside the
 * console that just created both. Two columns, and the interesting part is what is missing
 * from the right one: a commitment, a stake, two width ratios, and no band anywhere.
 *
 * Every value is read from the same live state the console draws from. Where a field is
 * genuinely absent from the chain it is marked absent rather than blanked, because a blank
 * looks like something that failed to load.
 */
export function ChainRail({
  market,
  position,
  now,
  spot,
  dp,
}: {
  market: LiveMarket | null;
  position: LivePosition | null;
  now: number;
  spot: bigint;
  dp: number;
}) {
  return (
    <aside className="hidden w-[300px] shrink-0 flex-col gap-2.5 xl:flex">
      <Panel title="THIS ROUND" note={market ? `#${market.id}` : "NONE OPEN"}>
        {market ? (
          <dl className="flex flex-col gap-1.5 px-2 pb-1">
            <Row k="CLOSES IN" v={fmtCountdown(Math.max(0, market.cutoffAt - now))} />
            <Row k="MARK" v={spot > 0n ? fmtPrice(spot, dp) : "—"} />
            <Row k="HOUSE BANKROLL" v={`${fmtStrk(market.bankroll)} STRK`} />
            <Row k="STAKED INTO IT" v={`${fmtStrk(market.staked)} STRK`} />
            <Row k="RESERVED FOR PAYOUTS" v={`${fmtStrk(market.reserved)} STRK`} />
          </dl>
        ) : (
          <p className="px-2 py-3 text-[11px] leading-relaxed text-white/25">
            The keeper lists a new round before the last one closes. Nothing is open right now.
          </p>
        )}
      </Panel>

      <Panel title="WHAT THE CHAIN SEES" note={position ? "YOUR LAST POSITION" : "NOTHING YET"}>
        {position ? (
          <dl className="flex flex-col gap-1.5 px-2 pb-1">
            <Row k="COMMITMENT" v={`${position.commitment.slice(0, 12)}…`} mono />
            <Row
              k="STAKE"
              v={`${fmtStrk(position.onChain?.stake ?? BigInt(position.stake))} STRK`}
            />
            <Row
              k="MULTIPLIER"
              v={
                position.onChain
                  ? `${(Number(position.onChain.multiplierBps) / 10_000).toFixed(4)}x`
                  : "—"
              }
            />
            <Row k="ROUTE" v={position.route.toUpperCase()} />
            {/*
              Marked beside the word, not struck through it. A line drawn across letterforms
              at this size reads as a rendering fault rather than as "absent", which is the
              opposite of the point being made.
            */}
            <Row k="YOUR BAND" v="NOT STORED" absent />
            <Row k="YOUR NAME" v="NOT STORED" absent />
          </dl>
        ) : (
          <p className="px-2 py-3 text-[11px] leading-relaxed text-white/25">
            Open a position and this fills with exactly what the contract received — which is
            a hash, a size, and two width ratios.
          </p>
        )}
      </Panel>
    </aside>
  );
}

function Row({ k, v, mono, absent }: { k: string; v: string; mono?: boolean; absent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="mono shrink-0 text-[8.5px] tracking-[0.1em] text-white/25">{k}</dt>
      <dd
        className={`truncate text-right text-[11px] ${
          absent
            ? "mono tracking-[0.1em] text-amber/60"
            : mono
              ? "mono tnum text-white/70"
              : "tnum font-semibold text-white/80"
        }`}
      >
        {absent ? `· ${v}` : v}
      </dd>
    </div>
  );
}

function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-white/6 bg-[#111113] p-2.5">
      <header className="flex items-baseline justify-between gap-2 px-2 pb-2">
        <h2 className="mono text-[9px] tracking-[0.18em] text-white/40">{title}</h2>
        {note ? <span className="mono text-[8.5px] tracking-[0.12em] text-white/20">{note}</span> : null}
      </header>
      {children}
    </section>
  );
}
