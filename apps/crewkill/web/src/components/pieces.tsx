"use client";

import { MatchPhase, NO_TARGET, type MatchView, type SeatView } from"@crewkill/protocol";
import { useEffect, useState } from"react";

/**
 * Structural weights.
 *
 * The audit found twenty-four identical bordered boxes, which is the uniform-card
 * disease: everything framed the same way means nothing is framed at all. Three
 * weights instead, so a glance can rank what it is looking at.
 *
 *   primary  the instrument you are reading. Corner brackets, filled plate.
 *   rail     a secondary data rail. Top rule only, no fill, no brackets.
 *   inline   a readout with no chrome at all.
 */
export function Panel({
  title,
  right,
  children,
  className ="",
  weight ="primary",
  id,
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  weight?:"primary" |"rail" |"inline";
  /** For anchoring: the landing screen scrolls to a panel by id. */
  id?: string;
}) {
  const shell =
    weight ==="primary" ?"frame" : weight ==="rail" ?"rail" :"readout";
  const pad = weight ==="primary" ?"p-4" : weight ==="rail" ?"pt-3" :"";

  return (
    <section id={id} className={`min-w-0 ${shell} ${className}`}>
      {title && (
        <header
          className={`flex items-baseline justify-between gap-3 ${
            weight ==="primary"
              ?"border-b border-[var(--color-line)] px-4 py-2.5"
              :"pb-2"
          }`}
        >
          <h2 className="tele">{title}</h2>
          {right}
        </header>
      )}
      <div className={`min-w-0 ${pad}`}>{children}</div>
    </section>
  );
}

/**
 * Substrate switch.
 *
 * Phosphor-on-black or ink-on-newsprint. Same console, different medium, so the
 * choice is stated as a material rather than a brightness preference. Persists,
 * because a player who chose paper meant it.
 */
export function SubstrateSwitch() {
  const [substrate, setSubstrate] = useState<"phosphor" |"newsprint" |"contrast" | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("crewkill.substrate");
    if (stored ==="phosphor" || stored ==="newsprint" || stored ==="contrast") {
      setSubstrate(stored);
      document.documentElement.dataset.substrate = stored;
    }
  }, []);

  const choose = (next:"phosphor" |"newsprint" |"contrast") => {
    setSubstrate(next);
    document.documentElement.dataset.substrate = next;
    localStorage.setItem("crewkill.substrate", next);
  };

  const active =
    substrate ??
    (typeof window !=="undefined" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
      ?"newsprint"
      :"phosphor");

  return (
    <div className="inline-flex" role="group" aria-label="Display substrate">
      {(["phosphor","newsprint","contrast"] as const).map((mode) => (
        <button
          key={mode}
          onClick={() => choose(mode)}
          aria-pressed={active === mode}
          className="switch"
          style={
            active === mode
              ? { background:"var(--color-line)", color:"var(--color-ink)" }
              : undefined
          }
        >
          {/* Named as materials, except the third, which is named for what it is for. */}
          {mode ==="phosphor" ?"CRT" : mode ==="newsprint" ?"Print" :"Contrast"}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="tele">{label}</div>
      <div className={`macro macro-sm mt-1 numeric ${tone ??""}`}>{value}</div>
    </div>
  );
}

const PHASE_LABEL: Record<number, string> = {
  [MatchPhase.Lobby]:"Lobby open",
  [MatchPhase.Playing]:"In play",
  [MatchPhase.Revealing]:"Reveal window",
  [MatchPhase.Settled]:"Settled",
  [MatchPhase.Aborted]:"Abandoned",
};

export function PhaseBadge({ match }: { match: MatchView }) {
  const live = match.phase === MatchPhase.Lobby || match.phase === MatchPhase.Playing;
  const detail =
    match.phase === MatchPhase.Playing && match.roundPhase
      ? `R${match.round}/${match.rounds} ${match.roundPhase}`
      : PHASE_LABEL[match.phase];
  return (
    <span className="inline-flex items-center gap-2  border border-[var(--color-line)] px-3 py-1 text-xs">
      <span
        className={`h-1.5 w-1.5  ${live ?"live-dot bg-[var(--color-signal)]" :"bg-[var(--color-dim)]"}`}
      />
      {detail}
    </span>
  );
}

/** Counts down to the keeper's next phase change. Starknet has no clock; this one does. */
export function Countdown({ until }: { until: string | null }) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!until) return;
    const tick = () =>
      setLeft(Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [until]);
  if (!until) return null;
  return <span className="tabular-nums text-[var(--color-amber)]">{left}s</span>;
}

