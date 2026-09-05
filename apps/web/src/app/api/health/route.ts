import { NextResponse } from "next/server";
import { createPublicClient, defineChain, http, type Address, type Hex } from "viem";
import { IKuruOrderBookAbi, KuruOracleAbi, OracleRouterAbi } from "@molfi/sdk";

/**
 * Is this deployment actually working right now?
 *
 * Three things can be true or false independently, and a demo fails differently for
 * each: the chain can be unreachable, the keeper can have stopped publishing while the
 * chain carries on, and Kuru's book can go thin while both of the others are fine.
 * Collapsing them into one "ok" would hide exactly the distinction worth having, so
 * each is reported on its own with the evidence behind it.
 *
 * Every number here comes from a contract call. There is no cached status to go stale.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 143);
const RPC = process.env.RPC_UPSTREAM ?? "https://rpc.monad.xyz";
const ORACLE = process.env.NEXT_PUBLIC_ORACLE as Address | undefined;
const KURU_ORACLE = process.env.NEXT_PUBLIC_KURU_ORACLE as Address | undefined;

/** keccak256("BTC-USD") — the market the keeper publishes most often. */
const BTC_ID = "0xb39c402b9bd8428ba7a4cc2d1aca1432756cddeb60941a9175541a819095269e" as Hex;
/** keccak256("MON-USD") — priced from Kuru's book. */
const MON_ID = "0x92bcb7355458a976a0b6be05319d37cc66bc1792624ca67226af747c1de28f62" as Hex;

/** A push feed older than this has stopped, whatever it claims. */
const KEEPER_STALE_S = 30;

/**
 * "absent" is not "down".
 *
 * A deployment with no XORR contracts — the hosted build reads Kuru's market and runs
 * the paper desk, and has no chain of its own — has no keeper to be down. Reporting it
 * as down makes the endpoint return 503 for a service that is working exactly as
 * configured, which is the same class of false alarm as scoring an unmeasured book as
 * thin. Say the component is not part of this deployment instead.
 */
type Part = {
  status: "ok" | "degraded" | "down" | "absent";
  detail?: string;
  [k: string]: unknown;
};

export async function GET() {
  const chain = defineChain({
    id: CHAIN_ID,
    name: "monad",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  });
  const pub = createPublicClient({ chain, transport: http(RPC) });

  // ---- the chain
  let chainPart: Part = { status: "down", detail: "unreachable" };
  let block: bigint | null = null;
  try {
    block = await pub.getBlockNumber();
    chainPart = { status: "ok", block: block.toString(), chainId: CHAIN_ID };
  } catch (e) {
    chainPart = { status: "down", detail: (e as Error).message.slice(0, 120), chainId: CHAIN_ID };
  }

  // ---- the keeper, measured by how old its last print is rather than by asking it
  let keeper: Part = {
    status: "absent",
    detail: "no push oracle in this deployment — the desk runs on measured tape, not a feed",
  };
  if (ORACLE && chainPart.status === "ok") {
    try {
      const [price, updatedAt] = (await pub.readContract({
        address: ORACLE,
        abi: OracleRouterAbi,
        functionName: "latest",
        args: [BTC_ID],
      })) as readonly [bigint, bigint];
      const ageS = Math.max(0, Math.floor(Date.now() / 1000) - Number(updatedAt));
      keeper = {
        status: ageS <= KEEPER_STALE_S ? "ok" : "degraded",
        detail:
          ageS <= KEEPER_STALE_S
            ? `last BTC print ${ageS}s ago`
            : `last BTC print ${ageS}s ago — over the ${KEEPER_STALE_S}s limit, the keeper has stopped`,
        lastPrice: (Number(price) / 1e8).toFixed(2),
        ageSeconds: ageS,
      };
    } catch (e) {
      keeper = { status: "down", detail: (e as Error).message.slice(0, 120) };
    }
  }

  // ---- Kuru's book, through XORR's own oracle rather than an API
  let book: Part = {
    status: "absent",
    detail: "KuruOracle is not deployed here; the book is read directly from the venue",
  };
  const KURU_BOOK = process.env.NEXT_PUBLIC_KURU_BOOK as Address | undefined;
  if (!KURU_ORACLE && KURU_BOOK && chainPart.status === "ok") {
    // No oracle, but the venue is still readable — and whether the venue answers is
    // the thing worth reporting on a build that has nothing else on-chain.
    try {
      const top = (await pub.readContract({
        address: KURU_BOOK,
        abi: IKuruOrderBookAbi,
        functionName: "bestBidAsk",
      })) as readonly [bigint, bigint];
      const bid = Number(top[0] / 10_000_000_000n) / 1e8;
      const ask = Number(top[1] / 10_000_000_000n) / 1e8;
      book = {
        status: bid > 0 && ask > bid ? "ok" : "degraded",
        detail:
          bid > 0 && ask > bid
            ? `Kuru's touch reads ${bid.toFixed(6)} / ${ask.toFixed(6)} — read directly, KuruOracle is not deployed here`
            : "the venue's book is one-sided or crossed",
        bid: bid.toFixed(6),
        ask: ask.toFixed(6),
      };
    } catch (e) {
      book = { status: "down", detail: (e as Error).message.slice(0, 120) };
    }
  } else if (KURU_ORACLE && chainPart.status === "ok") {
    try {
      const [bid, ask, mid, spreadBps] = (await pub.readContract({
        address: KURU_ORACLE,
        abi: KuruOracleAbi,
        functionName: "quoteTop",
        args: [MON_ID],
      })) as readonly [bigint, bigint, bigint, bigint];
      const ok = bid > 0n && ask > bid;
      book = {
        status: ok ? "ok" : "degraded",
        detail: ok
          ? `mid ${(Number(mid) / 1e8).toFixed(6)} at ${spreadBps} bps`
          : "the book is one-sided or crossed — the oracle is refusing to price it",
        bid: (Number(bid) / 1e8).toFixed(6),
        ask: (Number(ask) / 1e8).toFixed(6),
        spreadBps: Number(spreadBps),
      };
    } catch (e) {
      // A guard tripping is the oracle working, not the service failing.
      const msg = (e as Error).message;
      book = {
        status: "degraded",
        detail: /NoPrice|BadSpread|NoBook/.test(msg)
          ? "the oracle is refusing to price this book — a guard is holding"
          : msg.slice(0, 120),
      };
    }
  }

  const parts = [chainPart, keeper, book];
  const status = parts.some((p) => p.status === "down")
    ? "down"
    : parts.some((p) => p.status === "degraded")
      ? "degraded"
      : "ok";
  // An absent component never makes the deployment unhealthy; it was never here.

  return NextResponse.json(
    { status, chain: chainPart, keeper, book, checkedAt: new Date().toISOString() },
    {
      status: status === "down" ? 503 : 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
