import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/chrome";
import { CopyButton, StatusDot } from "@/components/bits";
import { shortHex } from "@/lib/chain";
import { deployments } from "@/lib/live";

export const metadata: Metadata = {
  title: "Deployments — molfi.fun",
  description:
    "Every set of contracts CrewKill has run on, live and retired, with the matches each one settled.",
};

export const dynamic = "force-dynamic";

export default async function Deployments() {
  const rows = await deployments();

  return (
    <>
      <SiteHeader current="/deployments" />

      <main id="main" className="mx-auto max-w-5xl px-6 pt-16 pb-24">
        <p className="text-sm font-medium text-[var(--text-dim)]">Contract history</p>
        <h1 className="mt-3 max-w-[680px] text-4xl font-semibold tracking-tight sm:text-5xl">
          Every set of contracts
          <br />
          this has run on
        </h1>

        <p className="mt-6 max-w-[660px] text-lg text-[var(--text-dim)]">
          A deployment is a set of addresses on a chain, not a chain. When contracts go up
          again the old ones do not stop having existed, and the matches settled against them
          are still real. They are just no longer checkable, because the code that checked
          them is gone.
        </p>
        <p className="mt-4 max-w-[660px] text-[var(--text-dim)]">
          So a retired deployment is kept and labelled rather than quietly absorbed into the
          live one. That is the difference between a history and a number that happens to be
          large.
        </p>

        {rows === null ? (
          <div className="mt-10 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6">
            <StatusDot state="down" label="keeper unreachable" />
            <p className="mt-3 max-w-[560px] text-sm text-[var(--text-dim)]">
              The deployment history lives in the keeper&apos;s database and it could not be
              reached. This is the service being down, not the history being empty.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-10 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6">
            <p className="text-sm text-[var(--text-dim)]">
              No deployment recorded yet. The first one appears the moment contracts go up and
              the keeper opens a lobby against them.
            </p>
          </div>
        ) : (
          <ul className="mt-10 space-y-3">
            {rows
              .slice()
              .sort((a, b) => Number(b.live) - Number(a.live) || b.id - a.id)
              .map((row) => (
                <li
                  key={row.id}
                  className="rounded-xl border bg-[var(--surface)] p-5"
                  style={{ borderColor: row.live ? "var(--accent)" : "var(--line)" }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="font-mono text-base font-semibold tracking-tight">
                          deployment #{row.id}
                        </h2>
                        <StatusDot
                          state={row.live ? "up" : "unknown"}
                          label={row.live ? "live" : "retired"}
                        />
                        <span className="rounded border border-[var(--line-2)] px-1.5 py-0.5 text-[10px] tracking-wide text-[var(--text-dim)] uppercase">
                          {row.network}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-[var(--text-dim)]">
                        {row.live
                          ? "The contracts running right now. New matches settle here."
                          : "Retired. Its matches are recorded and were real, but the contracts that settled them are gone."}
                      </p>
                    </div>

                    <div className="flex gap-8">
                      <Figure label="Matches" value={row.matches} />
                      <Figure label="Settled" value={row.settled} accent={row.live} />
                      <Figure label="Transactions" value={row.transactions} />
                    </div>
                  </div>

                  <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs tracking-wide text-[var(--text-mute)] uppercase">
                        Game
                      </dt>
                      <dd className="mt-1.5">
                        <CopyButton
                          value={row.gameAddress}
                          label={`deployment ${row.id} game address`}
                          short={shortHex(row.gameAddress, 10, 6)}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs tracking-wide text-[var(--text-mute)] uppercase">
                        Ballot
                      </dt>
                      <dd className="mt-1.5">
                        <CopyButton
                          value={row.ballotAddress}
                          label={`deployment ${row.id} ballot address`}
                          short={shortHex(row.ballotAddress, 10, 6)}
                        />
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
          </ul>
        )}
      </main>

      <SiteFooter />
    </>
  );
}

function Figure({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <p className="text-xs tracking-wide text-[var(--text-mute)] uppercase">{label}</p>
      <p
        className="mt-1 font-mono text-xl"
        style={{ color: accent ? "var(--accent)" : "var(--text)" }}
      >
        {value.toLocaleString("en-US")}
      </p>
    </div>
  );
}
