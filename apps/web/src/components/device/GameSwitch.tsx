"use client";

/**
 * Which game the deck is playing.
 *
 * A two-position toggle rather than a tab bar or a dropdown, because it is a mode switch on a
 * handheld and it has exactly two settings. The moving pill makes the change legible without
 * reading either label — on a device the eye learns positions long before it learns words.
 *
 * It sits on the deck rather than in the menu on purpose. Which game you are playing changes
 * what every control around it means, and a mode you can forget you are in is the oldest
 * interface bug there is. On the deck it is also the right size to hit with a thumb, which it
 * was not when it lived on the glass.
 */
export type Game = "range" | "direction";

export function GameSwitch({
  game,
  onChange,
  disabled,
}: {
  game: Game;
  onChange: (g: Game) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Game"
      className="relative flex w-full rounded-[12px] border border-[#171717] bg-screen-2 p-[3px]"
    >
      {/*
        The pill is one element that slides, not two that swap colour. A cross-fade reads as
        two separate things blinking; travel reads as one control moving, which is what it is.
      */}
      <span
        aria-hidden
        className="absolute inset-y-[3px] left-[3px] w-[calc(50%-3px)] rounded-[9px] bg-amber transition-transform duration-200 ease-out motion-reduce:duration-75"
        style={{ transform: game === "range" ? "translateX(0)" : "translateX(100%)" }}
      />
      {(
        [
          { key: "range", label: "RANGE", hint: "where it lands" },
          { key: "direction", label: "UP / DOWN", hint: "which way it goes" },
        ] as const
      ).map((g) => (
        <button
          key={g.key}
          role="radio"
          aria-checked={game === g.key}
          aria-label={`${g.label} — ${g.hint}`}
          title={g.hint}
          disabled={disabled}
          onClick={() => onChange(g.key)}
          /*
            `whitespace-nowrap`, because the label is two words with a slash and the frame is
            narrow: without it "UP / DOWN" wrapped onto two lines inside the pill and the
            control grew a second row that made the whole deck look broken.
          */
          className={`relative z-10 flex-1 whitespace-nowrap rounded-[9px] py-[9px] text-[10px] font-extrabold tracking-[0.1em] transition-colors duration-200 disabled:opacity-40 ${
            game === g.key ? "text-black" : "text-dim"
          }`}
        >
          {g.label}
        </button>
      ))}
    </div>
  );
}
