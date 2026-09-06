"use client";

import type { Direction } from "@molfi/sdk";

/**
 * The direction game's whole input: two keys, one of which is armed.
 *
 * What replaces the band control when the deck switches games. There is no width to choose and
 * no reach to price, so there is nothing to nudge — the only decision is a side, and the price
 * is the same either way.
 *
 * **Both keys are the same size and the same weight.** That is not a styling choice. On chain
 * the two directions are sold at one multiplier precisely so the public reservation cannot say
 * which side a ticket took; a deck that made one side louder than the other would undo in
 * pixels what the contract goes to some trouble to hide in storage.
 */
export function DirectionControl({
  picked,
  onPick,
  reference,
  multiplier,
  disabled,
}: {
  picked: Direction | null;
  onPick: (d: Direction) => void;
  /** The price the round is measured against, already formatted. */
  reference: string;
  /** The multiplier both sides are sold at, already formatted. */
  multiplier: string;
  disabled?: boolean;
}) {
  return (
    <div className="mt-2 rounded-[9px] border border-[#171717] bg-screen-2 px-[9px] py-[7px]">
      <div className="mono flex items-center justify-between text-[9px] tracking-[0.08em]">
        <span className="text-dim">FROM</span>
        <span className="tnum text-white/70">{reference}</span>
        <span className="text-dim">EITHER WAY PAYS</span>
        <span className="tnum font-bold text-amber">{multiplier}</span>
      </div>

      <div className="mt-[7px] grid grid-cols-2 gap-1.5">
        {(
          [
            { key: "up", label: "UP", glyph: "▲", tone: "var(--color-green)" },
            { key: "down", label: "DOWN", glyph: "▼", tone: "var(--color-red)" },
          ] as const
        ).map((d) => {
          const on = picked === d.key;
          return (
            <button
              key={d.key}
              disabled={disabled}
              aria-pressed={on}
              aria-label={`${d.label} — settles ${d.key === "up" ? "above" : "below"} ${reference}`}
              onClick={() => onPick(d.key)}
              className="mono flex items-center justify-center gap-1.5 rounded-md py-[9px] text-[11px] font-bold tracking-[0.1em] transition-colors duration-150 disabled:opacity-35"
              style={{
                // Armed is filled, unarmed is outlined — same footprint, same type size, so
                // neither side is the visually obvious one.
                background: on ? d.tone : "transparent",
                color: on ? "#000" : "var(--color-dim)",
                boxShadow: on ? "none" : `inset 0 0 0 1px ${d.tone}55`,
              }}
            >
              <span aria-hidden>{d.glyph}</span>
              {d.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
