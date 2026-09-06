"use client";

import { MARKETS, fmtCountdown, fmtMultiplier, fmtPrice, fmtUsd } from "@molfi/sdk";
import type { PaperTicket } from "@molfi/sdk";

/**
 * The second screen inside the glass: what is riding, and what has settled.
 *
 * Three things here were bugs before they were rules, so they are built in rather than
 * checked for afterwards:
 *
 *   · the glass is one fixed height for every screen, or the device changes size when you
 *     switch — a handheld that grows a centimetre on a tab change is not a handheld;
 *   · the flexing region is the scrolling one, and its empty state centres in the space it
 *     actually occupies rather than at the top of it;
 *   · session P&L sums settled positions only. Differencing the balance reports a loss the
 *     instant a position is opened, because the stake is escrowed — while the count beside
 *     it still, correctly, says nothing has settled.
 *
 * A position is formatted with *its own* market's decimals. The switcher makes changing
 * market the easy path, and a band printed at the wrong precision is a different band.
 */
export function Positions({
  open,
  settled,
  now,
  demoClock,
  session,
}: {
  open: PaperTicket[];
  settled: PaperTicket[];
  /** Desk clock, in seconds. */
  now: number;
  /** Paper rounds compress every cutoff so the loop is visible; live ones do not. */
  demoClock: boolean;
  session: { pnl: bigint; n: number };
}) {
  const dpOf = (key: string) => MARKETS.find((m) => m.key === key)?.dp ?? 2;
  const symbolOf = (key: string) => MARKETS.find((m) => m.key === key)?.symbol ?? key;

  return (
    <div className="flex h-full flex-col px-[11px] pb-[9px] pt-[11px]">
      <div className="mono flex items-baseline justify-between text-[9.5px] tracking-[0.15em] text-dim">
        <span>OPEN POSITIONS</span>
        <span>SEALED UNTIL CUTOFF</span>
      </div>

      <div className="mt-[9px] flex flex-col gap-1.5">
        {open.length === 0 ? (
          <div className="mono px-2.5 py-[26px] text-center text-[10px] tracking-[0.14em] text-dim">
            NOTHING RIDING · FIRE A BAND
          </div>
        ) : (
          open.map((t, i) => {
            const dp = dpOf(t.marketKey);
            return (
              <div
                key={t.id}
                className="flex items-center gap-2.5 rounded-[11px] border border-[#1b1b1b] bg-screen-3 px-2.5 py-[9px]"
                style={{ borderLeft: "3px solid var(--color-amber)" }}
              >
                <span className="mono tnum text-[10px] text-dim">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="mono tnum truncate text-[11px] text-white">
                    {symbolOf(t.marketKey)} {fmtPrice(t.low, dp)} – {fmtPrice(t.high, dp)}
                  </div>
                  <div className="mono mt-0.5 text-[9px] tracking-[0.1em] text-dim">
                    {fmtUsd(t.stake)} · {fmtMultiplier(t.multiplierBps)}
                  </div>
                </div>
                <span className="text-right">
                  <span className="mono tnum block text-[12px] font-semibold text-amber">
                    {fmtCountdown(Math.max(0, t.expiresAt - now))}
                  </span>
                  {demoClock ? (
                    <span className="mono block text-[9.5px] tracking-[0.13em] text-dim">
                      DEMO CLOCK
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="mono mt-3.5 flex items-baseline justify-between text-[9.5px] tracking-[0.15em] text-dim">
        <span>SETTLED</span>
        <span>PUBLISHED · RECHECKABLE</span>
      </div>

      {/* The one region that flexes, so it is the one that scrolls. */}
      <div className="mt-[9px] flex min-h-0 flex-1 flex-col justify-center gap-px overflow-y-auto">
        {settled.length === 0 ? (
          <div className="mono py-4 text-center text-[10px] tracking-[0.14em] text-dim">
            NO TAPE YET
          </div>
        ) : (
          settled.map((t) => {
            const won = t.status === "won";
            const dp = dpOf(t.marketKey);
            return (
              <div
                key={t.id}
                className="flex items-center gap-2.5 bg-[#080808] px-2.5 py-[5px]"
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-[1px]"
                  style={{ background: won ? "var(--color-green)" : "var(--color-red)" }}
                />
                <span className="mono tnum min-w-0 flex-1 truncate text-[10px] text-dim">
                  {symbolOf(t.marketKey)}{" "}
                  {t.settledPrice === null ? "—" : fmtPrice(t.settledPrice, dp)}
                </span>
                <span
                  className={`mono tnum text-[10px] ${won ? "text-green" : "text-red"}`}
                >
                  {won ? "+" : "−"}
                  {fmtUsd(won ? t.payout - t.stake : t.stake)}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="mono mt-2 flex items-baseline justify-between border-t border-[#161616] pt-2 text-[9.5px] tracking-[0.15em] text-dim">
        <span>SESSION</span>
        <span className="tnum flex items-baseline gap-2.5">
          <span className="text-[10.5px]">
            {session.n} SETTLED
          </span>
          <span
            className={`text-[13px] font-semibold ${session.pnl >= 0n ? "text-green" : "text-red"}`}
          >
            {session.pnl >= 0n ? "+" : "−"}
            {fmtUsd(session.pnl < 0n ? -session.pnl : session.pnl)}
          </span>
        </span>
      </div>
    </div>
  );
}
