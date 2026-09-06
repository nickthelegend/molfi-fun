"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useGsap } from "./useGsap";

/**
 * Two games, switched with the real control.
 *
 * This is the deck's own switch, behaving the way it behaves on the device — a pill that
 * travels rather than two labels that swap colour — so what the reader plays with here is what
 * they will press in a minute. Framer Motion's `layoutId` does the travel: one element, two
 * positions, the distance interpolated by the layout engine rather than by a hand-written
 * transform that would have to be kept in step with the widths.
 *
 * The copy under it is the genuine mechanic of each game, including the part that is easy to
 * leave out — that the direction game quotes the *same* price on both sides, which is not a
 * courtesy but the thing that stops the public reserve figure revealing which way a ticket
 * went.
 */

const GAMES = {
  range: {
    label: "RANGE",
    tag: "where it lands",
    head: "Draw a band. Get paid if the price finishes inside it.",
    body: "The price of the bet depends only on how far your band reaches from its own midpoint — a pair of ratios, with the absolute price cancelling out. So the contract can charge you correctly while being told nothing about what you predicted.",
    stat: "1.24×",
    statNote: "typical 15m band",
    accent: "var(--color-amber)",
  },
  direction: {
    label: "UP / DOWN",
    tag: "which way it goes",
    head: "Pick a side. One press, one ticket.",
    body: "A reference price is fixed when the round is listed, and the round settles against the oracle median. The quote is identical both ways — 1.92× up or down — because a different multiplier per side would make the contract's public reserve disclose which way every ticket went.",
    stat: "1.92×",
    statNote: "either side, always",
    accent: "var(--color-green)",
  },
} as const;

type Key = keyof typeof GAMES;

export function Games() {
  const [game, setGame] = useState<Key>("range");
  const g = GAMES[game];

  const scope = useGsap(({ gsap, root }) => {
    gsap.from("[data-games=panel]", {
      y: 60,
      opacity: 0,
      duration: 0.8,
      ease: "power3.out",
      scrollTrigger: { trigger: root, start: "top 72%" },
    });
    // The heading letters lift on a stagger as the section is scrolled into — different
    // choreography from every other section on purpose, because a page where each block
    // arrives the same way stops reading as motion and starts reading as a loading state.
    gsap.from("[data-games=title] span", {
      yPercent: 110,
      duration: 0.7,
      ease: "power4.out",
      stagger: 0.05,
      scrollTrigger: { trigger: root, start: "top 78%" },
    });
  });

  return (
    <section ref={scope} data-games="root" className="border-t border-white/5 px-5 py-24">
      <div className="mx-auto w-full max-w-[900px]">
        <h2
          data-games="title"
          className="font-display text-[clamp(1.9rem,5vw,3.2rem)] font-extrabold leading-[1.02] tracking-[-0.02em]"
        >
          {"Two games.".split(" ").map((w) => (
            <span key={w} className="mr-3 inline-block overflow-hidden">
              <span className="inline-block">{w}</span>
            </span>
          ))}
        </h2>

        {/* The deck's switch, at deck scale. */}
        <div className="mt-7 inline-flex rounded-[14px] border border-[#171717] bg-[#0b0b0b] p-[4px]">
          {(Object.keys(GAMES) as Key[]).map((k) => (
            <button
              key={k}
              onClick={() => setGame(k)}
              aria-pressed={game === k}
              className="relative rounded-[11px] px-6 py-2.5 text-[11px] font-extrabold tracking-[0.1em]"
            >
              {game === k ? (
                <motion.span
                  layoutId="landing-game-pill"
                  className="absolute inset-0 rounded-[11px]"
                  style={{ background: GAMES[k].accent }}
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              ) : null}
              <span className={`relative z-10 ${game === k ? "text-black" : "text-white/40"}`}>
                {GAMES[k].label}
              </span>
            </button>
          ))}
        </div>

        <div data-games="panel" className="mt-7 rounded-[20px] border border-white/6 bg-[#111113] p-7">
          <AnimatePresence mode="wait">
            <motion.div
              key={game}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="grid gap-6 md:grid-cols-[1fr_auto] md:items-start"
            >
              <div className="min-w-0">
                <span className="mono text-[9.5px] tracking-[0.18em] text-white/30">
                  {g.tag.toUpperCase()}
                </span>
                <h3 className="mt-2 text-[21px] font-extrabold leading-snug tracking-tight">
                  {g.head}
                </h3>
                <p className="mt-3 max-w-[58ch] text-[13.5px] leading-relaxed text-white/45">
                  {g.body}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <div
                  className="tnum font-display text-[40px] font-bold leading-none"
                  style={{ color: g.accent }}
                >
                  {g.stat}
                </div>
                <div className="mono mt-1 text-[9px] tracking-[0.12em] text-white/30">
                  {g.statNote.toUpperCase()}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
