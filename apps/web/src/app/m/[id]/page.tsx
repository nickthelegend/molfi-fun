import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckItYourself } from "@/components/CheckItYourself";
import { hash } from "starknet";
import {
  CALIBRATED_MARKETS,
  MARKETS,
  secondsLabel,
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
/**
 * Where the settled price sits in `get_market`'s flat return, counting from zero.
 *
 * Named because two places need it and they disagreed: the decoder read felts 8 and 9 —
 * correctly — while the "check it yourself" note under the curl told the reader to look at
 * 9 and 10. Anyone who followed the page's own instructions got `settled_at` as the high
 * limb of a price and a number in the 1e39s, on the one part of this page whose entire job
 * is to let a sceptic confirm the figure without trusting molfi.
 */
const SETTLED_PRICE_AT = 8;

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

    // Market, in declaration order: pair, cutoff_at, round_seconds, token, sigma_1e4,
    // house_edge_bps, settled_price, settled_at, settled_block_at, settled_sources,
    // is_settled, staked, paid. Every u256 is two felts, low limb first.
    return {
      id,
      pair: toLabel(r[0]),
      cutoffAt,
      roundSeconds: Number(BigInt(r[2])),
      sigma1e4: u256(r[4], r[5]),
      houseEdgeBps: u256(r[6], r[7]),
      settledPrice: u256(r[SETTLED_PRICE_AT], r[SETTLED_PRICE_AT + 1]),
      settledAt: Number(BigInt(r[10])),
      settledBlockAt: Number(BigInt(r[11])),
      settledSources: Number(BigInt(r[12])),
      isSettled: BigInt(r[13]) === 1n,
      staked: u256(r[14], r[15]),
      paid: u256(r[16], r[17]),
      bankroll: u256(r[18], r[19]),
      reserved: u256(r[20], r[21]),
      table: knots,
    };
  } catch {
    return null;
  }
}

/**
 * The `starknet_call` this page made, as a shell command.
 *
 * Built from the same address and selector the server used, so it cannot drift from what
 * was actually read — a "verify this yourself" command that quietly points somewhere else
 * is worse than none.
 */
function verifyCommand(id: number): string {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "starknet_call",
    params: [
      {
        contract_address: NETWORKS[NETWORK].market,
        entry_point_selector: hash.getSelectorFromName("get_market"),
        calldata: ["0x" + id.toString(16)],
      },
      "latest",
    ],
  });
  return [
    `curl -s ${NETWORKS[NETWORK].rpcUrl} \\`,
    `  -H 'content-type: application/json' \\`,
    `  -d '${body}'`,
  ].join("\n");
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Only a real id gets a market title. "molfi — market #abc" is a page claiming to be
  // about something that was never listed.
  if (!/^\d+$/.test(id)) return { title: "molfi — no such market" };
  return {
    title: `molfi — market #${id}`,
    description:
      "A settled molfi market, recomputed from published data. No wallet, no account, no position needed.",
  };
}

export default async function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const market = /^\d+$/.test(id) ? await readMarket(Number(id)) : null;

  // A 404 body under a 200 status reads correctly to a person and lies to everything else.
  if (!market) notFound();


  const audit = auditMarket(market);
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
            <Row k="Round" v={secondsLabel(market.roundSeconds)} />
            <Row k="Cutoff" v={new Date(market.cutoffAt * 1000).toUTCString()} />
            {market.isSettled ? (
              <>
                <Row k="Settled at" v={fmtPrice(market.settledPrice, dp)} />
                <Row
                  k="Print age at settlement"
                  v={fmtCountdown(Math.max(0, market.settledBlockAt - market.settledAt))}
                />
                <Row k="Publishers" v={String(market.settledSources)} />
              </>
            ) : (
              <Row k="State" v="still open" />
            )}
            <Row k="House edge" v={`${market.houseEdgeBps} bps`} />
            <Row k="Sigma" v={`${(Number(market.sigma1e4) / 1e6).toFixed(4)}% of spot`} />
          </dl>

          {/*
            The house's ledger, moved out of the headline.
            
            Staked, paid, bankroll and reserved were the four rows a reader hit first, above
            the price and the checks — a balance sheet where the answer to "what happened in
            this market" should be. They are still published, because conservation is only a
            promise if somebody can check it and checking needs the numbers; they now sit with
            the check that uses them instead of in front of the one thing a person came for.
          */}
          <details className="mt-4 rounded-xl bg-[#131313] p-3.5">
            <summary className="mono cursor-pointer text-[10px] tracking-[0.1em] text-white/35">
              the money behind this market
            </summary>
            <dl className="mono mt-3 grid gap-1 text-[11px]">
              <Row k="Staked" v={`${fmtStrk(market.staked, 6)} STRK`} />
              <Row k="Paid out" v={`${fmtStrk(market.paid, 6)} STRK`} />
              <Row k="House bankroll" v={`${fmtStrk(market.bankroll, 6)} STRK`} />
              <Row k="Owed to open positions" v={`${fmtStrk(market.reserved, 6)} STRK`} />
            </dl>
          </details>

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

        {/*
          * One line of curl, against a node nobody here operates.
          *
          * Everything above is molfi's own software reporting that molfi is correct, which
          * is worth nothing on its own. This returns the same felts from a public endpoint
          * so a sceptic can compare the settled price on this page with the one on the
          * chain, without cloning anything.
          */}
        <CheckItYourself
          command={verifyCommand(market.id)}
          note={`Returns market #${market.id} straight from a public Starknet node. Felts ${SETTLED_PRICE_AT} and ${SETTLED_PRICE_AT + 1} of the result — counting from zero — are the settled price as a u256, low limb first: divide the low limb by 1e8.`}
        />

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
