"use client";

import { fmtCountdown, fmtPrice, fmtStrk } from "@molfi/sdk";
import type { LiveMarket, LivePosition } from "@/lib/useLiveDesk";
import { CoinMark } from "@/components/CoinMark";

/**
 * What the desk shows in the space the console does not need.
 *
 * The console is a 460-pixel handheld and it is the product's identity, so it does not grow.
 * On a laptop that left roughly seventy per cent of the window as wallpaper — a trading screen
 * whose largest element was a repeating background tile. Filming it made the problem plain:
 * the device could be whole or it could be legible and never both, because a portrait object
 * in a sixteen-by-nine frame is a third of the width at its very best. Cropping in solved the
 * wrong half and cut the device into a strip.
 *
 * So the fix is not to the camera. It is to give the rest of the window something true to
 * hold: the rounds that are actually open with their real countdowns, and the positions
 * actually riding. Both were already fetched for the console and neither was ever shown
 * outside it.
 *
 * Hidden below `xl`, where the handheld alone is already the right shape for the screen.
 */
export function DeskRail({
  pairs,
  markets,
  positions,
  activeKey,
  onPick,
  now,
  network,
  contract,
  explorer,
}: {
  pairs: { key: string; label: string; symbol: string; dp: number }[];
  markets: LiveMarket[];
  positions: LivePosition[];
  activeKey: string;
  onPick: (key: string) => void;
  now: number;
  network: string;
  contract: string | null;
  explorer: string;
}) {
  const openFor = (label: string) =>
    markets
      .filter((m) => m.pair === label && !m.isSettled && m.cutoffAt > now)
      .sort((a, b) => a.cutoffAt - b.cutoffAt)[0] ?? null;

  const riding = positions.filter((p) => p.onChain?.exists && !p.onChain.claimed);
  const settled = positions.filter((p) => p.won !== null);

  return (
    <aside className="hidden w-[300px] shrink-0 flex-col gap-2.5 xl:flex">
      <Panel title="OPEN ROUNDS" note={`${network.toUpperCase()} · LIVE`}>
        <ul className="flex flex-col">
          {pairs.map((p) => {
            const m = openFor(p.label);
            const active = p.key === activeKey;
            return (
              <li key={p.key}>
                <button
                  type="button"
                  onClick={() => onPick(p.key)}
                  aria-label={`Switch the desk to ${p.symbol}`}
                  className={`flex w-full items-center gap-2.5 rounded-[9px] px-2 py-2 text-left transition-colors ${
                    active ? "bg-white/8" : "hover:bg-white/4"
                  }`}
                >
                  <CoinMark coin={p.key} size={18} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-bold leading-none">{p.symbol}</span>
                    <span className="mono mt-1 block text-[8.5px] tracking-[0.1em] text-white/30">
                      {m ? `CLOSES ${fmtCountdown(Math.max(0, m.cutoffAt - now))}` : "NO OPEN ROUND"}
                    </span>
                  </span>
                  {m ? (
                    <span className="mono tnum shrink-0 text-[10.5px] text-white/45">
                      {fmtStrk(m.bankroll)}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="RIDING" note={riding.length ? `${riding.length} OPEN` : "NOTHING YET"}>
        {riding.length === 0 ? (
          <p className="px-2 py-3 text-[11px] leading-relaxed text-white/25">
            Positions you open show here while they run. The band stays sealed until you claim.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {riding.slice(0, 5).map((p) => (
              <li key={p.commitment} className="rounded-[9px] bg-white/4 px-2 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] font-bold">{p.pair.split("/")[0]}</span>
                  <span className="mono tnum text-[10.5px] text-amber">
                    {fmtStrk(p.onChain?.stake ?? 0n)}
                  </span>
                </div>
                <div className="mono mt-1 truncate text-[8.5px] tracking-[0.08em] text-white/25">
                  {p.commitment.slice(0, 14)}…
                </div>
                <div className="mono mt-0.5 text-[8.5px] tracking-[0.1em] text-emerald-400/50">
                  BAND SEALED
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {settled.length > 0 ? (
        <Panel title="SETTLED" note={`${settled.length}`}>
          <ul className="flex flex-col gap-1">
            {settled.slice(0, 4).map((p) => (
              <li
                key={p.commitment}
                className="flex items-center justify-between gap-2 rounded-[9px] bg-white/4 px-2 py-1.5"
              >
                <span className="text-[11.5px] font-semibold">{p.pair.split("/")[0]}</span>
                <span
                  className={`mono text-[9px] tracking-[0.12em] ${
                    p.won ? "text-emerald-400/70" : "text-white/30"
                  }`}
                >
                  {p.won ? "INSIDE" : "OUTSIDE"}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {contract ? (
        <a
          href={`${explorer}/contract/${contract}`}
          target="_blank"
          rel="noreferrer"
          className="mono truncate rounded-[12px] border border-white/6 bg-[#111113] px-3 py-2.5 text-[9px] tracking-[0.12em] text-white/30 transition-colors hover:border-white/16 hover:text-white/60"
        >
          {contract.slice(0, 20)}… ↗
        </a>
      ) : null}
    </aside>
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
