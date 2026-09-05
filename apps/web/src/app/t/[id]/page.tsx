import Link from "next/link";
import { createPublicClient, defineChain, http, type Address } from "viem";
import { KuruOracleAbi, MARKETS, RangeMarketAbi } from "@molfi/sdk";

/**
 * One ticket, by id, readable by anyone.
 *
 * Rendered on the server from a contract call rather than from anything we stored, so
 * the link says what the chain says. That matters more here than convenience: a shared
 * result that came out of our own database would be a screenshot with extra steps, and
 * the entire claim of this project is that the outcome is a fact rather than a report.
 *
 * A ticket that does not exist, or a deployment with no market, says so plainly rather
 * than rendering an empty frame.
 */
export const dynamic = "force-dynamic";

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 143);
const RPC = process.env.RPC_UPSTREAM ?? "https://rpc.monad.xyz";
const RANGE = process.env.NEXT_PUBLIC_RANGE_MARKET as Address | undefined;
const KURU_ORACLE = process.env.NEXT_PUBLIC_KURU_ORACLE as Address | undefined;
/** keccak256("MON-USD") */
const MON_ID = "0x92bcb7355458a976a0b6be05319d37cc66bc1792624ca67226af747c1de28f62" as const;

const STATUS = ["open", "won", "lost", "void"] as const;

async function readTicket(id: bigint) {
  if (!RANGE) return null;
  const chain = defineChain({
    id: CHAIN_ID,
    name: "monad",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  });
  const pub = createPublicClient({ chain, transport: http(RPC) });
  try {
    // Let the ABI decide the shape; guessing it is how you end up rendering
    // `undefined` for a field the contract calls something else.
    const t = await pub.readContract({
      address: RANGE,
      abi: RangeMarketAbi,
      functionName: "getTicket",
      args: [id],
    });
    if (t.player === "0x0000000000000000000000000000000000000000") return null;
    return t;
  } catch {
    return null;
  }
}

/**
 * The book as it stood at the block this ticket settled on.
 *
 * The receipt is only a receipt if the conditions are on it. A settled price with no
 * book behind it asks the reader to trust that the number was reasonable; the touch and
 * the spread at that exact block let them decide for themselves. Read with the same
 * contract call the oracle uses, at a block tag — nothing is stored for this.
 *
 * Only meaningful for the market priced from the book, and only where an archive node
 * still has that state. Absent is absent; it is not filled in with the current book.
 */
async function bookAtSettlement(
  pub: ReturnType<typeof createPublicClient>,
  marketId: string,
  atBlock: bigint,
) {
  if (!KURU_ORACLE || marketId.toLowerCase() !== MON_ID) return null;
  try {
    const [bid, ask, mid, spreadBps] = (await pub.readContract({
      address: KURU_ORACLE,
      abi: KuruOracleAbi,
      functionName: "quoteTop",
      blockNumber: atBlock,
      args: [MON_ID],
    })) as readonly [bigint, bigint, bigint, bigint];
    if (mid === 0n) return null;
    return { bid, ask, mid, spreadBps: Number(spreadBps) };
  } catch {
    return null;
  }
}

const usd = (v: bigint) => `$${(Number(v) / 1e6).toFixed(2)}`;
/**
 * Prices at the market's own precision.
 *
 * Two decimals is right for BTC at seventy-seven thousand and destroys MON at two and
 * a half cents — this page rendered a whole ticket's band as "0.03 – 0.03", which is
 * not a rounding annoyance but a receipt that says nothing. Each market already carries
 * the number of decimals it should be read at.
 */
const dpOf = (marketId: string) =>
  MARKETS.find((m) => m.marketId.toLowerCase() === marketId.toLowerCase())?.dp ?? 2;

const px = (v: bigint, dp: number) =>
  (Number(v) / 1e8).toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });

/**
 * Enough decimals to tell the two edges apart.
 *
 * A market's display precision is chosen for reading a price, not for reading a band,
 * and the tightest bands are narrower than it — MON's is five decimals while its venue
 * quotes six, so a real 0.8 bps band rendered as "0.02519 – 0.02519". A receipt whose
 * two numbers are the same number is not a receipt. Widen until they differ, and never
 * narrow below the market's own setting.
 */
