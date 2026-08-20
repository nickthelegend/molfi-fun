"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Preferences, behind one button.
 *
 * The header used to lay out twelve controls in a flat row - phase, timer, primer, archive,
 * three substrate buttons, sound, wallet - all at the same visual weight, above a second bar
 * advertising the hub. You met the game through a dev toolbar.
 *
 * Only two of those decide anything during play: what phase it is and how long is left.
 * Everything else is a preference you set once, so it lives here and the game gets the top
 * of the screen back.
 */
export function SettingsMenu({
  substrate,
  onSubstrate,
  cuesEnabled,
  onCues,
  onPrimer,
}: {
  substrate: string;
  onSubstrate: (mode: "phosphor" | "newsprint" | "contrast" | "default") => void;
  cuesEnabled: boolean;
  onCues: () => void;
  onPrimer: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function away(event: MouseEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const modes: Array<{ id: "default" | "phosphor" | "newsprint" | "contrast"; label: string; hint: string }> = [
    { id: "default", label: "Standard", hint: "The ship as designed" },
    { id: "phosphor", label: "CRT", hint: "Green phosphor, scanlines" },
    { id: "newsprint", label: "Print", hint: "Paper, for screenshots" },
    { id: "contrast", label: "High contrast", hint: "Maximum legibility" },
  ];

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="switch flex items-center gap-1.5"
        title="Display, sound and help"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M8 1.6v1.8M8 12.6v1.8M14.4 8h-1.8M3.4 8H1.6M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3M12.5 12.5l-1.3-1.3M4.8 4.8L3.5 3.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        Settings
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1.5 w-60 border border-[var(--color-line)] bg-[var(--color-panel)] p-3 shadow-2xl"
        >
          <p className="tele mb-2">Look</p>
          <div className="space-y-1">
            {modes.map((mode) => {
              const active = substrate === mode.id || (mode.id === "default" && !substrate);
              return (
                <button
                  key={mode.id}
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => onSubstrate(mode.id)}
                  className="flex w-full items-start gap-2 px-1.5 py-1 text-left hover:bg-[var(--color-hull)]"
                >
                  <span
                    className="mt-1 h-1.5 w-1.5 shrink-0"
                    style={{ background: active ? "var(--color-cyan)" : "var(--color-line)" }}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block text-[12px] text-[var(--color-ink)]">{mode.label}</span>
                    <span className="block text-[10px] text-[var(--color-dim)]">{mode.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="my-3 h-px bg-[var(--color-line)]" />

          <button
            role="menuitemcheckbox"
            aria-checked={cuesEnabled}
            onClick={onCues}
            className="flex w-full items-center justify-between px-1.5 py-1 hover:bg-[var(--color-hull)]"
          >
            <span className="text-[12px] text-[var(--color-ink)]">Sound cues</span>
            <span
              className="text-[10px] uppercase tracking-wider"
              style={{ color: cuesEnabled ? "var(--color-cyan)" : "var(--color-dim)" }}
            >
              {cuesEnabled ? "on" : "off"}
            </span>
          </button>

          <div className="my-3 h-px bg-[var(--color-line)]" />

          <button
            onClick={() => {
              onPrimer();
              setOpen(false);
            }}
            className="block w-full px-1.5 py-1 text-left text-[12px] text-[var(--color-ink)] hover:bg-[var(--color-hull)]"
          >
            How this game works
          </button>
          <a
            href="/history"
            className="block px-1.5 py-1 text-[12px] text-[var(--color-ink)] no-underline hover:bg-[var(--color-hull)]"
          >
            Past matches
          </a>
          <a
            href="/verify"
            className="block px-1.5 py-1 text-[12px] text-[var(--color-ink)] no-underline hover:bg-[var(--color-hull)]"
          >
            Verify a match
          </a>

          <div className="my-3 h-px bg-[var(--color-line)]" />

          {/* The hub, stated once, quietly, where it belongs — not as a bar above the game. */}
          <a
            href="https://molfi.fun"
            className="block px-1.5 py-1 text-[11px] text-[var(--color-dim)] no-underline hover:text-[var(--color-ink)]"
          >
            More games at molfi.fun ↗
          </a>
        </div>
      )}
    </div>
  );
}
