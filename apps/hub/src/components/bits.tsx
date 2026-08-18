"use client";

import { useState } from "react";

/**
 * Copies the full value, shows the short one.
 *
 * A contract address is unusable truncated and unreadable in full, so the page shows the
 * short form and this puts the real one on the clipboard. The confirmation is a state change
 * on the button itself rather than a toast, because a toast for an action this small is
 * noise, and the thing that needs confirming is this specific button.
 */
export function CopyButton({
  value,
  label,
  short,
}: {
  value: string;
  label: string;
  short: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      // Clipboard access is refused in some contexts and there is nothing to be done about
      // it from here. Saying so beats a button that silently does nothing.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label}`}
      className="fluid group inline-flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 font-mono text-xs hover:border-[var(--line-2)]"
    >
      <span className="text-[var(--text-dim)] group-hover:text-[var(--text)]">{short}</span>
      <span
        aria-live="polite"
        className="text-[10px] tracking-wide uppercase"
        style={{
          color:
            state === "copied"
              ? "var(--accent)"
              : state === "failed"
                ? "#f0a0a0"
                : "var(--text-mute)",
        }}
      >
        {state === "copied" ? "copied" : state === "failed" ? "blocked" : "copy"}
      </span>
    </button>
  );
}

/**
 * Three states, not two.
 *
 * Up and down are obvious. Unknown exists because a probe that failed to run is not the same
 * as a service that answered badly, and collapsing the two would make the status line lie in
 * exactly the situation where somebody is relying on it.
 */
export function StatusDot({ state, label }: { state: "up" | "down" | "unknown"; label: string }) {
  const colour =
    state === "up" ? "var(--accent)" : state === "down" ? "#e06c6c" : "var(--text-mute)";
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: colour, boxShadow: state === "up" ? `0 0 8px ${colour}` : undefined }}
      />
      <span className="text-xs" style={{ color: colour }}>
        {label}
      </span>
    </span>
  );
}
