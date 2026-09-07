"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ConsoleStage } from "@/components/ConsoleStage";
import { StarknetSpark } from "@/components/CoinMark";
import { fetchJson } from "@/lib/fetchJson";
import { useGsap } from "./useGsap";

/**
 * The object, first and largest.
 *
 * This is a hardware page for a device that does not physically exist, and it is laid out the
 * way a hardware page is: the thing itself, shot big, with the claim underneath it rather than
 * over it. A prediction market described in a sentence sounds like every other prediction
 * market; a handheld with a live price burning on its glass says what it is before the sentence
 * is read.
 *
 * The price is real. It comes from `/api/price` on the same route the desk polls, so the number
 * on the hero is the number the product is quoting at that moment — a landing page showing an
 * invented price for a product whose entire pitch is "these are real prices" would be a lie
 * told in the first two seconds.
 */

function useSpot() {
  const [spot, setSpot] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      fetchJson<{ price?: string }>("/api/price?market=BTC")
        .then((d) => {
          if (alive && d.price) {
            // 8dp fixed point, the oracle's shape, formatted the way the deck formats it.
            const n = Number(BigInt(d.price)) / 1e8;
            setSpot(n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
          }
        })
        .catch(() => {
          /* A hero that cannot reach the price shows no price. It does not invent one. */
        });
    void read();
    const id = setInterval(read, 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return spot;
}

export function Hero() {
  const spot = useSpot();

  const scope = useGsap(({ gsap, root }) => {
    /**
     * The device arrives as an object, not as a fade.
     *
     * One timeline so the parts are choreographed against each other rather than each racing
     * its own delay: the chassis rises and settles first, the glass lights a beat later, then
     * the words. That order is the argument — you see the thing, then it turns on, then it is
     * explained.
     */
    const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

    /**
     * The words must exist even if this timeline never gets to run.
     *
     * GSAP advances on `requestAnimationFrame`, and rAF is not guaranteed to run at speed —
     * background tabs, battery savers and headless capture tooling throttle it, in one
     * measured case to **two frames per second** with `visibilityState` still reporting
     * "visible". A three second intro then takes a minute and a half of wall clock, and until
     * it finishes the headline is held at `opacity: 0` by its own `from()`. The page renders a
     * console and no sentence: the one element that says what molfi is, absent, with no error
     * anywhere.
     *
     * So the entrance is an enhancement with a deadline. If the timeline has not finished on
     * wall-clock time it is snapped to its end state, which is simply the page as authored.
     * Under normal rAF this fires after the animation has already completed and does nothing.
     */
    const deadline = window.setTimeout(() => {
      if (tl.progress() < 1) tl.progress(1);
    }, 2_600);
    tl.eventCallback("onComplete", () => window.clearTimeout(deadline));
    tl.from("[data-hero=device]", { yPercent: 14, scale: 0.92, opacity: 0, duration: 1.1 })
      .from("[data-hero=glow]", { opacity: 0, scale: 0.6, duration: 1.2 }, "-=0.75")
      .from(
        "[data-hero=line]",
        { yPercent: 120, opacity: 0, duration: 0.75, stagger: 0.08 },
        "-=0.6",
      )
      .from("[data-hero=sub]", { y: 14, opacity: 0, duration: 0.6 }, "-=0.35")
      .from("[data-hero=cta]", { y: 14, opacity: 0, duration: 0.6 }, "-=0.4")
      .from("[data-hero=chip]", { y: 10, opacity: 0, duration: 0.5, stagger: 0.06 }, "-=0.45");

    /**
     * The device drifts up and out as the page scrolls past it.
     *
     * Scrubbed rather than triggered: the object should feel like it has weight and is being
     * left behind, which only reads if it tracks the scroll position exactly.
     */
    gsap.to("[data-hero=device]", {
      yPercent: -18,
      scale: 0.86,
      opacity: 0.25,
      ease: "none",
      scrollTrigger: {
        trigger: root,
        start: "top top",
        end: "bottom top",
        scrub: 0.6,
      },
    });
  });

  return (
    <section ref={scope} data-hero="root" className="relative min-h-[100svh] overflow-hidden">
      {/* A single warm source behind the device, so the chassis has something to be lit by. */}
      <div
        aria-hidden
        data-hero="glow"
        className="pointer-events-none absolute left-1/2 top-[22%] h-[560px] w-[560px] -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(255,159,10,0.16) 0%, rgba(255,159,10,0.05) 38%, transparent 68%)",
        }}
      />
      {/*
        The wallpaper, pushed back behind the object.
        
        At a flat opacity the tile competed with the device for the eye — a repeating motif at
        the same visual weight as the one thing the page is selling. Masked to fade out of the
        centre, it becomes a texture the console sits on rather than a pattern it sits in.
      */}
      <div
        aria-hidden
        className="tiled pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          maskImage:
            "radial-gradient(ellipse 70% 55% at 50% 34%, transparent 0%, rgba(0,0,0,0.55) 45%, black 78%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 55% at 50% 34%, transparent 0%, rgba(0,0,0,0.55) 45%, black 78%)",
        }}
      />

      <div className="relative mx-auto flex min-h-[100svh] w-full max-w-[1100px] flex-col items-center justify-center px-5 py-10">
        <div data-hero="chip" className="flex items-center gap-2">
          <span className="text-purple">
            <StarknetSpark size={14} />
          </span>
          <span className="mono text-[10px] tracking-[0.22em] text-white/40">
            STARKNET · SEPOLIA · LIVE
          </span>
        </div>

        {/* The device. The real WebGL console, not a picture of one. */}
        {/* Width-driven: a device has a shape, and the shape should not depend on the
            viewport height it happens to be shown at. */}
        {/*
          An explicit width, because the column centres its children.
          
          `items-center` makes a flex child shrink to its content, so `w-full` here resolved
          against a box that had already collapsed and the device rendered at thumbnail size.
          A width that does not depend on the parent's alignment mode is the fix.
        */}
        {/*
          An explicit box, because neither of the things that can go in it has an intrinsic one.
          
          A WebGL canvas has no natural height and the CSS device is aspect-driven, so a wrapper
          with only a width collapsed to 150px and squashed the console into a letterbox. The
          aspect ratio here is the device's own, so both renderers get the same shape and the
          hero looks identical whichever one the browser can run.
        */}
        <div data-hero="device" className="relative aspect-[0.66] w-[min(255px,54vw)]">
          <ConsoleStage spot={spot} />
        </div>

        <h1 className="mt-5 text-center font-display text-[clamp(2.6rem,9vw,5.2rem)] font-extrabold leading-[0.92] tracking-[-0.03em]">
          {/* Each line masked and pushed up, so the words arrive like a mechanism. */}
          <span className="block overflow-hidden">
            <span data-hero="line" className="block">
              A handheld for bets
            </span>
          </span>
          <span className="block overflow-hidden">
            <span data-hero="line" className="block text-amber">
              nobody can see.
            </span>
          </span>
        </h1>

        <p
          data-hero="sub"
          className="mt-4 max-w-[46ch] text-center text-[15px] leading-relaxed text-white/50"
        >
          Pick where the price lands, or just which way it goes. Your position is a hash until
          the round settles — the chain charges you correctly for a bet it cannot read.
        </p>

        <div data-hero="cta" className="mt-6 flex flex-col items-center gap-3">
          <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
            <Link
              href="/play"
              className="key block rounded-full bg-amber-2 px-9 py-4 text-[15px] font-extrabold tracking-tight text-black"
            >
              PLAY THE GAME
            </Link>
          </motion.div>
          <span className="mono text-[9.5px] tracking-[0.16em] text-white/30">
            AN EMAIL IS ENOUGH · WE FUND YOUR FIRST ACCOUNT
          </span>
        </div>
      </div>
    </section>
  );
}
