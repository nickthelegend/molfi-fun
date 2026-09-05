"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A price that rolls to its new value instead of cutting to it.
 *
 * Only the digits that changed move. A whole-number crossfade would animate all eight
 * characters when the last one ticked, which reads as the price being replaced rather
 * than moving — and on a 300ms chain the last digit changes constantly, so that would
 * be a permanently churning readout.
 *
 * The roll is 180ms, shorter than a block. Anything longer and the display is still
 * catching up when the next price lands, which is worse than not animating: the number
 * on screen would never be the number the market is at.
 *
 * Reduced motion gets the plain value, because a moving price readout is exactly what
 * that setting exists to switch off.
 */
export function Odometer({
  value,
  className,
  reducedMotion = false,
}: {
  value: string;
  className?: string;
  reducedMotion?: boolean;
}) {
  const [prev, setPrev] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (reducedMotion || value === prev) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPrev(value), 180);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, prev, reducedMotion]);

  if (reducedMotion) return <span className={className}>{value}</span>;

  const chars = value.split("");
  const before = prev.split("");
  // Compare from the right: a price gaining a digit should not make every column look
  // changed just because the string got longer.
  const pad = chars.length - before.length;

  return (
    <span className={className} aria-label={value}>
      {chars.map((ch, i) => {
        const old = before[i - pad] ?? ch;
        const rolling = old !== ch && /\d/.test(ch);
        return (
          <span
            key={i}
            aria-hidden
            className={`relative inline-block ${rolling ? "roll" : ""}`}
            style={{ minWidth: /\d/.test(ch) ? "0.62ch" : undefined }}
          >
            {ch}
          </span>
        );
      })}
    </span>
  );
}
