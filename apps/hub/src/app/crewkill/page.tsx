import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/chrome";
import { CopyButton, StatusDot } from "@/components/bits";
import { contractStatuses, shortHex, VOYAGER } from "@/lib/chain";
import { gameStatuses, keeperStats, toStrk, GAME_URLS } from "@/lib/live";

export const metadata: Metadata = {
  title: "CrewKill — molfi.fun",
  description:
    "Six seats, four rounds, one pot. A social deduction game where a seat is a commitment rather than an address, settled on Starknet.",
};

export const dynamic = "force-dynamic";

export default async function CrewKillPage() {
  const [stats, statuses, contracts] = await Promise.all([
    keeperStats(),
    gameStatuses(),
    contractStatuses(),
  ]);

  const service = statuses.find((s) => s.slug === "crewkill");
  const own = contracts.filter((c) => ["CrewKillGame", "BallotBox"].includes(c.name));
  const pot = toStrk(stats.potTotal);

  return (
    <>
      <SiteHeader current="/crewkill" />

      <main id="main" className="mx-auto max-w-5xl px-6 pt-16 pb-24">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-[var(--text-dim)]">Social deduction</p>
          <span className="h-3 w-px bg-[var(--line-2)]" aria-hidden />
          <StatusDot
            state={service?.health ?? "unknown"}
            label={service?.health === "up" ? "server responding" : (service?.detail ?? "unknown")}
          />
        </div>

        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">CrewKill</h1>

        <p className="mt-6 max-w-[660px] text-lg text-[var(--text-dim)]">
          Six seats, four rounds, one pot. Some of the crew are impostors and nobody knows
          who, including the people running it. You buy a seat privately, play, and the
          contract settles who was paid.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href={GAME_URLS.crewkill}
            className="fluid rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black no-underline hover:bg-[var(--accent)]"
          >
            Open CrewKill
          </a>
          <a
            href={`${GAME_URLS.crewkill}/history`}
            className="fluid rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm text-[var(--text-dim)] no-underline hover:border-[var(--line-2)] hover:text-[var(--text)]"
          >
            Past matches
          </a>
        </div>

        {/* ── What the keeper has actually done ──────────────────────────────────── */}
        <h2 className="mt-16 text-2xl font-semibold tracking-tight">What it has run so far</h2>
        <p className="mt-3 max-w-[620px] text-[var(--text-dim)]">
          Counted from the keeper&apos;s own database when this page loaded. Not a target, not
          a projection, and not a number anyone typed into this page.
        </p>

        {stats.reachable ? (
          <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--line)] sm:grid-cols-3">
            <Cell label="Matches recorded" value={stats.matches?.toLocaleString("en-US") ?? "—"} />
            <Cell label="Seats taken" value={stats.seatsFilled?.toLocaleString("en-US") ?? "—"} />
            <Cell label="Staked across them" value={pot ? `${pot} STRK` : "—"} />
          </div>
        ) : (
          /* An empty state that says what is wrong and what it is not. A stat block showing
             three zeroes here would read as "nobody has ever played", which is a different
             and much worse claim than "the counter is offline". */
          <div className="mt-8 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6">
            <StatusDot state="down" label="counters offline" />
            <p className="mt-3 max-w-[560px] text-sm text-[var(--text-dim)]">
              The keeper could not be reached, so there are no counts to show. This is the
              stats service being down rather than the game having no history — the contracts
              below are unaffected and still answering.
            </p>
          </div>
        )}

        {stats.reachable && stats.network && (
          <p className="mt-4 text-sm text-[var(--text-mute)]">
            Keeper reports network <span className="font-mono text-[var(--text-dim)]">{stats.network}</span>
            {stats.block !== null && (
              <>
                {" "}at block{" "}
                <span className="font-mono text-[var(--text-dim)]">
                  {stats.block.toLocaleString("en-US")}
                </span>
              </>
            )}
            .
          </p>
        )}

        {/* ── Privacy, with its edges named ──────────────────────────────────────── */}
        <h2 className="mt-16 text-2xl font-semibold tracking-tight">What stays private</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Panel
            title="Private during the match"
            items={[
              "Which seat is yours",
              "Your role, until the match ends",
              "Who you voted for, until the round closes",
              "Where you walked",
            ]}
          />
          <Panel
            title="Public, always"
            items={[
              "That an address deposited a stake",
              "The size of the pot",
              "That a match happened, and when",
              "Every payout the contract made",
            ]}
          />
        </div>
        <p className="mt-5 max-w-[640px] text-sm text-[var(--text-mute)]">
          The right hand column is the part most projects leave out. Your deposit names you.
          What it buys is that the game records a commitment instead of your address, so the
          link between you and your seat stops there.
        </p>

        {/* ── Its contracts ──────────────────────────────────────────────────────── */}
        <h2 className="mt-16 text-2xl font-semibold tracking-tight">Its contracts</h2>
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
      </main>

      <SiteFooter />
    </>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--surface)] p-5">
      <p className="text-xs tracking-wide text-[var(--text-mute)] uppercase">{label}</p>
      <p className="mt-2 font-mono text-2xl">{value}</p>
    </div>
  );
}

function Panel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5 text-sm text-[var(--text-dim)]">
            <span aria-hidden className="text-[var(--text-mute)]">
              —
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
