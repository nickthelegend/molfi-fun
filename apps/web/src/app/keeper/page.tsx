import Link from "next/link";
import { NETWORK } from "@/lib/rpc";

/**
 * Who settles these, and how you check that they did.
 *
 * The keeper is the least glamorous part of molfi and the easiest thing to overstate. It has
 * no privileged power over settlement — anyone may settle an expired market, and the contract
 * does not know or care who called. What it does have is a signing key for the relay and for
 * listing new rounds, and pretending otherwise would be the kind of quiet overclaim that
 * makes every other statement in a submission worth less.
 *
 * So this page says exactly what it can do, exactly what it cannot, and then shows its work:
 * every relay, settlement and listing with the transaction hash that proves it.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "molfi — the keeper",
  description: "What settles molfi's markets, what it can do, and every transaction it sent.",
};

interface Action {
  at: string;
  kind: string;
  pair: string | null;
  market_id: number | null;
  tx_hash: string | null;
  ok: boolean;
  detail: string;
}

const EXPLORER = "https://sepolia.starkscan.co/tx/";

async function fetchJson(path: string) {
  const base = process.env.KEEPER_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    return await res.json();
  } catch {
    return null;
  }
}

export default async function KeeperPage() {
  const [health, log] = await Promise.all([fetchJson("/health"), fetchJson("/actions?limit=40")]);
  const actions: Action[] = log?.actions ?? [];

  return (
    <main className="tiled min-h-dvh px-5 py-10">
      <div className="mx-auto w-full max-w-[560px]">
        <div className="rounded-[22px] bg-card p-6">
          <div className="label">molfi · the keeper · Starknet {NETWORK}</div>
          <h1 className="mt-2 text-[26px] font-extrabold leading-tight tracking-tight">
            Nobody has to run this.
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-white/55">
            Settling a molfi market is <span className="text-white">permissionless</span>. The
            contract lets anyone poke a market past its cutoff and does not know who called —
            a market whose resolution depends on the operator showing up is not one you should
            take the other side of.
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-white/55">
            Which is also why, left alone, nothing happens. This is the somebody. It settles
            what is due, opens the next round, and carries mainnet Pragma&apos;s median across
            to a testnet whose own feed stopped publishing months ago.
          </p>
        </div>

        {/* What it can and cannot do, side by side. The asymmetry is the point. */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[18px] bg-card p-5">
            <div className="label text-green">Can</div>
            <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-white/60">
              <li>Publish a relayed price, as the only relayer</li>
              <li>List a new market, as the contract&apos;s owner</li>
              <li>Fund a market from its own balance</li>
              <li>Settle an expired market — as can anyone</li>
            </ul>
          </div>
          <div className="rounded-[18px] bg-card p-5">
            <div className="label text-red">Cannot</div>
            <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-white/60">
              <li>See who holds a position, or that one exists beyond its hash</li>
              <li>Change a settled price — settle writes it once</li>
              <li>Move a relayed price backwards in time</li>
              <li>Claim, block, or refuse anyone&apos;s payout</li>
            </ul>
          </div>
        </div>

        <Status health={health} />

        <section className="mt-4 rounded-[22px] bg-card p-5">
          <div className="label">Everything it has done</div>
          {actions.length === 0 ? (
            <p className="mt-3 text-[13px] leading-relaxed text-white/45">
              {health
                ? "The ledger is empty. Either the keeper has just started, or no database is attached — it settles either way, it just does not remember."
                : "The keeper could not be reached. Markets can still be settled by anyone; this page is the only thing that stops working."}
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {actions.map((a, i) => (
                <li
                  key={`${a.at}-${i}`}
                  className="mono flex items-baseline gap-2 text-[10px] leading-relaxed tracking-wide"
                >
                  <span className="w-[52px] shrink-0 text-white/25">
                    {new Date(a.at).toUTCString().slice(17, 25)}
                  </span>
                  <span className={`w-[46px] shrink-0 ${a.ok ? "text-green" : "text-red"}`}>
                    {a.kind}
                  </span>
                  <span className="w-[62px] shrink-0 text-white/50">{a.pair ?? "—"}</span>
                  <span className="min-w-0 flex-1 truncate text-white/40">{a.detail}</span>
                  {a.tx_hash ? (
                    <a
                      href={`${EXPLORER}${a.tx_hash}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="shrink-0 text-amber underline"
                    >
                      tx
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-white/35">
            Every row carries the hash of the transaction that produced it. None of this has to
            be believed.
          </p>
        </section>

        <div className="mt-4 flex gap-3">
          <Link
            href="/live"
            className="flex-1 rounded-full bg-amber-2 py-3 text-center text-[13px] font-extrabold text-black"
          >
            WATCH THEM SETTLE
          </Link>
          <Link
            href="/play"
            className="flex-1 rounded-full bg-[#242424] py-3 text-center text-[13px] font-semibold"
          >
            OPEN THE CONSOLE
          </Link>
        </div>
      </div>
    </main>
  );
}

function Status({ health }: { health: Record<string, unknown> | null }) {
  if (!health) {
    return (
      <section className="mt-4 rounded-[22px] bg-card p-5">
        <div className="label">Status</div>
        <p className="mt-2 text-[13px] leading-relaxed text-amber">
          Unreachable. That stops this page from updating and stops nothing else: markets are
          settled by whoever gets there first, and the contract has no idea the keeper exists.
        </p>
      </section>
    );
  }

  const ok = Boolean(health.ok);
  const lag = typeof health.lagMs === "number" ? Math.round(health.lagMs / 1000) : null;

  return (
    <section className="mt-4 rounded-[22px] bg-card p-5">
      <div className="flex items-baseline justify-between">
        <span className="label">Status</span>
        <span className={`mono text-[10px] tracking-[0.1em] ${ok ? "text-green" : "text-amber"}`}>
          {/* Healthy means "ran recently", not "process is up". A keeper that is alive and
              stuck is exactly the failure worth catching. */}
          {ok ? "RUNNING" : "STALLED"}
        </span>
      </div>
      <dl className="mono mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] tracking-wide">
        <Cell k="cycles" v={String(health.cycles ?? "—")} />
        <Cell k="last cycle" v={lag === null ? "—" : `${lag}s ago`} />
        <Cell k="relayed" v={String(health.relayed ?? 0)} />
        <Cell k="settled" v={String(health.settled ?? 0)} />
        <Cell k="listed" v={String(health.listed ?? 0)} />
        <Cell
          k="balance"
          v={
            typeof health.balance === "string"
              ? `${(Number(BigInt(health.balance) / 10n ** 15n) / 1000).toFixed(2)} STRK`
              : "—"
          }
        />
      </dl>
      {typeof health.stoppedListing === "string" ? (
        <p className="mt-2 text-[11px] leading-relaxed text-amber">
          Not listing new markets: {health.stoppedListing}. It keeps settling, which is
          cheaper and the more important of the two.
        </p>
      ) : null}
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
