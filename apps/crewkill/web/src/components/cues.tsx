"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One short tone when the round changes.
 *
 * A phase change is the only moment in CrewKill where something happens to you rather than
 * because of you: night falls, a meeting is called, a vote closes. Those are exactly the
 * moments a player who has looked away needs told about, and a colour change on a panel does
 * not do that.
 *
 * Muted by default and remembered, because sound that arrives uninvited is worse than no
 * sound. Synthesised rather than loaded, so there is no audio file to ship, no request to
 * fail, and no licence to worry about.
 */
type Cue = "night" | "meeting" | "voting" | "settled";

/** Frequency, duration and shape per cue. Low and short for night, higher and urgent for a meeting. */
const CUES: Record<Cue, { hz: number; ms: number; type: OscillatorType }> = {
  night: { hz: 180, ms: 260, type: "sine" },
  meeting: { hz: 520, ms: 180, type: "square" },
  voting: { hz: 360, ms: 200, type: "triangle" },
  settled: { hz: 660, ms: 340, type: "sine" },
};

const STORAGE_KEY = "crewkill.cues";

export function useCues(phaseKey: string | null) {
  const [enabled, setEnabled] = useState(false);
  const context = useRef<AudioContext | null>(null);
  const last = useRef<string | null>(null);

  // Restore the preference before anything can play.
  useEffect(() => {
    try {
      setEnabled(window.localStorage.getItem(STORAGE_KEY) === "on");
    } catch {
      // Storage can be blocked entirely. Defaulting to silence is the safe direction.
    }
  }, []);

  useEffect(() => {
    if (!enabled || !phaseKey) {
      last.current = phaseKey;
      return;
    }
    // Only on a change, and never on the first observation after enabling — otherwise
    // turning sound on plays a cue for a phase that started minutes ago.
    if (last.current === null || last.current === phaseKey) {
      last.current = phaseKey;
      return;
    }
    last.current = phaseKey;

    const cue = CUES[phaseKey.split(":")[0] as Cue];
    if (!cue) return;

    try {
      context.current ??= new AudioContext();
      const ctx = context.current;
      // Browsers suspend a context created before a gesture. Resuming is a no-op otherwise.
      void ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = cue.type;
      osc.frequency.value = cue.hz;
      // Ramped rather than switched, because an abrupt start and stop is a click.
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + cue.ms / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + cue.ms / 1000);
    } catch {
      // No audio device, or a policy that forbids it. Silence is an acceptable outcome.
    }
  }, [enabled, phaseKey]);

  const toggle = () => {
    setEnabled((was) => {
      const next = !was;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
      } catch {
        // Not being able to remember the choice does not stop it applying this session.
      }
      return next;
    });
  };

  return { enabled, toggle };
}

/** The control. Says what it does, and what it will not do. */
export function CueToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={enabled}
      className="switch"
      title={
        enabled
          ? "A short tone when the round changes. Click to silence."
          : "Silent. Click for a short tone when the round changes."
      }
    >
      {enabled ? "SOUND ON" : "SOUND OFF"}
    </button>
  );
}
