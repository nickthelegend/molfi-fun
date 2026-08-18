"use client";

import { NO_TARGET, type MatchView } from "@crewkill/protocol";
import { useEffect, useState } from "react";
import { Crewmate } from "./sprite";

/**
 * The meeting table.
 *
 * Ported from the OneChain build's `VotingScreen`. The Starknet rebuild had reduced the
 * tensest moment in the game to a two-column grid of buttons in a side panel, which is a
 * reasonable way to collect input and a terrible way to hold a vote. Everyone sitting around
 * a table looking at each other is the entire point of the format.
 *
 * Seats are laid out on a circle, so you can see who is left and who is already gone at a
 * glance. The living are pickable; the dead stay at the table greyed out, because knowing
 * who died and when is evidence.
 *
 * What it deliberately does not show, unlike the original: who voted for whom. The original
 * ran on a server that knew. Here the chain stores only a hash of a secret nobody has
 * published, so that information does not exist yet, and inventing it would be a lie about
 * the one property this game is built on.
 */
export function VotingScreen({
  match,
  yourSeat,
  busy,
  onVote,
  onClose,
}: {
  match: MatchView;
  yourSeat: number | null;
  busy: boolean;
  onVote: (target: number) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);

  const seats = match.seats;
  const alive = seats.filter((seat) => seat.alive);
  const you = yourSeat === null ? null : seats[yourSeat];
  const canVote = Boolean(you?.alive) && match.roundPhase === "voting";

  /**
   * Voting from the keyboard.
   *
   * A vote is on a clock, and hunting for a small seat marker with a mouse while the timer
   * runs is the worst moment in the round to be fighting the interface. Number keys pick the
   * seat with that number, Enter casts, S skips, Escape backs out.
   *
   * Bound to the seat's own displayed number rather than its position in the list, so the key
   * you press matches the label you can see. Pressing a dead seat's number, or your own,
   * does nothing rather than selecting something you cannot vote for.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (!canVote || busy) return;

      const key = event.key.toLowerCase();

      if (key === "s") {
        event.preventDefault();
        onVote(NO_TARGET);
        return;
      }

      if (key === "enter") {
        if (selected === null) return;
        event.preventDefault();
        onVote(selected);
        return;
      }

      if (key >= "0" && key <= "9") {
        const wanted = Number(key);
        const seat = seats.find((s) => s.index === wanted);
        // Only seats you could have clicked. Same rule as the buttons, so the two agree.
        if (!seat || !seat.alive || seat.index === yourSeat) return;
        event.preventDefault();
        setSelected((current) => (current === seat.index ? null : seat.index));
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canVote, busy, selected, seats, yourSeat, onVote, onClose]);

  // The table. Radius is in percent of the plate so it scales with the viewport.
  const position = (index: number, total: number) => {
    const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
    return {
      left: `${50 + Math.cos(angle) * 37}%`,
      top: `${50 + Math.sin(angle) * 37}%`,
    };
  };

  const tally = match.tallies.find((entry) => entry.round === match.round);
  const cast = tally ? tally.targets.reduce((sum, target) => sum + target.votes, 0) : 0;

  return (
    <div
      className="cutscene fixed inset-0 z-40 flex flex-col"
      style={{ background: "color-mix(in srgb, var(--void) 94%, transparent)" }}
    >
      <header className="flex items-baseline justify-between gap-4 p-4">
        <div>
          <div className="tele">Round {match.round} meeting</div>
          <h2 className="macro macro-lg mt-1">Who goes out</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="numeric text-[13px] text-[var(--color-dim)]">
            {cast}/{alive.length} cast
          </span>
          <button onClick={onClose} className="switch">
            Watch the ship
          </button>
        </div>
      </header>

      {/* The table itself. */}
      <div className="relative mx-auto w-full max-w-3xl flex-1">
        {/* A ring to sit around, so the seats read as a table rather than scattered. */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[74%] -translate-x-1/2 -translate-y-1/2 rounded-full border"
          style={{ borderColor: "var(--color-line)" }}
        />

        {seats.map((seat, i) => {
          const pos = position(i, seats.length);
          const isYou = seat.index === yourSeat;
          const pickable = canVote && seat.alive && !isYou;
          const isSelected = selected === seat.index;

          return (
            <button
              key={seat.index}
              onClick={() => pickable && setSelected(isSelected ? null : seat.index)}
              disabled={!pickable}
              aria-pressed={isSelected}
              className="absolute -translate-x-1/2 -translate-y-1/2 p-2 text-center disabled:cursor-default"
              style={pos}
            >
              <span
                className="block border p-2"
                style={{
                  borderColor: isSelected
                    ? "var(--color-alarm)"
                    : isYou
                      ? "var(--color-cyan)"
                      : "transparent",
                  opacity: seat.alive ? 1 : 0.32,
                }}
              >
                <Crewmate
                  seatIndex={seat.index}
                  size={62}
                  alive={seat.alive}
                  showName={false}
                />
                <span className="mt-1 block text-[12px]">{seat.persona}</span>
                <span className="tele block">
                  {isYou ? "you" : seat.alive ? seat.locationName : "dead"}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Controls. */}
      <div className="border-t border-[var(--color-line)] p-4">
        {!canVote ? (
          <p className="text-center text-[13px] text-[var(--color-dim)]">
            {you && !you.alive
              ? "You are dead. You can watch the vote, but you cannot cast one."
              : "You are spectating this match."}
          </p>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] text-[var(--color-dim)]">
              {selected === null
                ? "Pick someone, or skip. A ballot is a note you spend, so you get one per round."
                : `Ejecting ${seats[selected].persona}. Nothing on-chain will say it was you.`}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => onVote(NO_TARGET)}
                disabled={busy}
                className="switch"
              >
                Skip
              </button>
              <button
                onClick={() => selected !== null && onVote(selected)}
                disabled={busy || selected === null}
                className="switch switch-primary"
              >
                {busy ? "Casting" : "Cast ballot"}
              </button>
            </div>

            {/* The shortcuts, stated where they are used. A binding nobody is told about
                does not exist. */}
            <p className="tele mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span><kbd className="vote-key">0-9</kbd> pick seat</span>
              <span><kbd className="vote-key">Enter</kbd> cast</span>
              <span><kbd className="vote-key">S</kbd> skip</span>
              <span><kbd className="vote-key">Esc</kbd> close</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
