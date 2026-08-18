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
  settled: number | null;
  seatsFilled: number | null;
  potTotal: string | null;
  transactions: number | null;
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

/**
 * Real totals from the keeper.
 *
 * These come from /api/stats, which aggregates over every row in the deployment. The first
 * version of this summed /api/matches instead, and that endpoint returns the latest 25 - so
 * the hub confidently printed "25 matches recorded" and would have kept printing 25 after
 * the thousandth match. A number that cannot move is not a measurement.
 *
 * If the keeper is unreachable the fields stay null and the page says it could not reach it,
 * which is why this returns a reachable flag rather than zeroes. Zero and unknown look
 * identical in a stat block and mean opposite things.
 */
export async function keeperStats(): Promise<KeeperStats> {
  const empty: KeeperStats = {
    reachable: false,
    network: null,
    block: null,
    matches: null,
    settled: null,
    seatsFilled: null,
    potTotal: null,
    transactions: null,
    detail: "keeper unreachable",
  };

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 5000);
  try {
    const [healthRes, statsRes] = await Promise.all([
      fetch(`${KEEPER_URL}/health`, { signal: abort.signal, cache: "no-store" }),
      fetch(`${KEEPER_URL}/api/stats`, { signal: abort.signal, cache: "no-store" }),
    ]);
    if (!healthRes.ok || !statsRes.ok) {
      return { ...empty, detail: `keeper returned ${healthRes.status}/${statsRes.status}` };
    }

    const health = (await healthRes.json()) as { network?: string; block?: number };
    const stats = (await statsRes.json()) as {
      matches?: number;
      settled?: number;
      seatsFilled?: number;
      potTotal?: string;
      transactions?: number;
    };

    return {
      reachable: true,
      network: health.network ?? null,
      block: health.block ?? null,
      matches: stats.matches ?? null,
      settled: stats.settled ?? null,
      seatsFilled: stats.seatsFilled ?? null,
      potTotal: stats.potTotal ?? null,
      transactions: stats.transactions ?? null,
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

export interface DeploymentRow {
  id: number;
  network: string;
  gameAddress: string;
  ballotAddress: string;
  live: boolean;
  matches: number;
  settled: number;
  transactions: number;
  firstSeen: string;
}

/**
 * Every deployment the keeper has recorded, live and retired.
 *
 * Returns an empty list rather than throwing when the keeper is down, and the page says so
 * separately - an empty history and an unreachable keeper are different facts.
 */
export async function deployments(): Promise<DeploymentRow[] | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 5000);
  try {
    const res = await fetch(`${process.env.KEEPER_URL ?? "http://localhost:8080"}/api/deployments`, {
      signal: abort.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as DeploymentRow[];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
