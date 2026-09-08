"use client";

import { motion } from "framer-motion";
import { useGsap } from "./useGsap";

/**
 * The argument the whole product rests on, shown rather than claimed.
 *
 * Every prediction market says "private". The only version of that claim worth anything is the
 * bytes: this is the real calldata of a real `open_position`, transaction `0x6feb9e34…` on
 * Starknet **mainnet** — eight felts, and the band is not among them. It is not a diagram of
 * what the transaction would look like. It is what it was.
 *
 * It used to be a Sepolia `open_ticket`, which was true when the product ran on Sepolia and
 * became a testnet transaction illustrating a mainnet product the day it moved.
 *
 * Pinned and scrubbed, because the point is a *comparison* and a comparison needs both halves
 * on screen at once, held there long enough to read. The felts light one at a time as the
 * reader scrolls, which paces four facts that would otherwise arrive as one block of hex.
 */

/**
 * The real second call of that multicall, felt for felt.
 *
 * The two reach ratios are the interesting ones. They are the band's *width* from its own
 * midpoint with the price divided out, which is exactly what the contract needs to price the
 * position and settle it — and says nothing about where that midpoint was. Two identical
 * numbers here mean a symmetric band; they do not say a symmetric band around what.
 */
const FELTS = [
  { hex: "0xd", what: "market id", note: "market 13. Which round, and it has to be public." },
  {
    hex: "0xf2155993…ad5adf772",
    what: "commitment",
    note: "poseidon(tag, secret, band low, band high). One-way. The band is inside it and cannot be read out.",
  },
  {
    hex: "0x35124",
    what: "low reach ratio",
    note: "217,892 — how far the band reaches below its midpoint, as a fraction of spot. A width, not a place.",
  },
  {
    hex: "0x35124",
    what: "high reach ratio",
    note: "The same going up. Prices the position exactly; locates it nowhere.",
  },
  { hex: "0xde0b6b3a7640000", what: "stake, low limb", note: "1 STRK. The chain must charge you." },
  { hex: "0x0", what: "stake, high limb", note: "The u256's other half." },
];

const HIDDEN = ["the band you actually picked", "the price you were betting around", "whether you won, until you claim"];

export function ChainSees() {
  const scope = useGsap(({ gsap, root }) => {
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: root,
        start: "top top",
        end: "+=1800",
        pin: true,
        scrub: 0.8,
      },
    });

    tl.from("[data-sees=head]", { y: 40, opacity: 0, duration: 0.6 })
      .from("[data-sees=felt]", { x: -30, opacity: 0, duration: 0.5, stagger: 0.5 }, "-=0.2")
      /**
       * The hidden column arrives last and struck through, after the reader has seen exactly
       * how little went on the wire. Reversing that order would give away the answer before
       * the evidence.
       */
      .from("[data-sees=hidden]", { x: 30, opacity: 0, duration: 0.5, stagger: 0.35 }, "-=0.6")
      .from("[data-sees=proof]", { opacity: 0, y: 20, duration: 0.5 });
  });

  return (
    <section
      ref={scope}
      data-sees="root"
      className="relative flex min-h-[100svh] items-center overflow-hidden border-t border-white/5 bg-[#0a0a0b]"
    >
      <div className="mx-auto w-full max-w-[1100px] px-5 py-16">
        <h2
          data-sees="head"
          className="max-w-[20ch] font-display text-[clamp(1.9rem,5vw,3.2rem)] font-extrabold leading-[1.02] tracking-[-0.02em]"
        >
          This is the whole transaction.
        </h2>
        <p className="mono mt-3 text-[10px] tracking-[0.16em] text-white/35">
          OPEN_POSITION · 0x6FEB9E34… · MAINNET · SUCCEEDED
        </p>

        <div className="mt-9 grid gap-8 md:grid-cols-[1.25fr_1fr]">
          <div className="space-y-2.5">
            {FELTS.map((f) => (
              <div
                key={f.hex}
                data-sees="felt"
                className="rounded-[12px] border border-white/6 bg-[#111113] p-3.5"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <code className="mono text-[12.5px] text-amber">{f.hex}</code>
                  <span className="mono shrink-0 text-[9px] tracking-[0.14em] text-white/35">
                    {f.what.toUpperCase()}
                  </span>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-white/40">{f.note}</p>
              </div>
            ))}
          </div>

          <div>
            <span className="mono text-[9.5px] tracking-[0.18em] text-white/30">
              NOT IN IT, ANYWHERE
            </span>
            <ul className="mt-3 space-y-2.5">
              {HIDDEN.map((h) => (
                <li
                  key={h}
                  data-sees="hidden"
                  className="flex items-start gap-2.5 text-[14px] leading-snug text-white/70"
                >
                  <span className="mt-[7px] h-px w-4 shrink-0 bg-red" />
                  <span className="line-through decoration-red/60 decoration-[1.5px]">{h}</span>
                </li>
              ))}
            </ul>

            <motion.a
              data-sees="proof"
              href="https://starkscan.co/tx/0x6feb9e34cdf229dc18bc83708dd9114fbded34ea789a886d62bbabf1e5c396a"
              target="_blank"
              rel="noreferrer noopener"
              whileHover={{ x: 3 }}
              className="mono mt-7 inline-flex items-center gap-2 text-[10px] tracking-[0.14em] text-white/45 underline decoration-white/20 underline-offset-4"
            >
              CHECK IT ON THE EXPLORER →
            </motion.a>
          </div>
        </div>
      </div>
    </section>
  );
}
