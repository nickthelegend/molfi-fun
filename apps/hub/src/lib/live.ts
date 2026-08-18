/**
 * Asks each game whether it is actually up, and what it has been doing.
 *
 * A hub that links to two games and cannot tell you whether either of them is running is
 * a directory, not a hub. Worse, a dead link on a landing page during judging looks like
 * the project is broken even when only one service is. So every game card carries a status
 * that came from a real request, and a service that is down says so instead of pretending.
 */

export type Health = "up" | "down" | "unknown";

export interface GameStatus {
  slug: string;
  url: string;
  health: Health;
  /** Round trip in milliseconds, when the probe succeeded. */
  latencyMs: number | null;
  detail: string;
}

/** Counts pulled from the keeper's own database, not from anything this page keeps. */
export interface KeeperStats {
  reachable: boolean;
  network: string | null;
  block: number | null;
  matches: number | null;
  seatsFilled: number | null;
  potTotal: string | null;
  detail: string;
}

const KEEPER_URL = process.env.KEEPER_URL ?? "http://localhost:8080";

export const GAME_URLS: Record<string, string> = {
  crewkill: process.env.CREWKILL_URL ?? "http://localhost:3100",
  poker: process.env.POKER_URL ?? "http://localhost:3300",
};

async function timed(url: string, timeoutMs = 4000): Promise<{ ok: boolean; ms: number; status: number | null; detail: string }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(url, { signal: abort.signal, cache: "no-store" });
    const ms = Math.round(performance.now() - started);
    return {
      ok: res.ok,
      ms,
      status: res.status,
      detail: res.ok ? `responded ${res.status} in ${ms}ms` : `responded ${res.status}`,
    };
  } catch (err) {
    const ms = Math.round(performance.now() - started);
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      ms,
      status: null,
      detail: aborted ? `no response within ${timeoutMs}ms` : "could not be reached",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Probes both game front ends in parallel. */
export async function gameStatuses(): Promise<GameStatus[]> {
  const entries = Object.entries(GAME_URLS);
  return Promise.all(
    entries.map(async ([slug, url]): Promise<GameStatus> => {
      const probe = await timed(url);
      return {
        slug,
        url,
        health: probe.ok ? "up" : "down",
        latencyMs: probe.ok ? probe.ms : null,
        detail: probe.detail,
      };
    }),
  );
}

interface MatchRow {
  potAmount?: string;
  seatsFilled?: number;
}

/**
 * Real totals from the keeper.
 *
 * Every number here is a sum over rows the keeper has actually written. If the keeper is
 * unreachable the fields stay null and the page prints that it could not reach it, which is
 * the whole reason this returns a reachable flag rather than zeroes. Zero and unknown look
 * identical in a stat block and mean completely different things.
 */
export async function keeperStats(): Promise<KeeperStats> {
  const empty: KeeperStats = {
    reachable: false,
    network: null,
    block: null,
    matches: null,
    seatsFilled: null,
    potTotal: null,
    detail: "keeper unreachable",
  };

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 5000);
  try {
    const [healthRes, matchesRes] = await Promise.all([
      fetch(`${KEEPER_URL}/health`, { signal: abort.signal, cache: "no-store" }),
      fetch(`${KEEPER_URL}/api/matches`, { signal: abort.signal, cache: "no-store" }),
    ]);
    if (!healthRes.ok || !matchesRes.ok) {
      return { ...empty, detail: `keeper returned ${healthRes.status}/${matchesRes.status}` };
    }

    const health = (await healthRes.json()) as { network?: string; block?: number };
    const payload = (await matchesRes.json()) as { matches?: MatchRow[] } | MatchRow[];
    const rows: MatchRow[] = Array.isArray(payload) ? payload : (payload.matches ?? []);

    // Pots are felt-unit integers wider than a JS number stays exact at, so they are summed
    // as bigint and only turned into text at the end.
    let pot = 0n;
    let seats = 0;
    for (const row of rows) {
      if (row.potAmount) {
        try {
          pot += BigInt(row.potAmount);
        } catch {
          // A row whose pot will not parse is skipped rather than allowed to poison the sum.
        }
      }
      seats += row.seatsFilled ?? 0;
    }

    return {
      reachable: true,
      network: health.network ?? null,
      block: health.block ?? null,
      matches: rows.length,
      seatsFilled: seats,
      potTotal: pot.toString(),
      detail: "read from the keeper",
    };
  } catch {
    return empty;
  } finally {
    clearTimeout(timer);
  }
}

/** Felt units to STRK, for display. Six decimals is what the stake token uses. */
export function toStrk(raw: string | null, decimals = 6): string | null {
  if (raw === null) return null;
  try {
    const value = BigInt(raw);
    const base = 10n ** BigInt(decimals);
    const whole = value / base;
    const frac = value % base;
    if (frac === 0n) return whole.toLocaleString("en-US");
    const fracText = frac.toString().padStart(decimals, "0").replace(/0+$/, "").slice(0, 2);
    return `${whole.toLocaleString("en-US")}.${fracText}`;
  } catch {
    return null;
  }
}
