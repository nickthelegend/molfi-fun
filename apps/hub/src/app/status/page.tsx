import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/chrome";
import { StatusDot } from "@/components/bits";
import { gameStatuses, uptime } from "@/lib/live";

export const metadata: Metadata = {
  title: "Status — molfi.fun",
  description:
    "Live service status, plus uptime measured from samples the keeper recorded while running.",
};

export const dynamic = "force-dynamic";

/**
 * Status, with the distinction most status pages skip.
 *
 * The right-hand column is a probe made when you loaded this page: it is current and it is
 * one sample. The left is uptime computed over observations the keeper wrote as it ran, so a
 * service that was down an hour ago is still down an hour ago in that figure.
 *
 * Most status pages show only the first and call it uptime. That is a single sample dressed
 * as a percentage.
 */
export default async function Status() {
  const [rows, services] = await Promise.all([uptime(), gameStatuses()]);

  return (
    <>
      <SiteHeader current="/status" />

      <main id="main" className="mx-auto max-w-5xl px-6 pt-16 pb-24">
        <p className="text-sm font-medium text-[var(--text-dim)]">Service status</p>
        <h1 className="mt-3 max-w-[680px] text-4xl font-semibold tracking-tight sm:text-5xl">
          What is up, and what has been
        </h1>

        <p className="mt-6 max-w-[660px] text-lg text-[var(--text-dim)]">
          Two different questions, kept apart. Whether something answers right now is a probe
          made when you loaded this page. Whether it has been reliable is computed over samples
          the keeper recorded while it ran, which is the only way that figure means anything.
        </p>

        {/* ── Measured uptime ────────────────────────────────────────────────────── */}
        <h2 className="mt-14 text-2xl font-semibold tracking-tight">Measured over time</h2>

        {rows === null ? (
          <div className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6">
            <StatusDot state="down" label="keeper unreachable" />
            <p className="mt-3 max-w-[560px] text-sm text-[var(--text-dim)]">
              The samples live in the keeper&apos;s database and it could not be reached. Which
              is itself a data point, just not one this page can record.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <p className="mt-6 text-sm text-[var(--text-mute)]">
            No samples recorded yet. The keeper writes one per service every 30 seconds while
            it runs, so the first figures appear shortly after it starts.
          </p>
        ) : (
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {rows.map((row) => (
              <li
                key={row.service}
                className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-semibold">{row.service}</span>
                  <span
                    className="font-mono text-lg"
                    style={{
                      color:
                        row.uptimePct === null
                          ? "var(--text-mute)"
                          : row.uptimePct >= 99
                            ? "var(--accent)"
                            : "#e0b06c",
                    }}
                  >
                    {row.uptimePct === null ? "unmeasured" : `${row.uptimePct}%`}
                  </span>
                </div>
                <p className="mt-2 text-xs text-[var(--text-mute)]">
                  {row.up} of {row.samples} samples up
                  {row.medianLatencyMs !== null && ` · median ${row.medianLatencyMs}ms`}
                </p>
              </li>
            ))}
          </ul>
        )}

        {/* ── Right now ──────────────────────────────────────────────────────────── */}
        <h2 className="mt-14 text-2xl font-semibold tracking-tight">Right now</h2>
        <p className="mt-3 max-w-[620px] text-[var(--text-dim)]">
          One probe each, made while this page rendered.
        </p>
        <ul className="mt-6 space-y-3">
          {services.map((s) => (
            <li
              key={s.slug}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
            >
              <span className="font-semibold">{s.slug}</span>
              <div className="flex items-center gap-4">
                {s.latencyMs !== null && (
                  <span className="font-mono text-xs text-[var(--text-mute)]">
                    {s.latencyMs}ms
                  </span>
                )}
                <StatusDot state={s.health} label={s.detail} />
              </div>
            </li>
          ))}
        </ul>
      </main>

      <SiteFooter />
    </>
  );
}
