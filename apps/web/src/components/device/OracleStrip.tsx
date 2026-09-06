"use client";

import { useEffect, useState } from "react";

/**
 * One line of the oracle, on the deck.
 *
 * The Monad build put an order book here, because the mark came from an on-chain CLOB and
 * the book was the point of that market. molfi has no book. What decides every position is
 * **Pragma's median** — how old it is, how many publishers stand behind it, and how far it
 * has drifted from the live mark on screen — so that is what sits on the deck instead.
 *
 * It is the most consequential status line in the app and the easiest one to hide. A stale
 * print does not settle a market wrongly for one trader; it settles every position in that
 * market wrongly at once. Two taps away in a sheet is too far.
 */

export interface OracleState {
  price: string;
  display: number;
  decimals: number;
  updatedAt: number;
  sources: number;
  ageSeconds: number;
  quotable: boolean;
  refusal: string;
}

/** The one-word verdict, and why. Each is a different problem with a different response. */
function verdictOf(
  o: OracleState | null,
  error: string | null,
  driftBps: number | null,
): { word: string; tone: string; why: string } {
  if (error) {
    return { word: "UNREAD", tone: "text-red", why: `The oracle could not be read: ${error}` };
  }
  if (!o) return { word: "…", tone: "text-dim", why: "Reading the oracle." };
  if (!o.quotable) {
    return {
      word: o.sources < 3 ? "THIN" : "STALE",
      tone: "text-red",
      why: o.refusal || "This print cannot be settled against.",
    };
  }
  if (driftBps !== null && Math.abs(driftBps) > 50) {
    return {
      word: "DRIFTED",
      tone: "text-amber",
      why: `The live mark is ${Math.abs(driftBps).toFixed(0)} bps ${
        driftBps > 0 ? "above" : "below"
      } the last published median. Your band settles against the median, not the mark.`,
    };
  }
  if (o.ageSeconds > 300) {
    return {
      word: "AGEING",
      tone: "text-amber",
      why: `${o.ageSeconds}s since the last publish. Still settleable, but the next print will move.`,
    };
  }
  return {
    word: "FRESH",
    tone: "text-green",
    why: `Published ${o.ageSeconds}s ago by ${o.sources} independent publishers.`,
  };
}

export function OracleStrip({
  oracle,
  error,
  mark,
  onOpen,
}: {
  oracle: OracleState | null;
  error: string | null;
  /** The live mark on screen, in the same 8dp units, for the drift reading. */
  mark: bigint;
  onOpen?: () => void;
}) {
  /**
   * A short history of the age, kept client-side.
   *
   * One reading cannot tell a feed that publishes reliably every four minutes from one that
   * has quietly stopped and is about to go stale. The sawtooth is the difference, and it is
   * visible at a glance in a shape where it is invisible in a number. Not persisted: on
   * reload the question is what the feed is doing now.
   */
  const [ages, setAges] = useState<number[]>([]);

  useEffect(() => {
    if (!oracle) return;
    setAges((prev) => [...prev, oracle.ageSeconds].slice(-24));
  }, [oracle?.updatedAt, oracle?.ageSeconds]);

  const driftBps =
    oracle && mark > 0n && BigInt(oracle.price) > 0n
      ? Number(((mark - BigInt(oracle.price)) * 10_000n) / BigInt(oracle.price))
      : null;

  const v = verdictOf(oracle, error, driftBps);

  /**
   * A readout, not a button — unless something is given for it to open.
   *
   * A tappable strip invites the reading that the detail is behind the tap and the line
   * itself is decoration. It is the opposite: this is the only place the freshness of the
   * number every position settles against is stated, and it has to be legible without
   * anyone pressing anything.
   */
  const Tag = onOpen ? "button" : "div";
  return (
    <Tag
      onClick={onOpen}
      className={`mono mt-2 flex w-full items-center justify-between gap-2 rounded-[9px] border border-[#171717] bg-screen-2 px-[9px] py-[7px] text-[9px] tracking-[0.08em] ${
        onOpen ? "transition-colors hover:bg-[#111]" : ""
      }`}
      title={v.why}
    >
      <span className="flex items-center gap-1.5">
        <span className="text-dim">PRAGMA</span>
        <span className={v.tone}>{v.word}</span>
      </span>
      <span className="tnum flex items-center gap-2">
        {ages.length > 2 ? <AgeSpark values={ages} /> : null}
        {oracle ? (
          <>
            <span className="text-dim" title="Independent publishers behind the median">
              {oracle.sources}src
            </span>
            <span className="text-dim">·</span>
            <span className={oracle.ageSeconds > 300 ? "text-amber" : "text-green"}>
              {oracle.ageSeconds}s
            </span>
            {driftBps !== null ? (
              <span
                className={Math.abs(driftBps) > 50 ? "text-amber" : "text-dim"}
                title="How far the live mark has moved since the last published median. Settlement uses the median."
              >
                {driftBps > 0 ? "+" : ""}
                {driftBps.toFixed(0)}bps
              </span>
            ) : null}
          </>
        ) : null}
      </span>
    </Tag>
  );
}

/**
 * Time since publish, over the last few reads.
 *
 * A sawtooth is a healthy feed: age climbs, a publish lands, age drops to zero. A line that
 * only climbs is a feed that has stopped, and it is visible here several minutes before the
 * staleness rule notices. Scaled to its own range, because the question is the shape.
 */
function AgeSpark({ values }: { values: number[] }) {
  const hi = Math.max(...values, 1);
  const w = 34;
  const h = 9;
  const d = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * w;
      const y = h - (v / hi) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  // A publish resets the age, so a series that never falls is a series with no publish in it.
  const republished = values.some((v, i) => i > 0 && v < values[i - 1]);
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-label={`Seconds since publish over the last ${values.length} reads, peaking at ${hi.toFixed(0)}`}
      className="overflow-visible"
    >
      <path
        d={d}
        fill="none"
        strokeWidth={1}
        className={republished ? "stroke-green" : "stroke-amber"}
        strokeLinejoin="round"
      />
    </svg>
  );
}