export function SeatCard({
  seat,
  isYou,
  votes,
  onVote,
  onKill,
  disabled,
}: {
  seat: SeatView;
  isYou: boolean;
  votes: number;
  onVote?: () => void;
  onKill?: () => void;
  disabled?: boolean;
}) {
  const dead = !seat.alive;
  const role = seat.revealedRole;
  return (
    <div
      className={`relative  border p-3 transition ${
        dead
          ?"border-[var(--color-line)] bg-[var(--color-hull)] opacity-55"
          :"border-[var(--color-line)] bg-[var(--color-hull)]"
      } ${isYou ?"ring-1 ring-[var(--color-cyan)]" :""}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xl leading-none">{seat.emoji}</span>
          <div className="min-w-0">
            <div className="truncate text-sm">{seat.persona}</div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-dim)]">
              seat {seat.index}
              {seat.isAgent ?" agent" :""}
              {isYou ?" you" :""}
            </div>
          </div>
        </div>
        {votes > 0 && (
          <span className="bg-[var(--color-line)] px-1.5 py-0.5 text-[11px] tabular-nums">
            {votes}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2 text-[11px]">
        {dead ? (
          <span className="text-[var(--color-alarm)]">
            {seat.eliminatedBy ==="kill" ?"killed" :"ejected"} r{seat.eliminatedRound}
          </span>
        ) : (
          <span className="text-[var(--color-signal)]">alive</span>
        )}
        {role && (
          <span
            className={role ==="impostor" ?"text-[var(--color-alarm)]" :"text-[var(--color-cyan)]"}
          >
            {role}
          </span>
        )}
        {seat.payout && seat.payout !=="0" && (
          <span className="text-[var(--color-amber)]">paid</span>
        )}
      </div>

      {(onVote || onKill) && !dead && (
        <div className="mt-3 flex gap-2">
          {onVote && (
            <button
              onClick={onVote}
              disabled={disabled}
              className="flex-1  border border-[var(--color-line)] px-2 py-1 text-[11px] hover:border-[var(--color-cyan)] hover:text-[var(--color-cyan)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              vote
            </button>
          )}
          {onKill && (
            <button
              onClick={onKill}
              disabled={disabled}
              className="flex-1  border border-[var(--color-alarm)]/40 px-2 py-1 text-[11px] text-[var(--color-alarm)] hover:border-[var(--color-alarm)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              eliminate
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function EventLog({ match }: { match: MatchView }) {
  return (
    <div className="max-h-[26rem] space-y-1.5 overflow-y-auto pr-1 text-[13px] leading-relaxed">
      {match.events.length === 0 && (
        <p className="text-[var(--color-dim)]">Nothing has happened yet.</p>
      )}
      {[...match.events].reverse().map((event) => (
        <p key={event.id} className={eventTone(event.kind)}>
          <span className="mr-2 text-[10px] text-[var(--color-dim)]">
            {event.round > 0 ? `r${event.round}` :"-"}
          </span>
          {event.text}
        </p>
      ))}
    </div>
  );
}

function eventTone(kind: string): string {
  if (kind ==="body_found" || kind ==="ejected") return"text-[var(--color-alarm)]";
  if (kind ==="settled" || kind ==="match_started") return"text-[var(--color-amber)]";
  if (kind ==="chat") return"text-[var(--color-ink)]";
  return"text-[var(--color-dim)]";
}

export function Tallies({ match }: { match: MatchView }) {
  if (match.tallies.length === 0) {
    return (
      <p className="text-[13px] text-[var(--color-dim)]">
        No ballots spent yet. When they are, you will see counts - never who cast them.
      </p>
    );
  }
  const name = (seat: number) =>
    seat === NO_TARGET ?"skip" : (match.seats[seat]?.persona ?? `seat ${seat}`);
  return (
    <div className="space-y-3">
      {match.tallies.map((tally) => (
        <div key={tally.round}>
          <div className="mb-1 tele">
            round {tally.round}
          </div>
          <div className="space-y-1">
            {tally.targets
              .slice()
              .sort((a, b) => b.votes - a.votes)
              .map((target) => (
                <div key={target.seat} className="flex items-center gap-2 text-[13px]">
                  <span className="w-24 shrink-0 truncate">{name(target.seat)}</span>
                  <span
                    className="h-2  bg-[var(--color-cyan)]/60"
                    style={{ width: `${Math.min(100, target.votes * 22)}%` }}
                  />
                  <span className="tabular-nums text-[var(--color-dim)]">{target.votes}</span>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
