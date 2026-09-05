"use client";

import { useEffect, useState } from "react";
import { fmtCountdown } from "@molfi/sdk";

/**
 * Time to a cutoff, ticking.
 *
 * Server-rendered pages get a frozen number, which on a countdown reads as broken rather
 * than as static. This mounts over it and starts ticking.
 *
 * The server's value and the client's necessarily differ: seconds pass between the render
 * and the hydration, which is the entire nature of a clock. React treats that as a hydration
 * failure and throws #418 — so the mismatch is declared with `suppressHydrationWarning`
 * rather than papered over. Without it, every page carrying a countdown logged an uncaught
 * error, and the client value is the correct one anyway.
 *
 * Under a minute it turns amber and the digits get slightly heavier. That is the only
 * decoration here: it carries the one piece of information a countdown has to convey at a
 * glance, which is whether you still have time.
 */
export function Countdown({ to }: { to: number }) {
  const [left, setLeft] = useState(() => Math.max(0, to - Math.floor(Date.now() / 1000)));

  useEffect(() => {
    const tick = () => setLeft(Math.max(0, to - Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [to]);

  const urgent = left <= 60;
  const done = left === 0;

  return (
    <span
      className={`tnum text-[14px] tabular-nums transition-colors duration-500 ${
        done ? "text-red" : urgent ? "font-bold text-amber" : "text-white/70"
      }`}
      // Expected to differ from the server: time passed between the two renders.
      suppressHydrationWarning
      role="timer"
      aria-live={urgent ? "polite" : "off"}
      title={`Cutoff at ${new Date(to * 1000).toUTCString()}`}
    >
      {done ? "due" : fmtCountdown(left)}
    </span>
  );
}
