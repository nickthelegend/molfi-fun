"use client";

/**
 * The band width, as a control on the glass.
 *
 * Dragging the edges of the band on the chart still works and is the precise way to do it on
 * a desktop, but it is undiscoverable on a phone and imprecise with a thumb: the target is a
 * 1px rule. Two keys and a fill make the same adjustment findable, and the printed reach
 * means the number changes visibly even when the chart's scale hides a small step.
 */
export function BandControl({
  widthPct,
  onNudge,
  label,
  disabled,
}: {
  /** How wide the band is as a fraction of the legal window, 0–1. */
  widthPct: number;
  onNudge: (delta: number) => void;
  /** The reach, already formatted — e.g. `0.42%`. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="mt-2 flex items-center gap-[7px] rounded-[11px] border border-[#171717] bg-screen-2 px-2 py-[7px]">
      <span className="mono text-[9px] tracking-[0.15em] text-dim">BAND</span>
      <button
        onClick={() => onNudge(-0.08)}
        disabled={disabled}
        aria-label="Tighter band"
        className="h-[26px] w-[30px] rounded-[7px] bg-[#1c1c1c] text-[14px] font-semibold text-amber disabled:opacity-30"
      >
        −
      </button>
      <div className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-[#1c1c1c]">
        <span
          className="block h-full"
          style={{
            width: `${Math.max(0, Math.min(1, widthPct)) * 100}%`,
            background: "linear-gradient(90deg,#ff9f0a,#ffc247)",
          }}
        />
      </div>
      <button
        onClick={() => onNudge(0.08)}
        disabled={disabled}
        aria-label="Wider band"
        className="h-[26px] w-[30px] rounded-[7px] bg-[#1c1c1c] text-[14px] font-semibold text-amber disabled:opacity-30"
      >
        +
      </button>
      <span className="mono tnum min-w-[52px] text-right text-[10px] text-white">±{label}</span>
    </div>
  );
}
