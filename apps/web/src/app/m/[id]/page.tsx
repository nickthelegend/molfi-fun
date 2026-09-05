import Link from "next/link";
import { hash } from "starknet";
import {
  CALIBRATED_MARKETS,
  MARKETS,
  ROUND_SECONDS,
  auditMarket,
  fmtCountdown,
  fmtPrice,
  fmtStrk,
  type Check,
  type OnChainMarket,
} from "@molfi/sdk";
import { NETWORK, call } from "@/lib/rpc";
import { NETWORKS } from "@molfi/sdk";

/**
 * One market, recomputed, readable by anyone.
 *
 * No wallet, no account, no position. That is the requirement: a claim only a participant
 * can check is not a claim anyone should accept, and the whole reason molfi can hide who
 * traded is that everything *else* stays checkable.
 *
 * Rendered on the server from contract calls rather than from anything molfi stored, so the
 * page says what the chain says. A result served out of our own database would be a
 * screenshot with extra steps.
 */
export const dynamic = "force-dynamic";

const u256 = (lo: string, hi: string) => (BigInt(hi) << 128n) | BigInt(lo);

function toLabel(felt: string): string {
  let n = BigInt(felt);
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  return String.fromCharCode(...bytes);
}

async function readMarket(id: number): Promise<OnChainMarket | null> {
  const address = NETWORKS[NETWORK].market;
  if (!address) return null;
  try {
    const r = await call(address, hash.getSelectorFromName("get_market"), [
      "0x" + id.toString(16),
    ]);
    const cutoffAt = Number(BigInt(r[1]));
    // A market that was never listed reads back as all zeroes rather than reverting.
    if (cutoffAt === 0) return null;

    const t = await call(address, hash.getSelectorFromName("get_table"), [
      "0x" + id.toString(16),
    ]);
    // A Span<u256> comes back as a length followed by two felts per element.
    const knots: bigint[] = [];
    for (let i = 1; i + 1 < t.length; i += 2) knots.push(u256(t[i], t[i + 1]));

    return {
      id,
      pair: toLabel(r[0]),
      cutoffAt,
      sigma1e4: u256(r[3], r[4]),
      houseEdgeBps: u256(r[5], r[6]),
      settledPrice: u256(r[7], r[8]),
      settledAt: Number(BigInt(r[9])),
      settledSources: Number(BigInt(r[10])),
      isSettled: BigInt(r[11]) === 1n,
      staked: u256(r[12], r[13]),
      paid: u256(r[14], r[15]),
      table: knots,
    };
  } catch {
    return null;
  }
}

/** The calibration molfi published for this pair and round length, if it published one. */
function publishedTable(pair: string, cutoffAt: number, settledAt: number) {
  const m = CALIBRATED_MARKETS.find((c) => c.label === pair);
  if (!m) return undefined;
  // The round length is not stored on chain — only the cutoff — so it is inferred from how
  // long the market was open. Inexact by design: if no tier is close, nothing is claimed
  // rather than the nearest one being asserted.
  const lived = settledAt > 0 ? cutoffAt - settledAt : 0;
  const tier = ROUND_SECONDS.findIndex((s) => Math.abs(s - lived) < s * 0.5);
  return tier >= 0 ? m.rounds[tier]?.probTable : undefined;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return {
    title: `molfi — market #${id}`,
    description:
      "A settled molfi market, recomputed from published data. No wallet, no account, no position needed.",
  };
}

