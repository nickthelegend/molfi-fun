import Link from "next/link";
import { MARKETS, fmtPrice, fmtStrk, secondsLabel } from "@molfi/sdk";
import { NETWORK } from "@/lib/rpc";
import { marketAddress, readMarket, readMarketCount } from "@/lib/market-reads";
import { Countdown } from "@/components/Countdown";

/**
 * The market, running, on one page.
 *
 * Everything else in molfi asks you to take a position or to check one. This asks nothing —
 * it is the market itself, counting down and resolving, read from the chain each time the
 * page is opened. It exists because a prediction market's only real proof is a prediction
 * that resolved, and until this page there was nowhere to watch one do it.
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
    "Markets counting down and settling on Starknet, against a multi-publisher price.",
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

  return (
    <Shell>
      {error ? (
        <p className="mono text-[12px] text-red">The chain could not be read: {error}</p>
      ) : (
        <>
          <Section
            title="Open"
            empty="Nothing open. The keeper lists a new round as soon as one settles."
            markets={open}
            now={now}
          />
          {due.length > 0 ? (
            <Section
              title="Past cutoff, waiting on a fresh print"
              empty=""
              markets={due}
              now={now}
              note="Settlement needs a price the contract will accept — under fifteen minutes old and backed by at least three publishers. Anyone can settle these; nobody has yet."
            />
          ) : null}
          <Section
            title="Settled"
            empty="Nothing has resolved yet."
            markets={settled}
            now={now}
          />
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="tiled min-h-dvh px-5 py-10">
      <div className="mx-auto w-full max-w-[560px]">
        <div className="rounded-[22px] bg-card p-6">
          <div className="label">molfi · live · Starknet {NETWORK}</div>
          <h1 className="mt-2 text-[26px] font-extrabold leading-tight tracking-tight">
            Markets, resolving.
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-white/50">
            Read from the contract when you loaded this page. Every settled price came from
            Pragma&apos;s median with the publisher count it carried; every open market has a
            bankroll behind it before it can sell anything.
          </p>
          <div className="mt-4 flex gap-3">
            <Link
              href="/play"
              className="flex-1 rounded-full bg-amber-2 py-2.5 text-center text-[13px] font-extrabold text-black"
            >
              OPEN THE CONSOLE
            </Link>
            <Link
              href="/keeper"
              className="flex-1 rounded-full bg-[#242424] py-2.5 text-center text-[13px] font-semibold"
            >
              WHO SETTLES THESE
            </Link>
          </div>
        </div>
        <div className="mt-4 space-y-4">{children}</div>
      </div>
    </main>
  );
}

function Section({
  title,
  empty,
  markets,
  now,
  note,
}: {
  title: string;
  empty: string;
  markets: Awaited<ReturnType<typeof readMarket>>[];
  now: number;
  note?: string;
}) {
  return (
    <section className="rounded-[22px] bg-card p-5">
      <div className="label">{title}</div>
      {note ? <p className="mt-1.5 text-[11px] leading-relaxed text-amber">{note}</p> : null}
      {markets.length === 0 ? (
        <p className="mt-3 text-[13px] leading-relaxed text-white/45">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {markets.map((m) => {
            const dp = MARKETS.find((d) => d.label === m.pair)?.dp ?? 2;
            return (
              <li key={m.id} className="rounded-xl bg-[#131313] p-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] font-semibold">
                    {m.pair}{" "}
                    <span className="text-white/25">
                      #{m.id} · {secondsLabel(m.roundSeconds)}
                    </span>
                  </span>
                  {m.isSettled ? (
                    <span className="tnum text-[14px] text-green">
                      {fmtPrice(m.settledPrice, dp)}
                    </span>
                  ) : (
                    <Countdown to={m.cutoffAt} />
                  )}
                </div>

                <dl className="mono mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] tracking-wide">
                  {m.isSettled ? (
                    <>
                      <Cell k="publishers" v={String(m.settledSources)} />
                      <Cell
                        k="print age"
                        v={`${Math.max(0, m.settledBlockAt - m.settledAt)}s at settlement`}
                      />
                    </>
                  ) : (
                    <>
                      <Cell k="cutoff" v={new Date(m.cutoffAt * 1000).toUTCString().slice(17, 25)} />
                      <Cell k="in" v={`${Math.max(0, m.cutoffAt - now)}s`} />
                    </>
                  )}
                  <Cell k="staked" v={`${fmtStrk(m.staked, 3)} STRK`} />
                  <Cell k="bankroll" v={`${fmtStrk(m.bankroll, 3)} STRK`} />
                  {m.reserved > 0n ? (
                    <Cell k="owed to positions" v={`${fmtStrk(m.reserved, 3)} STRK`} />
                  ) : null}
                  {m.paid > 0n ? <Cell k="paid" v={`${fmtStrk(m.paid, 3)} STRK`} /> : null}
                </dl>

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

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-white/30">{k}</dt>
      <dd className="tnum truncate text-white/70">{v}</dd>
    </div>
  );
}
