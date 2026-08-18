import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/chrome";
import { CopyButton, StatusDot } from "@/components/bits";
import { contractStatuses, shortHex, VOYAGER } from "@/lib/chain";
import { gameStatuses, GAME_URLS } from "@/lib/live";

export const metadata: Metadata = {
  title: "Poker — molfi.fun",
  description:
    "Texas Hold'em with no dealer and no server. The players shuffle and deal between themselves, and the deal is proved correct rather than trusted.",
};

export const dynamic = "force-dynamic";

/** The four steps a hand actually goes through, in the order the contracts enforce them. */
const DEAL: Array<{ step: string; what: string; who: string }> = [
  {
    step: "Key setup",
    what: "Every player contributes a share, and the shares combine into one table key.",
    who: "KeyAggregator",
  },
  {
    step: "Shuffle",
    what: "Each player shuffles the encrypted deck in turn and proves they permuted it without reading it.",
    who: "ShuffleVerifier",
  },
  {
    step: "Deal",
    what: "Cards go out still sealed. Nobody, including whoever is hosting, can read one.",
    who: "PokerTable",
  },
  {
    step: "Reveal",
    what: "A card opens only when enough players hand over reveal tokens for it, and the opening is checked.",
    who: "DecryptVerifier",
  },
];

export default async function PokerPage() {
  const [statuses, contracts] = await Promise.all([gameStatuses(), contractStatuses()]);

  const service = statuses.find((s) => s.slug === "poker");
  const own = contracts.filter((c) =>
    ["PokerTable", "ShuffleVerifier", "DecryptVerifier", "KeyAggregator"].includes(c.name),
  );
  const liveCount = own.filter((c) => c.live === true).length;

  return (
    <>
      <SiteHeader current="/poker" />

      <main id="main" className="mx-auto max-w-5xl px-6 pt-16 pb-24">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-[var(--text-dim)]">Texas Hold&apos;em</p>
          <span className="h-3 w-px bg-[var(--line-2)]" aria-hidden />
          <StatusDot
            state={service?.health ?? "unknown"}
            label={service?.health === "up" ? "table responding" : (service?.detail ?? "unknown")}
          />
        </div>

        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Poker</h1>

        <p className="mt-6 max-w-[660px] text-lg text-[var(--text-dim)]">
          No dealer and no server holding the deck. The players shuffle and deal between
          themselves, and every step is proved rather than trusted. Two to nine seats.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href={GAME_URLS.poker}
            className="fluid rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black no-underline hover:bg-[var(--accent)]"
          >
            Open the table
          </a>
        </div>

        {/* ── The deal, step by step ─────────────────────────────────────────────── */}
        <h2 className="mt-16 text-2xl font-semibold tracking-tight">How a hand is dealt</h2>
        <p className="mt-3 max-w-[620px] text-[var(--text-dim)]">
          The interesting problem in online poker is that somebody normally has to hold the
          deck. Here nobody does, and each step names the contract that checks it.
        </p>

        <ol className="mt-8 space-y-px overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--line)]">
          {DEAL.map((row, i) => (
            <li key={row.step} className="bg-[var(--surface)] p-5">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-mono text-sm text-[var(--text-mute)]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-semibold">{row.step}</span>
                <span className="font-mono text-xs text-[var(--accent)]">{row.who}</span>
              </div>
              <p className="mt-2 max-w-[620px] text-sm text-[var(--text-dim)]">{row.what}</p>
            </li>
          ))}
        </ol>

        {/* ── Its contracts ──────────────────────────────────────────────────────── */}
        <h2 className="mt-16 text-2xl font-semibold tracking-tight">Its contracts</h2>
        <p className="mt-3 text-[var(--text-dim)]">
          {liveCount === own.length
            ? `All ${own.length} answering on Sepolia when this page loaded.`
            : `${liveCount} of ${own.length} answering on Sepolia when this page loaded.`}
        </p>

        <ul className="mt-6 space-y-3">
          {own.map((c) => (
            <li
              key={c.address}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
            >
              <div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">{c.name}</span>
                  <StatusDot
                    state={c.live === true ? "up" : c.live === false ? "down" : "unknown"}
                    label={c.live === true ? "live" : c.live === false ? "not deployed" : "unreadable"}
                  />
                </div>
                <p className="mt-1.5 max-w-[460px] text-sm text-[var(--text-dim)]">{c.role}</p>
              </div>
              <div className="flex items-center gap-2">
                <CopyButton value={c.address} label={`${c.name} address`} short={shortHex(c.address, 8, 4)} />
                <a
                  href={`${VOYAGER}/contract/${c.address}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="fluid rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-xs text-[var(--text-dim)] no-underline hover:text-[var(--text)]"
                >
                  Explorer ↗
                </a>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-8 max-w-[640px] text-sm text-[var(--text-mute)]">
          Betting is public, as it is at a real table. What stays hidden is the deck, and it
          stays hidden from everyone rather than from everyone except the house.
        </p>
      </main>

      <SiteFooter />
    </>
  );
}
