"use client";

import { useCallback, useRef } from "react";

/** Pointer travel, in pixels, that advances the stake by one detent. */
const PX_PER_DETENT = 14;

/**
 * The stake knob — a cylinder you turn, not a coin stack you look at.
 *
 * The gold column used to be a read-only picture of the balance while the stake was set by a
 * slider on the top rail, which meant the most physical-looking thing on the device did
 * nothing and the number it implied lived somewhere else. One value, one control: this owns
 * the stake, and the rail on the shell owns volume.
 *
 * The illusion is almost entirely one property. The ribs are a repeating gradient and the
 * drag moves its `background-position` 1:1 with the pointer, so the surface turns under the
 * finger instead of the whole element sliding. Everything else — the horizontal gradient for
 * a cylinder lit from the side, the end caps, the amber detent nub — is static.
 */
export function Knob({
  value,
  max,
  onChange,
  label = "TURN",
  valueText,
}: {
  /** Current detent, 1-based. */
  value: number;
  /** How many detents there are. */
  max: number;
  onChange: (v: number) => void;
  label?: string;
  /**
   * What this detent means, in the words on the readout — "$5.00", not "5".
   *
   * `aria-valuenow` has to be the detent index, because that is what the range is expressed
   * in, and a screen reader left with only that announces "3 of 6" for a five dollar stake.
   * `aria-valuetext` is the standard way to say the number a sighted user is reading.
   */
  valueText?: string;
}) {
  /** Where the drag started, and the value it started from. Null when not dragging. */
  const drag = useRef<{ y: number; from: number } | null>(null);
  /** Accumulated rotation in pixels, so the ribs keep their phase across drags. */
  const spun = useRef(0);
  const ribs = useRef<HTMLSpanElement | null>(null);

  const spin = useCallback((byPx: number) => {
    spun.current += byPx;
    if (ribs.current) ribs.current.style.backgroundPosition = `0 ${-spun.current}px`;
  }, []);

  const step = useCallback(
    (delta: number) => {
      const next = Math.max(1, Math.min(max, value + delta));
      if (next !== value) onChange(next);
    },
    [value, max, onChange],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { y: e.clientY, from: value };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // Up is more. The ribs follow the raw pointer; the value follows the detents, so the
    // surface stays under the finger even between steps.
    spin(e.movementY);
    const detents = Math.round((d.y - e.clientY) / PX_PER_DETENT);
    const next = Math.max(1, Math.min(max, d.from + detents));
    if (next !== value) onChange(next);
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Stake"
        aria-valuemin={1}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
        title="drag or scroll to step the stake"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => {
          spin(e.deltaY * 0.5);
          step(e.deltaY < 0 ? 1 : -1);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowRight") {
            e.preventDefault();
            spin(-PX_PER_DETENT);
            step(1);
          }
          if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
            e.preventDefault();
            spin(PX_PER_DETENT);
            step(-1);
          }
        }}
        className="relative w-[58px] min-h-[104px] flex-1 cursor-grab touch-none overflow-hidden rounded-[13px] active:cursor-grabbing"
        style={{
          background:
            "linear-gradient(90deg,#3d2802 0%,#a97a10 9%,#f0c236 26%,#fff3b8 41%,#f5c518 56%,#d9a30f 74%,#8a5f06 90%,#3d2802 100%)",
        }}
      >
        <span
          ref={ribs}
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(180deg,rgba(0,0,0,.5) 0 1.5px,rgba(255,255,255,.26) 1.5px 3px,rgba(0,0,0,0) 3px 12px)",
          }}
        />
        {/* End caps: the cylinder curving away at both ends. */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-[11px]"
          style={{ background: "linear-gradient(180deg,rgba(0,0,0,.55),transparent)" }}
        />
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[13px]"
          style={{ background: "linear-gradient(0deg,rgba(0,0,0,.6),transparent)" }}
        />
        {/* The detent, as a percentage of the step range: max at the top, one at the bottom. */}
        <span
          aria-hidden
          className="absolute left-0 h-1 w-[9px] rounded-r-[3px] bg-amber"
          style={{
            top: `${max > 1 ? ((max - value) / (max - 1)) * 88 + 6 : 50}%`,
            boxShadow: "0 0 8px rgba(255,159,10,.85)",
          }}
        />
      </div>
      <span
        className="mono mt-1.5 block text-center text-[9.5px] tracking-[0.16em] text-dim"
        aria-hidden
      >
        {label}
      </span>
    </>
  );
}
