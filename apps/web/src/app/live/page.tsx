import Link from "next/link";
import { MARKETS, fmtPrice, secondsLabel } from "@molfi/sdk";
import { NETWORK } from "@/lib/rpc";
import { marketAddress, readMarket, readMarketCount } from "@/lib/market-reads";
import { Countdown } from "@/components/Countdown";

/**
 * What the market actually printed.
 *
 * This page is the product's evidence, not its ledger. A prediction market's only real proof
 * is a prediction that resolved, so the page leads with the last price that did — the number,
 * who published it, how fresh it was — and then the rounds still running. What the house has
 * behind a market, what is staked in it and what it owes are the operator's problem; they used
 * to be the first thing a visitor read here, and they told that visitor nothing about whether
 * molfi works.
 *
 * Server-rendered on purpose: no wallet, no account, no JavaScript required to see the
 * numbers. The countdown is the only thing that needs a client, and it degrades to a
 * timestamp without one.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "molfi — live",
  description:
    "Prices that resolved on Starknet, the publishers behind each one, and the rounds still open.",
};

export default async function LivePage() {
  const address = marketAddress();
  if (!address) {
    return (
      <Shell>
        <p className="text-[14px] leading-relaxed text-white/55">
          molfi&apos;s market contract is not deployed on {NETWORK}, so there is nothing
          running to watch. That is the honest state before a deploy rather than an error.
        </p>
      </Shell>
    );
  }

  let markets: Awaited<ReturnType<typeof readMarket>>[] = [];
  let error: string | null = null;
  try {
    const count = await readMarketCount(address);
    // Newest first, and bounded. A market list grows without limit and this page only ever
    // wants the recent tail — everything older is on its own verifier page.
    const ids = Array.from({ length: Math.min(count, 24) }, (_, i) => count - i).filter((i) => i >= 1);
    markets = await Promise.all(ids.map((id) => readMarket(address, id)));
  } catch (e) {
    error = (e as Error).message;
  }

  const now = Math.floor(Date.now() / 1000);
  const open = markets.filter((m) => !m.isSettled && m.cutoffAt > now);
  const due = markets.filter((m) => !m.isSettled && m.cutoffAt <= now);
  const settled = markets.filter((m) => m.isSettled);
  const latest = settled[0] ?? null;

  return (
    <Shell latest={latest} open={open.length} now={now}>
      {error ? (
        <p className="mono text-[12px] text-red">The chain could not be read: {error}</p>
      ) : (
        <>
          {open.length > 0 ? <Running markets={open} /> : null}
          {due.length > 0 ? <Due markets={due} /> : null}
          <Results markets={settled} now={now} />
        </>
      )}
    </Shell>
  );
}

/**
 * The masthead is the last real price, at the size a price deserves.
 *
 * With nothing settled the page has no result to show and says so in a sentence — it does not
 * dress an empty list up as a section heading.
 */
function Shell({
  children,
  latest,
  open,
  now,
}: {
  children: React.ReactNode;
  latest?: Awaited<ReturnType<typeof readMarket>> | null;
  open?: number;
  now?: number;
}) {
  const dp = latest ? (MARKETS.find((d) => d.label === latest.pair)?.dp ?? 2) : 2;
  return (
    <main className="tiled min-h-dvh px-5 py-10">
      <div className="mx-auto w-full max-w-[560px]">
        <div className="rounded-[22px] bg-card p-6">
          <div className="label">molfi · Starknet {NETWORK}</div>

          {latest ? (
            <>
              <div className="mt-3 text-[13px] font-semibold text-white/70">
                {latest.pair} closed at
              </div>
              <div className="tnum mt-0.5 text-[44px] font-extrabold leading-none tracking-tight text-green">
                {fmtPrice(latest.settledPrice, dp)}
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-white/50">
                {now ? `Settled ${ago(now - latest.settledBlockAt)} ago on a median of ` : "A median of "}
                {latest.settledSources} publishers. The print was{" "}
                {dur(Math.max(0, latest.settledBlockAt - latest.settledAt))} old when the
                contract took it, inside the fifteen minutes it allows. Every payout on that
                round comes out of this one number — and you can do the arithmetic yourself.
              </p>
            </>
          ) : (
            <>
              <div className="mt-3 text-[20px] font-extrabold leading-tight tracking-tight">
                No round has closed yet.
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-white/50">
                {open
                  ? `${open} ${open === 1 ? "round is" : "rounds are"} running against this contract right now. The first price lands when the earliest one reaches its cutoff.`
                  : "Nothing is running against this contract right now."}
              </p>
            </>
          )}

          <div className="mt-5 flex gap-3">
            <Link
              href="/play"
              className="flex-1 rounded-full bg-amber-2 py-2.5 text-center text-[13px] font-extrabold text-black"
            >
              TAKE A POSITION
            </Link>
            {latest ? (
              <Link
                href={`/m/${latest.id}`}
                className="flex-1 rounded-full bg-[#242424] py-2.5 text-center text-[13px] font-semibold"
              >
                CHECK THIS PRICE
              </Link>
            ) : null}
          </div>
        </div>
        <div className="mt-4 space-y-4">{children}</div>
      </div>
    </main>
  );
}

