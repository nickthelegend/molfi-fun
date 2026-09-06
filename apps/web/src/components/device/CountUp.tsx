"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A settlement amount arriving rather than appearing.
 *
 * The number a round produces is the only moment on the device that is worth watching, and
 * it used to pop into place fully formed — the same treatment a validation error gets. The
 * count is short and eased out, so it reads as the payout landing rather than as a loading
 * spinner made of digits.
 *
 * Driven off `requestAnimationFrame` against wall-clock time, not a fixed number of frames,
 * so it takes the same 620ms on a slow device as on a fast one. Under `prefers-reduced-motion`
 * the final value is rendered immediately — the state change still happens, only its travel
 * is removed.
 */
export function CountUp({
  to,
  format,
  ms = 620,
  reducedMotion,
}: {
  /** The value to land on, in the same units `format` expects. */
  to: bigint;
  format: (v: bigint) => string;
  ms?: number;
  reducedMotion?: boolean;
}) {
  const [shown, setShown] = useState<bigint>(reducedMotion ? to : 0n);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (reducedMotion) {
      setShown(to);
      return;
    }
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / ms);
      // Cubic ease-out: most of the distance early, so the last digits settle rather than race.
      const eased = 1 - (1 - t) ** 3;
      // Scaled in integers throughout — the amounts are token units and a float round-trip
      // through a payout is how a display drifts a wei from what was actually paid.
      setShown((to * BigInt(Math.round(eased * 10_000))) / 10_000n);
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else setShown(to);
    };
    frame.current = requestAnimationFrame(tick);

    /**
     * Land on the value even if no frame ever comes.
     *
     * `requestAnimationFrame` does not fire in a tab that is not painting — a background tab,
     * a collapsed pane — and browsers throttle it well before that. Without this the count
     * would sit at zero and the device would report a settlement of $0.00, which is worse
     * than not animating at all. The animation is the decoration; the number is not.
     */
    const landed = setTimeout(() => setShown(to), ms + 80);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      clearTimeout(landed);
    };
  }, [to, ms, reducedMotion]);

  return <>{format(shown)}</>;
}