function bandDp(low: bigint, high: bigint, dp: number): number {
  for (let d = dp; d <= 8; d++) {
    if (px(low, d) !== px(high, d)) return d;
  }
  return 8;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return {
    title: `XORR — ticket #${id}`,
    description: "A range ticket on Monad, settled at a block anyone can check.",
  };
}

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = /^\d+$/.test(id) ? await readTicket(BigInt(id)) : null;

  if (!t) {
    return (
      <main className="tiled grid min-h-dvh place-items-center px-5">
        <div className="w-full max-w-[380px] rounded-[22px] bg-card p-6 text-center">
          <p className="text-[15px] font-semibold">No ticket #{id}</p>
          <p className="mt-3 text-[13px] leading-relaxed text-white/50">
            {RANGE
              ? "This market has no ticket with that id."
              : "This deployment has no range market — the console here runs on paper."}
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

  const chain = defineChain({
    id: CHAIN_ID,
    name: "monad",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  });
  const book = await bookAtSettlement(
    createPublicClient({ chain, transport: http(RPC) }),
    t.marketId,
    BigInt(t.expiryBlock),
  );

  const dp = dpOf(t.marketId);
  const market = MARKETS.find((m) => m.marketId.toLowerCase() === t.marketId.toLowerCase());
  const marketKey = market?.key ?? "BTC";
  /**
   * The band as half-widths around its own centre, in 1e4-scaled bps — the units the
   * contract's `fireBand` uses. Derived from the stored endpoints rather than stored
   * separately, so this cannot drift from what actually settled.
   */
  const centre = (t.low + t.high) / 2n;
  const lowHalfBps = centre > 0n ? ((centre - t.low) * 100_000_000n) / centre : 0n;
  const highHalfBps = centre > 0n ? ((t.high - centre) * 100_000_000n) / centre : 0n;
  const status = STATUS[t.status] ?? "open";
  const won = status === "won";
  const tone = won ? "text-green" : status === "lost" ? "text-red" : "text-white/70";

  return (
    <main className="tiled grid min-h-dvh place-items-center px-5 py-10">
      <div className="w-full max-w-[380px] rounded-[22px] bg-card p-6">
        <div className="label">XORR · ticket #{id}</div>

        <div className={`tnum mt-2 text-[34px] font-bold leading-none ${tone}`}>
          {status === "won"
            ? `+${usd(t.payout - t.stake)}`
            : status === "lost"
              ? `−${usd(t.stake)}`
              : status.toUpperCase()}
        </div>

        <div className="mono mt-5 space-y-2 text-[12px]">
          <Row k="Band" v={`${px(t.low, bandDp(t.low, t.high, dp))} – ${px(t.high, bandDp(t.low, t.high, dp))}`} />
          <Row k="Stake" v={usd(t.stake)} />
          <Row k="Multiplier" v={`${(t.multiplierBps / 10_000).toFixed(2)}x`} />
          <Row k="Cutoff block" v={t.expiryBlock.toLocaleString()} />
          {t.settledPrice > 0n ? <Row k="Printed at" v={px(t.settledPrice, dp)} /> : null}
          <Row k="Owner" v={`${t.player.slice(0, 6)}…${t.player.slice(-4)}`} />
        </div>

        {book ? (
          <div className="mt-5 rounded-xl bg-[#0d0d0d] p-3">
            <div className="label">The book at that block</div>
            <div className="mono mt-2 space-y-2 text-[12px]">
              <Row k="Touch" v={`${px(book.bid, dp)} / ${px(book.ask, dp)}`} />
              <Row k="Spread" v={`${book.spreadBps} bps`} />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/35">
              Read back from the chain at block {t.expiryBlock.toLocaleString()} with the
              same call the oracle makes — nothing was stored for this.
            </p>
          </div>
        ) : null}

        <p className="mt-5 text-[11px] leading-relaxed text-white/40">
          Read from the market contract on chain {CHAIN_ID}, not from a database. The
          cutoff is a block number, so this outcome is a fact rather than a report of
          one.
        </p>

        {/*
          * Take the same shape, not the same prices.
          *
          * The band is passed as its half-widths in bps, which is what `fireBand`
          * itself takes — the market centres a shape on the print at execution, so a
          * band copied as absolute prices would be a band around a price that has
          * since moved. Copying the shape is copying the trade; copying the numbers
          * would be copying a moment.
          */}
        <Link
          href={`/play?lowBps=${lowHalfBps}&highBps=${highHalfBps}&market=${marketKey}`}
          className="mt-5 block rounded-full bg-amber-2 py-3 text-center text-[13px] font-extrabold text-black"
        >
          TAKE THIS BAND
        </Link>
        <Link
          href="/play"
          className="mt-2 block py-2 text-center text-[12px] text-white/45 underline"
        >
          or open the console
        </Link>
      </div>
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-dim">{k}</span>
      <span className="tnum text-white/80">{v}</span>
    </div>
  );
}
