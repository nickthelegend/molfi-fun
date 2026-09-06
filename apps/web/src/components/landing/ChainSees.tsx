"use client";

import { motion } from "framer-motion";
import { useGsap } from "./useGsap";

/**
 * The argument the whole product rests on, shown rather than claimed.
 *
 * Every prediction market says "private". The only version of that claim worth anything is the
 * bytes: this is the real calldata of a real `open_ticket`, transaction
 * `0x46a766ea…` on Sepolia — four felts, and none of them is the side that was bet. It is not
 * a diagram of what the transaction would look like. It is what it was.
 *
 * Pinned and scrubbed, because the point is a *comparison* and a comparison needs both halves
 * on screen at once, held there long enough to read. The felts light one at a time as the
 * reader scrolls, which paces four facts that would otherwise arrive as one block of hex.
 */

/** The real second call of that multicall: round id, commitment, stake low, stake high. */
const FELTS = [
  { hex: "0x7", what: "round id", note: "which 15-minute round. Public, and has to be." },
  {
    hex: "0x7ff5f363…4dd6064a",
    what: "commitment",
    note: "poseidon(tag, secret, round, side). One-way. The side is inside it and cannot be read out.",
  },
  { hex: "0x4563918244f40000", what: "stake, low limb", note: "5 STRK. The chain must charge you." },
  { hex: "0x0", what: "stake, high limb", note: "The u256's other half." },
];

const HIDDEN = ["which way you bet", "whether you won, until you claim", "your band, on the range game"];

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
          OPEN_TICKET · 0x46A766EA… · SEPOLIA · SUCCEEDED
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
              href="https://sepolia.voyager.online/tx/0x46a766ea4b8d3b1b0c08c87feabffae5364eda1d98febfe2154ee940d4ab7ab"
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
