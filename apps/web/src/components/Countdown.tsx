"use client";

import { useEffect, useState } from "react";
import { fmtCountdown } from "@molfi/sdk";

/**
 * Time to a cutoff, ticking.
 *
 * The server cannot render a countdown. Whatever number it computes is stale by the time the
 * browser hydrates — seconds have passed, which is the entire nature of a clock — and React
 * treats the difference as a hydration failure and throws #418 on every page carrying one.
 *
 * Declaring the mismatch with `suppressHydrationWarning` silences it, and this does that too.
 * But the better answer is not to create one: the server renders the **cutoff time**, which
 * is a fixed fact and identical in both renders, and the client swaps to a relative countdown
 * once it has mounted. Nothing to reconcile, and a reader without JavaScript gets a real
 * answer rather than a frozen "5:12" that will never move.
 *
 * Under a minute it turns amber and the digits get heavier. That is the only decoration here:
 * it carries the one thing a countdown must convey at a glance, which is whether you still
 * have time.
 */
export function Countdown({ to }: { to: number }) {
  // Null until mounted. The first client render therefore matches the server's exactly.
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setLeft(Math.max(0, to - Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [to]);

  const at = new Date(to * 1000);
  // The server's value, and the client's before it mounts: a fixed time, not a duration.
  const absolute = at.toISOString().slice(11, 19);

  const urgent = left !== null && left <= 60;
  const done = left === 0;

  return (
    <span
      suppressHydrationWarning
      className={`tnum text-[14px] tabular-nums transition-colors duration-500 ${
        done ? "text-red" : urgent ? "font-bold text-amber" : "text-white/70"
      }`}
      role="timer"
      aria-live={urgent ? "polite" : "off"}
      title={`Cutoff at ${at.toUTCString()}`}
    >
      {left === null ? absolute : done ? "due" : fmtCountdown(left)}
    </span>
  );
}