export default async function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const market = /^\d+$/.test(id) ? await readMarket(Number(id)) : null;

  if (!market) {
    return (
      <main className="tiled grid min-h-dvh place-items-center px-5">
        <div className="w-full max-w-[420px] rounded-[22px] bg-card p-6 text-center">
          <p className="text-[15px] font-semibold">No market #{id}</p>
          <p className="mt-3 text-[13px] leading-relaxed text-white/50">
            {NETWORKS[NETWORK].market
              ? "The contract has no market with that id."
              : `molfi's market contract is not deployed on ${NETWORK} yet, so there is nothing to verify.`}
          </p>
          <Link
            href="/play"
            className="mt-5 inline-block rounded-full bg-amber-2 px-6 py-3 text-[13px] font-extrabold text-black"
          >
            OPEN THE CONSOLE
          </Link>
        </div>
      </main>
    );
  }

  const audit = auditMarket(
    market,
    publishedTable(market.pair, market.cutoffAt, market.settledAt),
  );
  const def = MARKETS.find((m) => m.label === market.pair);
  const dp = def?.dp ?? 2;
  const failed = audit.checks.filter((c) => c.verdict === "failed");
  const unchecked = audit.checks.filter((c) => c.verdict === "unchecked");

  return (
    <main className="tiled min-h-dvh px-5 py-10">
      <div className="mx-auto w-full max-w-[520px]">
        <div className="rounded-[22px] bg-card p-6">
          <div className="label">
            molfi · market #{market.id} · Starknet {NETWORK}
          </div>

          <h1 className="mt-2 text-[26px] font-extrabold leading-tight tracking-tight">
            {market.pair}
          </h1>

          <p
            className={`mono mt-3 text-[12px] tracking-[0.08em] ${
              failed.length > 0 ? "text-red" : audit.sound ? "text-green" : "text-amber"
            }`}
          >
            {failed.length > 0
              ? `${failed.length} CHECK${failed.length > 1 ? "S" : ""} FAILED`
              : unchecked.length > 0
                ? `EVERY CHECK THAT COULD RUN PASSED · ${unchecked.length} COULD NOT`
                : "EVERY CHECK PASSED"}
          </p>

          <dl className="mono mt-5 space-y-2 text-[12px]">
            <Row k="Cutoff" v={new Date(market.cutoffAt * 1000).toUTCString()} />
            {market.isSettled ? (
              <>
                <Row k="Settled at" v={fmtPrice(market.settledPrice, dp)} />
                <Row
                  k="Print published"
                  v={`${fmtCountdown(Math.max(0, market.cutoffAt - market.settledAt))} before cutoff`}
                />
                <Row k="Publishers" v={String(market.settledSources)} />
              </>
            ) : (
              <Row k="State" v="still open" />
            )}
            <Row k="Staked" v={`${fmtStrk(market.staked, 4)} STRK`} />
            <Row k="Paid out" v={`${fmtStrk(market.paid, 4)} STRK`} />
            <Row k="House edge" v={`${market.houseEdgeBps} bps`} />
            <Row k="Sigma" v={`${(Number(market.sigma1e4) / 1e6).toFixed(4)}% of spot`} />
          </dl>

          <p className="mt-5 text-[11px] leading-relaxed text-white/40">
            Read from the market contract on Starknet {NETWORK}, not from a database. The
            positions in this market are hashes — nobody, including molfi, can list who held
            them — but everything the outcome depended on is above, and every line below
            recomputes one part of it.
          </p>
        </div>

        <div className="mt-4 space-y-3">
          {audit.checks.map((c) => (
            <CheckCard key={c.key} check={c} />
          ))}
        </div>

        <div className="mt-4 rounded-[22px] bg-card p-6">
          <div className="label">What stays hidden</div>
          <p className="mt-2 text-[13px] leading-relaxed text-white/60">
            Which bands were bought, how large each was, and whether any of them was yours.
            The totals above are public because conservation is only a promise if somebody
            can check it — and checking it needs two numbers, not a list of traders.
          </p>
          <Link
            href="/play"
            className="mt-5 block rounded-full bg-amber-2 py-3 text-center text-[13px] font-extrabold text-black"
          >
            OPEN THE CONSOLE
          </Link>
        </div>
      </div>
    </main>
  );
}

function CheckCard({ check }: { check: Check }) {
  const tone =
    check.verdict === "ok"
      ? { dot: "bg-green", text: "text-green", label: "PASS" }
      : check.verdict === "failed"
        ? { dot: "bg-red", text: "text-red", label: "FAIL" }
        : { dot: "bg-white/25", text: "text-white/45", label: "NOT RUN" };

  return (
    <div className="rounded-2xl bg-card p-5">
      <div className="flex items-baseline gap-2">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
        <p className="flex-1 text-[14px] font-semibold leading-snug">{check.claim}</p>
        <span className={`mono shrink-0 text-[10px] tracking-[0.1em] ${tone.text}`}>
          {tone.label}
        </span>
      </div>

      <dl className="mono mt-3 space-y-1 text-[11px]">
        <Row k="chain says" v={check.onChain} />
        <Row k="recomputed" v={check.recomputed} />
      </dl>

      {/* Why a check matters, next to the check. A verifier that lists green ticks without
          saying what a red one would have meant is decoration. */}
      <p className="mt-3 text-[11px] leading-relaxed text-white/40">{check.matters}</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-dim">{k}</dt>
      <dd className="tnum truncate text-right text-white/80">{v}</dd>
    </div>
  );
}
