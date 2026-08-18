import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/chrome";
import entries from "@/generated/changelog.json";

export const metadata: Metadata = {
  title: "Changelog — molfi.fun",
  description: "What changed, taken from the repository's own commit history.",
};

interface Entry {
  hash: string;
  date: string;
  subject: string;
  summary: string;
}

/**
 * The history, from the history.
 *
 * A hand-written changelog is a second source of truth that drifts from the first one and is
 * usually flattering about it. This is generated from the commits at build time, so it says
 * what was actually done in the words it was recorded in, and it cannot quietly omit a bad
 * week.
 */
export default function Changelog() {
  const rows = entries as Entry[];

  // Grouped by day, which is the unit a reader thinks in.
  const byDay = new Map<string, Entry[]>();
  for (const row of rows) {
    const day = row.date.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), row]);
  }

  return (
    <>
      <SiteHeader current="/changelog" />

      <main id="main" className="mx-auto max-w-5xl px-6 pt-16 pb-24">
        <p className="text-sm font-medium text-[var(--text-dim)]">Recent work</p>
        <h1 className="mt-3 max-w-[680px] text-4xl font-semibold tracking-tight sm:text-5xl">
          What changed
        </h1>

        <p className="mt-6 max-w-[660px] text-lg text-[var(--text-dim)]">
          Generated from the repository&apos;s commits rather than written by hand, so it says
          what was actually done in the words it was recorded in. A changelog somebody
          maintains separately is a second source of truth, and it is usually flattering.
        </p>

        {rows.length === 0 ? (
          <p className="mt-10 text-sm text-[var(--text-mute)]">
            No history available in this build. The page is generated from git at build time,
            and this build had no repository to read.
          </p>
        ) : (
          <div className="mt-12 space-y-10">
            {[...byDay.entries()].map(([day, items]) => (
              <section key={day}>
                <h2 className="font-mono text-sm text-[var(--text-mute)]">{day}</h2>
                <ul className="mt-4 space-y-4">
                  {items.map((row) => (
                    <li
                      key={row.hash}
                      className="border-l-2 border-[var(--line-2)] pl-4"
                    >
                      <div className="flex flex-wrap items-baseline gap-3">
                        <h3 className="font-semibold tracking-tight">{row.subject}</h3>
                        <code className="font-mono text-xs text-[var(--text-mute)]">
                          {row.hash}
                        </code>
                      </div>
                      {row.summary && (
                        <p className="mt-1.5 max-w-[660px] text-sm text-[var(--text-dim)]">
                          {row.summary}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <p className="mt-12 text-sm text-[var(--text-mute)]">
          Showing the last {rows.length} commits.
        </p>
      </main>

      <SiteFooter />
    </>
  );
}
