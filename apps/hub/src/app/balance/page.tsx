import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/chrome";
import { StatusDot } from "@/components/bits";
import { balance } from "@/lib/live";

export const metadata: Metadata = {
  title: "Balance — molfi.fun",
  description:
    "Crew win rates by ship and survival rates by persona, counted across every settled CrewKill match.",
};

export const dynamic = "force-dynamic";

/**
 * Whether the game is actually balanced.
 *
 * One settled match proves the system runs. A few hundred prove something else, and it is
 * the question a designer asks rather than an engineer: is one ship easier than another, do
 * the agent strategies differ in strength. Neither is answerable from a match list, and both
 * are answerable from the same rows the archive already holds.
 *
 * Small samples are labelled as small rather than rounded into a confident percentage. A win
 * rate over three matches is not a win rate.
 */
export default async function Balance() {
  const stats = await balance();

  return (
    <>
      <SiteHeader current="/balance" />

      <main id="main" className="mx-auto max-w-5xl px-6 pt-16 pb-24">
        <p className="text-sm font-medium text-[var(--text-dim)]">Game balance</p>
        <h1 className="mt-3 max-w-[680px] text-4xl font-semibold tracking-tight sm:text-5xl">
          Is it actually fair?
        </h1>

        <p className="mt-6 max-w-[660px] text-lg text-[var(--text-dim)]">
          One settled match proves the system runs. A few hundred answer a different question:
          whether one ship is easier than another, and whether the agent strategies differ in
          strength. Both are counted here from every settled match on the live deployment.
        </p>

        {stats === null ? (
          <div className="mt-10 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6">
            <StatusDot state="down" label="keeper unreachable" />
            <p className="mt-3 max-w-[560px] text-sm text-[var(--text-dim)]">
              These are counted from the keeper&apos;s database and it could not be reached.
              That is the service being down rather than the game being unmeasured.
            </p>
          </div>
        ) : stats.totalSettled === 0 ? (
          <div className="mt-10 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6">
            <p className="text-sm text-[var(--text-dim)]">
              No match has settled on this deployment yet, so there is nothing to measure. The
              first numbers appear as soon as one does.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-10 flex flex-wrap gap-x-10 gap-y-4 border-y border-[var(--line)] py-5">
              <Figure label="Settled matches" value={String(stats.totalSettled)} />
              <Figure
                label="Crew win rate"
                value={`${Math.round((stats.crewWins / stats.totalSettled) * 100)}%`}
                accent
              />
              <Figure
                label="Impostor win rate"
                value={`${Math.round(((stats.totalSettled - stats.crewWins) / stats.totalSettled) * 100)}%`}
              />
            </div>

            {stats.totalSettled < 20 && (
              <p className="mt-4 text-sm" style={{ color: "#e0b06c" }}>
                {stats.totalSettled} settled {stats.totalSettled === 1 ? "match" : "matches"} is
                a small sample. These percentages are arithmetic on what exists, not a claim
                about how the game plays.
              </p>
            )}

            {stats.eliminationsByRound.length > 0 && (
              <>
                <h2 className="mt-14 text-2xl font-semibold tracking-tight">How seats leave</h2>
                <p className="mt-3 max-w-[640px] text-[var(--text-dim)]">
                  The shape worth watching is the crossover. Early rounds should be decided by
                  kills, because the crew has nothing to go on yet; later rounds by votes, once
                  there is evidence. If that crossover disappeared it would mean the deduction
                  half had stopped mattering — a balance problem no win rate would show.
                </p>
                <ul className="mt-6 space-y-2">
                  {stats.eliminationsByRound.map((row) => {
                    const total = row.kills + row.votes;
                    const killPct = total === 0 ? 0 : Math.round((row.kills / total) * 100);
                    return (
                      <li
                        key={row.round}
                        className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-3">
                          <span className="font-semibold">Round {row.round}</span>
                          <span className="font-mono text-xs text-[var(--text-mute)]">
                            {row.kills} killed · {row.votes} voted out
                          </span>
                        </div>
                        <div
                          className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
                          role="img"
                          aria-label={`Round ${row.round}: ${row.kills} killed, ${row.votes} voted out`}
                        >
                          <div style={{ width: `${killPct}%`, background: "#e06c6c" }} />
                          <div style={{ width: `${100 - killPct}%`, background: "var(--accent)" }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 text-xs text-[var(--text-mute)]">
                  Red is killed by an impostor, blue is voted out by the table.
                </p>
              </>
            )}

            <h2 className="mt-14 text-2xl font-semibold tracking-tight">By ship</h2>
            <p className="mt-3 max-w-[620px] text-[var(--text-dim)]">
              Which ship a match runs on is drawn from its final seed, so nobody picks it.
            </p>
            <ul className="mt-6 space-y-2">
              {stats.byShip.map((ship) => (
                <Bar
                  key={ship.mapId}
                  label={ship.mapId}
                  ratio={ship.crewWins / ship.settled}
                  detail={`${ship.crewWins} of ${ship.settled} to the crew`}
                />
              ))}
            </ul>

            <h2 className="mt-14 text-2xl font-semibold tracking-tight">By persona</h2>
            <p className="mt-3 max-w-[620px] text-[var(--text-dim)]">
              Survival rate across settled matches. Personas are assigned per seat, so a
              consistent gap here would mean a strategy difference rather than a name.
            </p>
            <ul className="mt-6 space-y-2">
              {stats.byPersona.map((p) => (
                <Bar
                  key={p.persona}
                  label={p.persona}
                  ratio={p.played === 0 ? 0 : p.survived / p.played}
                  detail={`survived ${p.survived} of ${p.played}${p.impostorRuns > 0 ? ` · impostor ${p.impostorRuns}×` : ""}`}
                />
              ))}
            </ul>
          </>
        )}
      </main>

      <SiteFooter />
    </>
  );
}

function Figure({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-xs tracking-wide text-[var(--text-mute)] uppercase">{label}</p>
      <p
        className="mt-1.5 font-mono text-xl"
        style={{ color: accent ? "var(--accent)" : "var(--text)" }}
      >
        {value}
      </p>
    </div>
  );
}

/** A bar rather than a number, because a rate is a comparison and bars compare. */
function Bar({ label, ratio, detail }: { label: string; ratio: number; detail: string }) {
  const percent = Math.round(ratio * 100);
  return (
    <li className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="font-semibold">{label}</span>
        <span className="font-mono text-sm text-[var(--accent)]">{percent}%</span>
      </div>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
        role="img"
        aria-label={`${label}: ${percent} percent, ${detail}`}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${percent}%`, background: "var(--accent)" }}
        />
      </div>
      <p className="mt-2 text-xs text-[var(--text-mute)]">{detail}</p>
    </li>
  );
}
