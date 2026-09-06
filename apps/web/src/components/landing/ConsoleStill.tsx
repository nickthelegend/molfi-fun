"use client";

import { CoinMark } from "@/components/CoinMark";

/**
 * The console, drawn in CSS, for every browser that cannot give us a WebGL context.
 *
 * The 3D hero degrades to this rather than to a sentence. That mattered more than it sounds:
 * this is a page about a handheld, the handheld *is* the argument, and the previous fallback
 * replaced it with the words "this browser could not draw the console" — a hardware page whose
 * hardware is a paragraph. Browsers run out of WebGL contexts on long-lived tabs, block it on
 * low-power modes, and disable it outright behind some privacy settings; none of those readers
 * should get a hole where the product is.
 *
 * It is built from the same `shell` / `recess` / `screen` chrome the real device uses, so it is
 * the product's own surface rather than an illustration of it — the radii, the inset shadows
 * and the amber are one source, and this cannot drift into looking like something molfi does
 * not ship.
 */
export function ConsoleStill({ spot }: { spot: string | null }) {
  return (
    /*
      Sized by its own proportions, not by whatever box it is dropped into.
      
      Without an aspect ratio it took the hero's height and came out tall and narrow — a
      handheld stretched into a remote control. A device has a shape; it is part of what makes
      it read as an object rather than as a panel.
    */
    <div className="mx-auto aspect-[0.66] w-full max-w-[330px] select-none">
      <div className="shell flex h-full flex-col rounded-[30px] p-[9px]">
        <div className="recess flex-1 rounded-[20px] p-[7px]">
          <div className="screen relative h-full overflow-hidden rounded-[14px] px-3 pt-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <CoinMark coin="BTC" size={15} />
                <span className="mono text-[8px] tracking-[0.12em] text-white/45">BTC</span>
              </span>
              <span className="mono text-[7.5px] tracking-[0.14em] text-white/25">SHIELDED</span>
            </div>

            <div className="tnum mt-1 font-display text-[26px] font-bold leading-none text-white">
              {spot ?? <span className="text-white/20">—</span>}
            </div>

            {/*
              A real trace shape rather than a straight line: the eye reads a flat line as a
              dead feed. These are fixed points, and they are decoration on a still — the live
              chart is on the desk, one click away, and it draws from the real history.
            */}
            <svg viewBox="0 0 200 56" className="mt-2 h-[56px] w-full" aria-hidden>
              <path
                d="M0 42 L14 38 L26 44 L38 30 L52 33 L64 22 L78 27 L92 15 L106 21 L120 12 L134 18 L148 9 L162 14 L176 6 L200 10"
                fill="none"
                stroke="var(--color-green)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M0 42 L14 38 L26 44 L38 30 L52 33 L64 22 L78 27 L92 15 L106 21 L120 12 L134 18 L148 9 L162 14 L176 6 L200 10 L200 56 L0 56 Z"
                fill="var(--color-green)"
                opacity="0.09"
              />
            </svg>

            <div className="mt-1 flex items-center justify-between">
              <span className="mono text-[7.5px] tracking-[0.12em] text-dim">EITHER WAY</span>
              <span className="mono text-[7.5px] tracking-[0.12em] text-amber">1.92x</span>
            </div>
          </div>
        </div>

        {/* The deck: the switch, the two side keys, at the proportions the real one uses. */}
        <div className="mt-2 grid h-[38%] shrink-0 grid-cols-[1fr_74px] gap-2">
          <div className="recess rounded-[14px] p-2">
            <div className="screen h-full rounded-[10px] px-2.5 py-2">
              <div className="mono text-[7px] tracking-[0.14em] text-dim">PAYS</div>
              <div className="tnum font-display text-[20px] font-bold leading-none text-amber">
                1.92x
              </div>
              <div className="mt-1.5 flex rounded-[7px] border border-[#171717] bg-[#0b0b0b] p-[2px]">
                <span className="flex-1 rounded-[5px] py-[3px] text-center text-[6.5px] font-extrabold tracking-[0.1em] text-white/35">
                  RANGE
                </span>
                <span className="flex-1 rounded-[5px] bg-amber py-[3px] text-center text-[6.5px] font-extrabold tracking-[0.1em] text-black">
                  UP / DOWN
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="key flex-1 rounded-[11px] bg-green text-center text-[10px] font-extrabold leading-[2.4] text-black">
              ▲ UP
            </div>
            <div className="key flex-1 rounded-[11px] bg-red text-center text-[10px] font-extrabold leading-[2.4] text-white">
              ▼ DOWN
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
