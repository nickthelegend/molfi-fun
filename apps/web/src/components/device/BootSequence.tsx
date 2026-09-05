"use client";

import { useEffect, useState } from "react";

/**
 * What the console shows while it is fetching the tape it opens on.
 *
 * A spinner says "wait" and nothing else. These lines say what is actually happening,
 * in the order it happens, and every one of them is a real step: the desk really does
 * fetch a live price, really does pull a thousand one-second closes, and really does
 * solve the band's legal window against the same arithmetic the contract prices with.
 * If it stalls, the last line printed is where it stalled — which a spinner cannot tell
 * anyone.
 *
 * Deliberately not faked with a timer that races ahead of the work: the lines advance
 * on a cadence, but the component only renders at all while `ready` is false, so the
 * sequence stops where the loading actually is rather than completing on its own.
 */
const STEPS = [
  "XORR CONSOLE",
  "pricing tables … measured",
  "band solver … ready",
];

export function BootSequence({ symbol }: { symbol: string }) {
  const [n, setN] = useState(1);

  useEffect(() => {
    if (n >= STEPS.length) return;
    const t = setTimeout(() => setN((v) => v + 1), 260);
    return () => clearTimeout(t);
  }, [n]);

  return (
    <div className="flex h-full flex-col justify-center gap-1 px-6">
      {STEPS.slice(0, n).map((line, i) => (
        <div
          key={line}
          className={`mono text-[10px] tracking-[0.12em] ${
            i === 0 ? "text-amber" : "text-dim"
          }`}
        >
          {line}
        </div>
      ))}
      {n >= STEPS.length ? (
        <div className="mono text-[10px] tracking-[0.12em] text-dim">
          fetching real {symbol} tape<span className="blink">_</span>
        </div>
      ) : null}
    </div>
  );
}
