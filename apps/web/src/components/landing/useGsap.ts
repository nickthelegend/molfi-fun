"use client";

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { usePrefersReducedMotion } from "@/lib/usePrefs";

/**
 * GSAP, registered once, with the reduced-motion contract honoured at the source.
 *
 * `gsap.context` is the whole reason this is a hook rather than a bare `useLayoutEffect`.
 * Every tween and ScrollTrigger created inside the callback is recorded against the context,
 * so one `revert()` on unmount kills all of them — including the scroll triggers, which
 * otherwise survive a route change, keep listening to a scroller that no longer exists and
 * quietly leak a frame's work per scroll event for the rest of the session. Next's client
 * router does not reload the page, so "it goes away on navigate" is not true here.
 *
 * Reduced motion is checked before anything is built rather than by shortening durations
 * after. A scroll-scrubbed timeline with a short duration is still a scroll-scrubbed
 * timeline; the honest answer to "I do not want motion" is to leave the page in its final
 * state, which is what skipping the setup does — every element is authored visible and the
 * animations take things *away* from that.
 */
export function useGsap(
  build: (ctx: {
    gsap: typeof gsap;
    ScrollTrigger: typeof ScrollTrigger;
    /**
     * The section element itself, to be used as the ScrollTrigger `trigger`.
     *
     * This is not a convenience. `gsap.context(fn, scope)` scopes selector strings to the
     * scope element's **subtree**, and an element is not a descendant of itself — so
     * `trigger: "[data-x=root]"` on the section that *is* the scope silently resolved to
     * nothing. A trigger of null is not an error in GSAP: the pin quietly never engaged, and
     * every `from` rendered its end state immediately, so the whole page sat fully revealed at
     * scroll zero with no animation and no console message. Passing the node removes the
     * possibility.
     */
    root: HTMLDivElement;
  }) => void,
  deps: unknown[] = [],
) {
  const scope = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();

  useLayoutEffect(() => {
    if (reduced) return;
    gsap.registerPlugin(ScrollTrigger);
    const root = scope.current;
    if (!root) return;
    const ctx = gsap.context(() => build({ gsap, ScrollTrigger, root }), scope);
    // A late webfont or image changes every trigger's start position. Recomputing once the
    // page has actually settled is cheaper than pinning at the wrong scroll offset.
    const settle = requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => {
      cancelAnimationFrame(settle);
      ctx.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, ...deps]);

  return scope;
}