/** Rounds still taking positions. A pair, a length, a clock — the things you decide on. */
function Running({ markets }: { markets: Awaited<ReturnType<typeof readMarket>>[] }) {
  return (
    <section className="rounded-[22px] bg-card p-5">
      <div className="label">Open now</div>
      <ul className="mt-3 space-y-2">
        {markets.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 rounded-xl bg-[#131313] p-3.5">
            <span className="text-[14px] font-semibold">
              {m.pair} <span className="text-white/25">· {secondsLabel(m.roundSeconds)} round</span>
            </span>
            <Countdown to={m.cutoffAt} />
          </li>
        ))}
      </ul>
      <Link
        href="/play"
        className="mono mt-3 inline-block text-[10px] tracking-wide text-amber underline"
      >
        pick a band on one of these →
      </Link>
    </section>
  );
}

/**
 * Past cutoff and unsettled.
 *
 * Worth showing rather than hiding: the price a round settles on has to be fresh, so a round
 * whose cutoff has passed waits for one. That wait is a real property of the design.
 */
function Due({ markets }: { markets: Awaited<ReturnType<typeof readMarket>>[] }) {
  return (
    <section className="rounded-[22px] bg-card p-5">
      <div className="label">Closed, waiting on a price</div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-amber">
        A round settles only against a print under fifteen minutes old carrying at least three
        publishers. These have stopped taking positions and are waiting for one.
      </p>
      <ul className="mt-3 space-y-2">
        {markets.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 rounded-xl bg-[#131313] p-3.5">
            <span className="text-[14px] font-semibold">
              {m.pair} <span className="text-white/25">· {secondsLabel(m.roundSeconds)} round</span>
            </span>
            <Countdown to={m.cutoffAt} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Every price this contract has printed, newest first. */
function Results({
  markets,
  now,
}: {
  markets: Awaited<ReturnType<typeof readMarket>>[];
  now: number;
}) {
  return (
    <section className="rounded-[22px] bg-card p-5">
      <div className="label">Results</div>
      {markets.length === 0 ? (
        <p className="mt-3 text-[13px] leading-relaxed text-white/45">
          Nothing has resolved yet, so there is nothing here to check.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {markets.map((m) => {
            const dp = MARKETS.find((d) => d.label === m.pair)?.dp ?? 2;
            return (
              <li key={m.id} className="rounded-xl bg-[#131313] p-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] font-semibold">
                    {m.pair}{" "}
                    <span className="text-white/25">· {secondsLabel(m.roundSeconds)} round</span>
                  </span>
                  <span className="tnum text-[15px] font-semibold text-green">
                    {fmtPrice(m.settledPrice, dp)}
                  </span>
                </div>
                <p className="mono mt-1.5 text-[10px] leading-relaxed tracking-wide text-white/40">
                  {ago(now - m.settledBlockAt)} ago · {m.settledSources} publishers ·{" "}
                  {Math.max(0, m.settledBlockAt - m.settledAt)}s old at settlement
                </p>
                <Link
                  href={`/m/${m.id}`}
                  className="mono mt-2 inline-block text-[10px] tracking-wide text-amber underline"
                >
                  recompute this market →
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Coarse on purpose: the exact second a round settled is on the market's own page. */
function ago(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 60) return `${s}s`;
  if (s < 3_600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3_600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/** A print's age, in the units a person would say it in. */
function dur(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 60) return `${s} seconds`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? `${m} minutes` : `${m}m ${rest}s`;
}
