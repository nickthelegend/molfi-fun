"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A section that arrives when it is scrolled to.
 *
 * The landing page makes an argument in four parts, and dropping all four onto the screen at
 * once is how a reader decides it is a wall of text before reading any of it. Revealing each
 * as it comes into view paces the argument at the speed it is being read.
 *
 * `IntersectionObserver` rather than a scroll handler: the browser does the work off the main
 * thread and there is no listener firing sixty times a second to throttle. Once a section has
 * arrived it is unobserved — a panel that fades out again when you scroll back is a panel that
 * fights you.
 *
 * **It starts visible and is hidden by the effect**, not the other way round. A reader with
 * JavaScript disabled, or one who arrives before hydration, gets the whole page rather than a
 * column of blank cards — the animation is an enhancement and it fails to *shown*.
 */
export function Reveal({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(true);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Respect the OS preference by never arming at all: with reduced motion the section is
    // simply there, which is what shortening an animation to nothing should look like.
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    setShown(false);
    setArmed(true);

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.unobserve(e.target);
          }
        }
      },
      // A little before the edge, so the section is already settled by the time it is read.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );
    io.observe(el);

    /**
     * Show it anyway if the observer never speaks.
     *
     * Hiding on mount and waiting for `IntersectionObserver` means that anything which stops
     * it firing leaves the section invisible **for ever** — and it does not fire in a tab that
     * is not painting, which is exactly how this was caught: three sections sat at opacity
     * zero with their text present in the DOM, scrolled fully into view. A background tab, a
     * prerender, a headless check and a screenshot service all hit the same path.
     *
     * Two and a half seconds is long enough that a normal reader never sees it win the race,
     * and short enough that nobody stares at a blank card. The animation is an enhancement;
     * the content is not, and no enhancement gets to withhold it.
     */
    const failOpen = setTimeout(() => setShown(true), 2_500);
    return () => {
      io.disconnect();
      clearTimeout(failOpen);
    };
  }, []);

  return (
    <div
      ref={ref}
      style={{
        transitionDelay: `${delay}ms`,
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(14px)",
        transition: armed ? "opacity 520ms ease-out, transform 520ms cubic-bezier(.2,.7,.3,1)" : undefined,
      }}
    >
      {children}
    </div>
  );
}
