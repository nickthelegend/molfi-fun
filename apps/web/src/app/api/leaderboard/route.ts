import { NextResponse } from "next/server";
import { createPublicClient, defineChain, http, type Address } from "viem";
import { RangeMarketAbi } from "@molfi/sdk";

/**
 * Standings, aggregated from the chain.
 *
 * Every row here is derived from real TicketFired / TicketSettled logs emitted by the
 * deployed RangeMarket — there is no seeded field of invented players. An address's
 * net is simply what it was paid less what it staked, across settled tickets. A void
 * nets to zero on its own because the refund equals the stake.
 *
 * With no deployment configured, this returns an empty board rather than inventing one.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 143);
// Server-side, so dial the node directly. NEXT_PUBLIC_RPC_URL is the browser's path to
// the proxy and is meaningless here.
const RPC = process.env.RPC_UPSTREAM ?? "https://rpc.monad.xyz";
const RANGE = process.env.NEXT_PUBLIC_RANGE_MARKET as Address | undefined;

/**
 * Never scan before the market existed. Besides being pointless, on a forked node any
 * range reaching below the fork block is served by the upstream RPC, which rejects
 * wide historical log queries.
 */
const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK ?? 0);

/** Ceiling on the window, so a long-lived deployment cannot grow an unbounded query. */
const MAX_WINDOW = BigInt(process.env.LEADERBOARD_LOOKBACK ?? 500_000);

export async function GET() {
  if (!RANGE) {
    return NextResponse.json({ configured: false, rows: [] }, { headers: { "cache-control": "no-store" } });
  }

  const chain = defineChain({
    id: CHAIN_ID,
    name: "monad",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  });
  const pub = createPublicClient({ chain, transport: http(RPC) });

  try {
    const head = await pub.getBlockNumber();
    const windowStart = head > MAX_WINDOW ? head - MAX_WINDOW : 0n;
    const from = DEPLOY_BLOCK > windowStart ? DEPLOY_BLOCK : windowStart;

    const [fired, settled] = await Promise.all([
      pub.getContractEvents({
        address: RANGE,
        abi: RangeMarketAbi,
        eventName: "TicketFired",
        fromBlock: from,
        toBlock: head,
      }),
      pub.getContractEvents({
        address: RANGE,
        abi: RangeMarketAbi,
        eventName: "TicketSettled",
        fromBlock: from,
        toBlock: head,
      }),
    ]);

    const stakeById = new Map<string, bigint>();
    for (const ev of fired) {
      const a = ev.args as { id?: bigint; stake?: bigint };
      if (a.id !== undefined && a.stake !== undefined) stakeById.set(a.id.toString(), a.stake);
    }

    const net = new Map<string, { pnl: bigint; plays: number; wins: number }>();
    for (const ev of settled) {
      const a = ev.args as { id?: bigint; player?: Address; status?: number; paid?: bigint };
      if (a.id === undefined || !a.player) continue;
      const stake = stakeById.get(a.id.toString());
      if (stake === undefined) continue; // fired before the scan window

      const cur = net.get(a.player) ?? { pnl: 0n, plays: 0, wins: 0 };
      cur.pnl += (a.paid ?? 0n) - stake;
      cur.plays += 1;
      if (a.status === 1) cur.wins += 1;
      net.set(a.player, cur);
    }

    const rows = [...net.entries()]
      .map(([address, v]) => ({
        address,
        pnl: v.pnl.toString(),
        plays: v.plays,
        wins: v.wins,
      }))
      .sort((a, b) => (BigInt(b.pnl) > BigInt(a.pnl) ? 1 : BigInt(b.pnl) < BigInt(a.pnl) ? -1 : 0));

    return NextResponse.json(
      { configured: true, chainId: CHAIN_ID, scannedFrom: from.toString(), head: head.toString(), rows },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { configured: true, error: (e as Error).message, rows: [] },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
