"use client";

import { useEffect, useState } from "react";
import type { ActivityRow } from "@/lib/live";

/**
 * A heartbeat, from real events.
 *
 * The stat strip can say six contracts are live and thousands of transactions were signed,
 * and both are true and neither is a pulse. A line saying a match settled forty seconds ago
 * is the difference between a site that describes a system and a site attached to one.
 *
 * Every row came out of the keeper's event log, which is written as matches run. Nothing here
 * is generated to fill the space, so an empty ticker means nothing has happened yet and says
 * exactly that.
 */
export function Ticker({ rows }: { rows: ActivityRow[] | null }) {
  // Rendered on the server first, so the relative time has to settle on the client or the
  // markup mismatches. Starting null and filling in on mount keeps hydration clean.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  if (rows === null) {
    return (
      <p className="text-sm text-[var(--text-mute)]">
        The activity feed lives in the keeper and it could not be reached. That is the service
        being down, not the games being quiet.
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--text-mute)]">
        Nothing has happened on this deployment yet. The first line appears the moment a lobby
        opens.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[var(--line)]">
      {rows.slice(0, 8).map((row) => (
        <li key={row.id} className="flex items-baseline gap-3 py-2.5">
          <span
            aria-hidden
            className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: toneFor(row.kind) }}
          />
          <span className="font-mono text-xs text-[var(--text-mute)]">#{row.matchId}</span>
          <span className="min-w-0 flex-1 text-sm text-[var(--text-dim)]">{row.text}</span>
          <span className="shrink-0 font-mono text-xs text-[var(--text-mute)]">
            {now === null ? "" : ago(now, row.at)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Settlements are the payload; everything else is context. */
function toneFor(kind: string): string {
  if (kind === "settled") return "var(--accent)";
  if (kind === "match_created") return "var(--text-mute)";
  return "var(--line-2)";
}

function ago(now: number, iso: string): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}
