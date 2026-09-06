"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { fetchJson } from "@/lib/fetchJson";
import { useGsap } from "./useGsap";

/**
 * The numbers that decide whether any of the above is true, read from the chain.
 *
 * Nothing here is authored. Markets and rounds come from the contracts; the keeper figures come
 * from the keeper's own health endpoint, which is a separate process on separate infrastructure
 * that this page cannot influence. If the keeper is down, this section says a smaller number —
 * which is the point of putting it on the front page rather than a status page nobody opens.
 */

function useCounted(target: number | null, inView: boolean) {
  const mv = useMotionValue(0);
  // A spring rather than a linear tween: a number that eases into place reads as a value
  // settling, where a linear ramp reads as a progress bar that happens to contain digits.
  const spring = useSpring(mv, { stiffness: 90, damping: 22, mass: 0.6 });
  const text = useTransform(spring, (v) => Math.round(v).toLocaleString("en-US"));
  useEffect(() => {
    if (inView && target !== null) mv.set(target);
  }, [inView, target, mv]);
  return text;
}

function Stat({
  value,
  label,
  note,
  inView,
}: {
  value: number | null;
  label: string;
  note: string;
  inView: boolean;
}) {
  const text = useCounted(value, inView);
  return (
    <div data-proof="stat" className="rounded-[16px] border border-white/6 bg-[#111113] p-5">
      <div className="tnum font-display text-[clamp(2rem,6vw,3rem)] font-bold leading-none text-amber">
        {value === null ? <span className="text-white/15">—</span> : <motion.span>{text}</motion.span>}
      </div>
      <div className="mt-2 text-[13px] font-semibold">{label}</div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-white/35">{note}</p>
    </div>
  );
}

export function Proof() {
  const ref = useRef<HTMLDivElement>(null);
  /**
   * A plain IntersectionObserver, because the counters have to be certain to fire.
   *
   * `useInView` was returning false here and the three numbers sat at 0 on a section whose
   * data had already been fetched and was correct — the worst kind of failure on a page whose
   * whole point is "these numbers are real", because it reads as "this has never run". Rather
   * than keep guessing at which option shape the hook wants, this observes the element
   * directly: it is four lines, it has no version-dependent option parsing, and I can see
   * exactly when it fires.
   */
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect(); // Once. A number that re-counts every scroll-by is a distraction.
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const [markets, setMarkets] = useState<number | null>(null);
  const [settled, setSettled] = useState<number | null>(null);
  const [relayed, setRelayed] = useState<number | null>(null);

  useEffect(() => {
    void fetchJson<{ count?: number; markets?: { isSettled: boolean }[] }>("/api/markets")
      .then((d) => {
        setMarkets(d.count ?? d.markets?.length ?? null);
        setSettled(d.markets?.filter((m) => m.isSettled).length ?? null);
      })
      .catch(() => undefined);
    void fetchJson<{ relayed?: number; ledger?: { relay?: { ok?: number } } }>("/api/keeper")
      .then((d) => setRelayed(d.ledger?.relay?.ok ?? d.relayed ?? null))
      .catch(() => undefined);
  }, []);

  const scope = useGsap(({ gsap, root }) => {
    // A horizontal drift as the section passes, so the three cards are not a static row —
    // small, because they are numbers and numbers have to stay readable while they move.
    gsap.from("[data-proof=stat]", {
      x: (i) => (i - 1) * 40,
      opacity: 0,
      duration: 0.7,
      ease: "power3.out",
      stagger: 0.08,
      scrollTrigger: { trigger: root, start: "top 76%" },
    });
  });

  return (
    <section ref={scope} data-proof="root" className="border-t border-white/5 px-5 py-24">
      <div ref={ref} className="mx-auto w-full max-w-[1000px]">
        <h2 className="max-w-[22ch] font-display text-[clamp(1.9rem,5vw,3.2rem)] font-extrabold leading-[1.02] tracking-[-0.02em]">
          It has been running without me.
        </h2>
        <p className="mt-3 max-w-[52ch] text-[14px] leading-relaxed text-white/45">
          A keeper lists the rounds, relays the prices and settles what is due, on a loop, on its
          own infrastructure. These numbers are read from the chain and from that process when
          you load this page.
        </p>

        <div className="mt-9 grid gap-2.5 sm:grid-cols-3">
          <Stat
            value={markets}
            label="markets listed"
            note="Every one created by the keeper, priced against a published table."
            inView={inView}
          />
          <Stat
            value={settled}
            label="settled in the recent window"
            note="Settlement is permissionless — anyone can poke an expired market."
            inView={inView}
          />
          <Stat
            value={relayed}
            label="prices relayed"
            note="Each one a signed transaction carrying its own publisher count."
            inView={inView}
          />
        </div>

        <div className="mt-6 flex flex-wrap gap-2.5">
          {[
            { href: "/keeper", label: "who settles these" },
            { href: "/privacy", label: "what leaks" },
            { href: "/verify", label: "check a position" },
          ].map((d) => (
            <motion.div key={d.href} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
              <Link
                href={d.href}
                className="mono block rounded-full border border-white/8 px-4 py-2 text-[9.5px] tracking-[0.14em] text-white/45 transition-colors hover:border-white/20 hover:text-white/70"
              >
                {d.label.toUpperCase()}
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
