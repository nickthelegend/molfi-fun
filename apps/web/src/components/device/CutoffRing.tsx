"use client";

import { fmtCountdown } from "@molfi/sdk";

/**
 * How long a position has left, counted in time.
 *
 * The Monad version counted blocks, and was right to: the cutoff there was a block height,
 * and a clock in seconds would have quietly misrepresented it. molfi's cutoff is a unix
 * second, because what constrains a round here is how often the oracle republishes rather
 * than how fast blocks close — so counting blocks would be the misrepresentation now.
 *
 * The ring drains rather than fills, so "nearly gone" reads at a glance, and the number in
 * the middle is the literal time remaining.
 */
const SIZE = 34;
const STROKE = 3;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

export function CutoffRing({
  openedAt,
  expiresAt,
  now,
}: {
  openedAt: number;
  expiresAt: number;
  now: number;
}) {
  const total = Math.max(1, expiresAt - openedAt);
  const left = Math.max(0, expiresAt - now);
  const remaining = Math.max(0, Math.min(1, left / total));

  // Under a fifth of the round left is where a trader starts caring.
  const urgent = remaining <= 0.2;
  const tone = urgent ? "var(--color-red)" : "var(--color-amber)";

  // A four hour round shown to the second is noise; the ring carries the urgency and the
  // label carries the magnitude.
  const label = left >= 3_600 ? `${Math.ceil(left / 3_600)}h` : fmtCountdown(left);

  return (
    <span
      className="relative inline-grid place-items-center"
      style={{ width: SIZE, height: SIZE }}
      role="timer"
      aria-label={`${fmtCountdown(left)} until cutoff`}
      title={`${fmtCountdown(left)} of ${fmtCountdown(total)} left`}
    >
      <svg width={SIZE} height={SIZE} className="absolute -rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#1e1e1e" strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={tone}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - remaining)}
          // Matches the desk's tick, so the sweep is continuous rather than stepped.
          style={{ transition: "stroke-dashoffset 120ms linear, stroke 200ms ease" }}
        />
      </svg>
      <span
        className={`tnum relative font-bold leading-none ${
          label.length > 4 ? "text-[8px]" : "text-[10px]"
        } ${urgent ? "text-red" : "text-amber"}`}
      >
        {label}
      </span>
    </span>
  );
}
