"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * The console's voice.
 *
 * Synthesised rather than sampled: the whole point of the cabinet is that it is drawn
 * and generated rather than assembled from assets, and a handful of oscillators is both
 * smaller than one audio file and lets the pitch follow what actually happened — a win
 * rings higher the more it paid.
 *
 * Nothing is created until the first deliberate sound, because browsers refuse audio
 * before a gesture and a console that logs a warning on load is a console that looks
 * broken.
 */
type Voice = "fire" | "win" | "loss" | "tick" | "key" | "reject";

export function useSound(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, []);

  const ctx = useCallback(() => {
    if (!enabled) return null;
    if (!ctxRef.current) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return null;
      ctxRef.current = new C();
    }
    if (ctxRef.current.state === "suspended") void ctxRef.current.resume();
    return ctxRef.current;
  }, [enabled]);

  /** One note. `bend` sweeps the pitch over the life of the note. */
  const note = useCallback(
    (
      c: AudioContext,
      freq: number,
      duration: number,
      type: OscillatorType,
      gain: number,
      delay = 0,
      bend?: number,
    ) => {
      const t0 = c.currentTime + delay;
      const osc = c.createOscillator();
      const amp = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (bend !== undefined) osc.frequency.exponentialRampToValueAtTime(bend, t0 + duration);

      // A short attack and an exponential tail: square waves clipped hard sound like a
      // click rather than a note.
      amp.gain.setValueAtTime(0.0001, t0);
      amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

      osc.connect(amp).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    },
    [],
  );

  /**
   * @param intensity 0..1, used where the sound should reflect magnitude — a bigger
   *                  win is a brighter chord, not just a louder one.
   */
  return useCallback(
    (voice: Voice, intensity = 0.5) => {
      const c = ctx();
      if (!c) return;
      const k = Math.max(0, Math.min(1, intensity));

      switch (voice) {
        case "fire":
          // A downward thunk: the key travelling.
          note(c, 320, 0.09, "square", 0.06, 0, 140);
          break;
        case "win": {
          // Rising triad, opening up with the size of the win.
          const root = 520 + k * 160;
          note(c, root, 0.1, "triangle", 0.07);
          note(c, root * 1.26, 0.1, "triangle", 0.06, 0.06);
          note(c, root * 1.5, 0.18, "triangle", 0.07, 0.12);
          break;
        }
        case "loss":
          note(c, 200, 0.16, "sawtooth", 0.04, 0, 120);
          break;
        case "reject":
          // Two flat blips — a machine saying no, not a sad trombone.
          note(c, 180, 0.05, "square", 0.05);
          note(c, 180, 0.05, "square", 0.05, 0.09);
          break;
        case "key":
          note(c, 900, 0.025, "square", 0.025);
          break;
        case "tick":
          note(c, 1400, 0.012, "square", 0.012);
          break;
      }
    },
    [ctx, note],
  );
}
