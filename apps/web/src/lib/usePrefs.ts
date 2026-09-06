"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Player preferences, persisted per browser.
 *
 * These are viewer-local by nature — a sound toggle is not something to put on a chain
 * or in a shared table. What matters is that they survive a reload and that every
 * setting here actually changes behaviour; a settings screen full of switches that do
 * nothing is worse than no settings screen.
 */
export interface Prefs {
  sound: boolean;
  /** Output level, 0–1. Lives beside `sound` because the rail that sets it sits beside the key. */
  volume: number;
  reducedMotion: boolean;
  /** Market the desk opens on. */
  market: string;
  /** Round tier the desk opens on. */
  tier: number;
  /** Console shell colour. Four graphites — the body never competes with the glass. */
  theme: "graphite" | "gunmetal" | "olive" | "oxblood";
  /** Show the oracle strip alongside the chart. */
  showOracle: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  sound: false,
  volume: 0.7,
  reducedMotion: false,
  market: "BTC",
  tier: 0,
  theme: "graphite",
  showOracle: false,
};

const KEY = "xorr.prefs.v1";

function read(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const merged = { ...DEFAULT_PREFS, ...parsed };
    // The cream cabinets were repainted graphite and their ids went with them. A stored
    // "cream" would otherwise survive as a theme nothing can render and nothing can select.
    if (!(merged.theme in THEME_VARS)) merged.theme = DEFAULT_PREFS.theme;
    if (!Number.isFinite(merged.volume)) merged.volume = DEFAULT_PREFS.volume;
    merged.volume = Math.max(0, Math.min(1, merged.volume));
    return merged;
  } catch {
    // A private window, cleared storage, or a browser refusing site data. Defaults are
    // a correct answer here, so there is nothing to report.
    return DEFAULT_PREFS;
  }
}

/** Broadcast within the tab, since `storage` only fires in *other* tabs. */
const EVENT = "xorr:prefs";

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  /**
   * Stored values arrive one tick after mount, because reading them during render
   * would not match what the server rendered. Anything that acts on a preference —
   * which market the desk opens on, which round — has to wait for this, or it will act
   * on the defaults and never look again.
   */
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setPrefs(read());
    setLoaded(true);
    const sync = () => setPrefs(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const set = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((p) => {
      const next = { ...p, [key]: value };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage refused; the change still applies for this session */
      }
      window.dispatchEvent(new Event(EVENT));
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* nothing to clear */
    }
    setPrefs(DEFAULT_PREFS);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { prefs, set, reset, loaded };
}

/**
 * Honour the operating system's own reduced-motion setting as a floor.
 *
 * Someone who has asked their machine to stop animating things should not have to find
 * the switch again in here.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(q.matches);
    const on = () => setReduced(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * The four cabinet colourways, as CSS variable sets.
 *
 * Only the body changes. The screen, the amber readout and every signal colour are
 * absent from these on purpose — those carry the price, and a theme that dimmed them
 * would be a worse console rather than a personalised one.
 */
export const THEME_VARS: Record<Prefs["theme"], Record<string, string>> = {
  graphite: {
    "--color-shell": "#2e3138",
    "--color-shell-hi": "#3d4049",
    "--color-shell-lo": "#242629",
    "--color-shell-dark": "#1b1d21",
    "--color-shell-edge": "#0f1013",
    "--color-cap": "#343840",
    "--color-cap-hi": "#4d515b",
    "--color-ink": "rgba(255,255,255,0.62)",
  },
  gunmetal: {
    "--color-shell": "#33363b",
    "--color-shell-hi": "#44484e",
    "--color-shell-lo": "#26282c",
    "--color-shell-dark": "#1c1e21",
    "--color-shell-edge": "#101214",
    "--color-cap": "#3a3e44",
    "--color-cap-hi": "#565b62",
    "--color-ink": "rgba(255,255,255,0.62)",
  },
  olive: {
    "--color-shell": "#2f342c",
    "--color-shell-hi": "#3e453a",
    "--color-shell-lo": "#252a23",
    "--color-shell-dark": "#1a1e19",
    "--color-shell-edge": "#0e110d",
    "--color-cap": "#353b32",
    "--color-cap-hi": "#4e5649",
    "--color-ink": "rgba(255,255,255,0.62)",
  },
  oxblood: {
    "--color-shell": "#36292b",
    "--color-shell-hi": "#463639",
    "--color-shell-lo": "#2b2123",
    "--color-shell-dark": "#1f1719",
    "--color-shell-edge": "#120c0d",
    "--color-cap": "#3d2f31",
    "--color-cap-hi": "#574346",
    "--color-ink": "rgba(255,255,255,0.62)",
  },
};

/** Paint the chosen cabinet onto the document. */
export function useApplyTheme(theme: Prefs["theme"]) {
  useEffect(() => {
    const root = document.documentElement;
    const vars = THEME_VARS[theme] ?? THEME_VARS.graphite;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  }, [theme]);
}
