"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useGsap } from "./useGsap";

/**
 * The last thing on the page, and the only thing it asks for.
 *
 * One key, at the size of the key on the device, because the whole page has been about a
 * handheld and the last gesture should feel like pressing it. The line under it is the honest
 * version of the offer: molfi pays for the first account, and the money is testnet — saying so
 * here rather than after the click is the difference between a demo and a bait.
 */
export function CTA() {
  const scope = useGsap(({ gsap, root }) => {
    gsap.from("[data-cta=key]", {
      scale: 0.8,
      opacity: 0,
      duration: 0.8,
      ease: "back.out(1.6)",
      scrollTrigger: { trigger: root, start: "top 80%" },
    });
    gsap.to("[data-cta=halo]", {
      opacity: 0.5,
      scale: 1.15,
      ease: "none",
      scrollTrigger: {
        trigger: root,
        start: "top bottom",
        end: "bottom bottom",
        scrub: 1,
      },
    });
  });

  return (
    <section
      ref={scope}
      data-cta="root"
      className="relative overflow-hidden border-t border-white/5 px-5 py-28 text-center"
    >
      <div
        aria-hidden
        data-cta="halo"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20"
        style={{
          background:
            "radial-gradient(circle, rgba(255,159,10,0.28) 0%, rgba(255,159,10,0.06) 45%, transparent 70%)",
        }}
      />
      <div className="relative mx-auto max-w-[640px]">
        <h2 className="font-display text-[clamp(2rem,6vw,3.4rem)] font-extrabold leading-[1] tracking-[-0.02em]">
          Take a position nobody can see.
        </h2>
        <div data-cta="key" className="mt-8 inline-block">
          <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
            <Link
              href="/play"
              className="key block rounded-full bg-amber-2 px-12 py-5 text-[16px] font-extrabold tracking-tight text-black"
            >
              PLAY THE GAME
            </Link>
          </motion.div>
        </div>
        <p className="mono mt-5 text-[9.5px] leading-relaxed tracking-[0.14em] text-white/30">
          SEPOLIA TESTNET · MOLFI FUNDS YOUR FIRST ACCOUNT · NO EXTENSION, NO SEED PHRASE
        </p>
      </div>
    </section>
  );
}
