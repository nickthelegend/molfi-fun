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
  reducedMotion: boolean;
  /** Market the desk opens on. */
  market: string;
  /** Round tier the desk opens on. */
  tier: number;
  /** Console shell colour. */
  theme: "cream" | "charcoal" | "mint" | "rose";
  /** Show the Kuru book panel alongside the chart. */
  showBook: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  sound: false,
  reducedMotion: false,
  market: "BTC",
  tier: 2,
  theme: "cream",
  showBook: false,
};

const KEY = "xorr.prefs.v1";

function read(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULT_PREFS, ...parsed };
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
  cream: {
    "--color-shell": "#f7efc2",
    "--color-shell-hi": "#fbf6d6",
    "--color-shell-lo": "#efe4b0",
    "--color-shell-dark": "#e6dca6",
    "--color-shell-edge": "#cfc48c",
    "--color-key": "#9b8cf0",
    "--color-cap": "#f0e7bd",
    "--color-cap-hi": "#ffffff",
    "--color-ink": "rgba(0,0,0,0.55)",
  },
  charcoal: {
    "--color-shell": "#3a3a3c",
    "--color-shell-hi": "#4a4a4d",
    "--color-shell-lo": "#2e2e30",
    "--color-shell-dark": "#2a2a2c",
    "--color-shell-edge": "#1e1e20",
    "--color-key": "#8f7fe8",
    "--color-cap": "#4e4e51",
    "--color-cap-hi": "#6b6b6f",
    "--color-ink": "rgba(255,255,255,0.6)",
  },
  mint: {
    "--color-shell": "#cfe8d5",
    "--color-shell-hi": "#e0f2e4",
    "--color-shell-lo": "#bcd9c3",
    "--color-shell-dark": "#b3d2ba",
    "--color-shell-edge": "#96bb9f",
    "--color-key": "#7fa8f0",
    "--color-cap": "#c2ddc9",
    "--color-cap-hi": "#e8f5eb",
    "--color-ink": "rgba(0,0,0,0.55)",
  },
  rose: {
    "--color-shell": "#f0d3d8",
    "--color-shell-hi": "#f8e3e7",
    "--color-shell-lo": "#e3bfc6",
    "--color-shell-dark": "#d9b6bd",
    "--color-shell-edge": "#bf979f",
    "--color-key": "#a88cf0",
    "--color-cap": "#e6c6cc",
    "--color-cap-hi": "#faeaed",
    "--color-ink": "rgba(0,0,0,0.55)",
  },
};

/** Paint the chosen cabinet onto the document. */
export function useApplyTheme(theme: Prefs["theme"]) {
  useEffect(() => {
    const root = document.documentElement;
    const vars = THEME_VARS[theme] ?? THEME_VARS.cream;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  }, [theme]);
}
