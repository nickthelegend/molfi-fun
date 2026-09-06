"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { fetchJson } from "@/lib/fetchJson";

type Keeper = {
  /** False when this deployment has no keeper URL at all — nothing to report on. */
  configured: boolean;
  reachable: boolean;
  ok: boolean;
  cycles: number;
  lagMs: number;
  cycleSeconds: number;
  balance: string | null;
  stoppedListing: string | null;
  lastError: string | null;
};

/**
 * Whether the thing that keeps this market alive is alive, on every page.
 *
 * Continuous operation is the differentiator and it was visible on exactly one page nobody
 * navigates to. A market that settles itself every fifteen minutes without anyone watching
 * is the claim; a badge that goes red when that stops is what makes the claim checkable
 * rather than decorative — which is also why it reports trouble instead of hiding it.
 *
 * Not shown on the console: the device is the app there, and a floating pill over it is
 * exactly the kind of web chrome the whole design refuses.
 */
export function KeeperBadge() {
  const path = usePathname();
  const [k, setK] = useState<Keeper | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (path?.startsWith("/play")) return;
    let alive = true;
    const read = () =>
      fetchJson<Keeper>("/api/keeper")
        .then((d) => alive && (setK(d), setFailed(false)))
        .catch(() => alive && setFailed(true));
    void read();
    const id = setInterval(read, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [path]);

  if (path?.startsWith("/play")) return null;
  // A deployment with no keeper configured has no keeper to be down. Reporting "STOPPED"
  // there is a red light for a machine that was never switched on.
  if (k && !k.configured) return null;

  /**
   * Three states, and the middle one is the point.
   *
   * "Running" and "unreachable" are easy. A keeper that answers, reports no error, and has
   * quietly stopped listing because it ran out of STRK is the failure that looks like
   * health — so it gets its own colour and says what stopped.
   */
  const late = k ? k.lagMs > k.cycleSeconds * 1000 * 3 : false;
  const tone = !k || failed || !k.reachable || late
    ? { dot: "#e8453c", text: "STOPPED" }
    : k.stoppedListing || k.lastError
      ? { dot: "#ff9f0a", text: "DEGRADED" }
      : { dot: "#3ddc84", text: "RUNNING" };

  const detail = failed || !k
    ? "the keeper did not answer"
    : late
      ? `last cycle ${Math.round(k.lagMs / 1000)}s ago, on a ${k.cycleSeconds}s loop`
      : k.stoppedListing
        ? "answering, but no longer listing rounds"
        : k.lastError
          ? k.lastError
          : `${k.cycles} cycles${
              // Unknown is not zero: a balance the status route could not read must not
              // print as "0.00 STRK left" next to a green light.
              k.balance ? `, ${(Number(k.balance) / 1e18).toFixed(2)} STRK left` : ""
            }`;

  return (
    <Link
      href="/keeper"
      title={`Keeper: ${detail}`}
      className="mono fixed bottom-3 left-3 z-40 flex items-center gap-2 rounded-full border border-white/8 bg-black/80 px-3 py-2 text-[9px] tracking-[0.12em] text-white/45 backdrop-blur transition-colors hover:text-white/75"
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-[1px]"
        style={{ background: tone.dot, boxShadow: `0 0 6px ${tone.dot}cc` }}
      />
      KEEPER {tone.text}
    </Link>
  );
}
