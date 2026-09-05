"use client";

import { commitmentOf, type PositionSecret } from "@molfi/sdk";

/**
 * The positions this browser knows about.
 *
 * There is no other way to know them. The chain stores a Poseidon commitment and nothing
 * that identifies who is behind it — that is the entire product — so a position is only
 * findable by whoever holds its preimage. `ticketsOf(account)` has no counterpart here and
 * cannot have one.
 *
 * Which makes this store the weak point, and it is worth being blunt about: clear the
 * browser's storage without the exported file and the payout is unreachable, by the holder
 * and by everyone else. So every position is offered as a download at the moment it is
 * created, and this store is a convenience on top of that rather than the record of truth.
 */

const KEY = "molfi.positions.v1";

export interface StoredPosition extends PositionSecret {
  commitment: string;
  /** The market pair, kept so a position can be shown without a chain read. */
  pair: string;
  /** Round length in seconds, for display. */
  seconds: number;
  stake: string;
  openedAt: number;
  txHash?: string;
  /** Set once the payout has been claimed, so the list stops offering the button. */
  claimedTxHash?: string;
}

type Listener = (positions: StoredPosition[]) => void;
const listeners = new Set<Listener>();

function read(): StoredPosition[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    // Bands are bigints and JSON has no bigints, so they round-trip as strings.
    return parsed.map((p) => ({
      ...(p as unknown as StoredPosition),
      bandLow: BigInt(String(p.bandLow)),
      bandHigh: BigInt(String(p.bandHigh)),
    }));
  } catch {
    // A corrupt store must not take the app down with it. Losing the index is bad; losing
    // the ability to open the page and export what is left is worse.
    return [];
  }
}

function write(positions: StoredPosition[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify(
        positions.map((p) => ({
          ...p,
          bandLow: p.bandLow.toString(),
          bandHigh: p.bandHigh.toString(),
        })),
      ),
    );
  } catch {
    // Quota, or a private window that refuses storage. The download is still the record.
  }
  for (const l of listeners) l(positions);
}

export function allPositions(): StoredPosition[] {
  return read();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function remember(
  secret: PositionSecret,
  meta: { pair: string; seconds: number; stake: bigint; txHash?: string },
): StoredPosition {
  const entry: StoredPosition = {
    ...secret,
    commitment: commitmentOf(secret),
    pair: meta.pair,
    seconds: meta.seconds,
    stake: meta.stake.toString(),
    openedAt: Math.floor(Date.now() / 1000),
    txHash: meta.txHash,
  };
  write([...read(), entry]);
  return entry;
}

export function markClaimed(commitment: string, txHash: string): void {
  write(read().map((p) => (p.commitment === commitment ? { ...p, claimedTxHash: txHash } : p)));
}

export function forget(commitment: string): void {
  write(read().filter((p) => p.commitment !== commitment));
}

/**
 * The file that is the actual record.
 *
 * A download rather than a copy button. A clipboard survives until the next copy; this is
 * the only route to the payout and it has to outlive the tab.
 */
export function exportPosition(p: StoredPosition, extra: Record<string, unknown> = {}): void {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          note: "This file is the only way to claim this molfi position. Nobody can recover it for you — not molfi, not the pool.",
          ...extra,
          pair: p.pair,
          marketId: p.marketId,
          roundSeconds: p.seconds,
          secret: p.secret,
          bandLow: p.bandLow.toString(),
          bandHigh: p.bandHigh.toString(),
          commitment: p.commitment,
          stake: p.stake,
          openedAt: new Date(p.openedAt * 1000).toISOString(),
          txHash: p.txHash,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `molfi-${p.pair.replace("/", "-")}-${p.commitment.slice(2, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Restore a position from a previously exported file. */
export function importPosition(json: string): StoredPosition {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const secret: PositionSecret = {
    secret: String(raw.secret),
    marketId: Number(raw.marketId),
    bandLow: BigInt(String(raw.bandLow)),
    bandHigh: BigInt(String(raw.bandHigh)),
  };
  const commitment = commitmentOf(secret);
  // Recomputed, never trusted from the file. A commitment that does not match its own
  // preimage means the file was edited or truncated, and importing it would put a position
  // in the list that can never be claimed.
  if (raw.commitment && String(raw.commitment) !== commitment) {
    throw new Error("This file's commitment does not match its secret; it has been altered.");
  }
  const entry: StoredPosition = {
    ...secret,
    commitment,
    pair: String(raw.pair ?? "unknown"),
    seconds: Number(raw.roundSeconds ?? 0),
    stake: String(raw.stake ?? "0"),
    openedAt: raw.openedAt ? Math.floor(Date.parse(String(raw.openedAt)) / 1000) : 0,
    txHash: raw.txHash ? String(raw.txHash) : undefined,
  };
  const existing = read();
  if (!existing.some((p) => p.commitment === commitment)) write([...existing, entry]);
  return entry;
}
