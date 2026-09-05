import { NextResponse } from "next/server";
import { hash } from "starknet";
import { MARKETS, PRAGMA, decodePrint, freshness, pairId, toDisplay } from "@molfi/sdk";
import { NETWORK, call } from "@/lib/rpc.ts";

/**
 * Prices, fetched server-side. Two of them, and the difference matters.
 *
 * **The mark** is a live exchange price. It is what the desk shows and what the band is
 * painted against, because Pragma republishes every few minutes and a price frozen for
 * seven of them makes a trading screen unusable.
 *
 * **The settlement price** is Pragma's on-chain median, with its age and publisher count
 * attached. It is the only number that decides whether a band held, and the only one the
 * contract can see. A mark that has run away from it is not a reason to settle differently;
 * it is a reason to say so, which is why the freshness verdict travels with the price
 * instead of being recomputed by whoever felt like it.
 *
 * There is deliberately no fallback for either. If an upstream is unreachable this returns
 * an error and the desk says so, rather than opening a market on a number nobody observed.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The tape each market is marked and calibrated against. Never used to settle. */
const BINANCE: Record<string, string> = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  STRK: "STRKUSDT",
};

/** Decimal string -> 8dp fixed point, without touching floating point. */
function to8dp(s: string): bigint {
  const [w, d = ""] = s.trim().split(".");
  return BigInt(w || "0") * 100_000_000n + BigInt((d + "00000000").slice(0, 8));
}

/**
 * Recent one-minute closes. The demo desk walks its price by replaying these real returns
 * rather than drawing from a bell curve: the pricing tables were measured on exactly this
 * data at exactly this resolution, so replaying it is what makes the desk's realised win
 * rate match the probability it quotes.
 *
 * Minutes rather than seconds because molfi's shortest round is fifteen minutes. Second
 * resolution would be a thousand samples covering a sixth of one round — not enough tape to
 * replay a round at all, let alone enough to reproduce the distribution it was priced from.
 */
async function binanceHistory(symbol: string, limit: number) {
  const r = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=${limit}`,
    { signal: AbortSignal.timeout(12_000), cache: "no-store" },
  );
  if (!r.ok) throw new Error(`binance klines ${r.status}`);
  const rows = (await r.json()) as unknown[][];
  return rows.map((k) => Number(k[4]));
}

/**
 * The settlement price: Pragma's median, read from the chain molfi settles on.
 *
 * Its age and breadth come back with it. A caller that wants to quote against a stale or
 * single-publisher print has to ignore an explicit refusal rather than simply not having
 * asked for one.
 */
async function pragma(pair: string) {
  const raw = await call(
    PRAGMA[NETWORK === "sepolia" ? "sepolia" : "mainnet"],
    hash.getSelectorFromName("get_data_median"),
    // DataType::SpotEntry(pair_id) — variant index, then the felt.
    ["0x0", "0x" + pairId(pair).toString(16)],
  );
  const print = decodePrint(raw);
  const check = freshness(print);
  return {
    price: print.raw,
    display: toDisplay(print),
    decimals: print.decimals,
    updatedAt: print.updatedAt,
    sources: print.sources,
    ageSeconds: check.ageSeconds,
    quotable: check.fresh,
    refusal: check.reason,
  };
}

async function binance(symbol: string) {
  const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, {
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`binance ${r.status}`);
  const j = (await r.json()) as { price: string };
  return { price: to8dp(j.price), source: `binance:${symbol}` };
}

/**
 * A short server-side cache, and a cap on how often one caller may miss it.
 *
 * Every open desk polls this, so on a public host the upstreams see the sum of all
 * visitors rather than one client. Binance answers that with a 418 and then a ban, at
 * which point the desk correctly refuses to show a price and the demo is over — a
 * self-inflicted outage that looks exactly like the honest failure it is designed to
 * report.
 *
 * The cache is deliberately shorter than the desk's own poll interval for the mark, so the
 * price on screen still moves; history is a thousand one-minute closes that change far more
 * slowly than they cost to fetch, so it is held longer. The oracle is cached longest of all
 * because it genuinely does not change more often than that — republishing is minutes apart,
 * and asking a node again inside one publish cycle returns the identical print.
 *
 * None of it is a fallback: a miss on a dead upstream still returns the error. A
 * stale-but-real price is served for a few seconds; a made-up one never is.
 */
const SPOT_TTL_MS = 1_000;
const HISTORY_TTL_MS = 30_000;
const ORACLE_TTL_MS = 20_000;

type Entry = { at: number; value: unknown };
const cache = new Map<string, Entry>();
/** In-flight fetches, so N simultaneous misses make one upstream call, not N. */
const inflight = new Map<string, Promise<unknown>>();

async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;

  const running = inflight.get(key);
  if (running) return running as Promise<T>;

  const p = fetcher()
    .then((v) => {
      cache.set(key, { at: Date.now(), value: v });
      return v;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p as Promise<unknown>);
  return p;
}

/**
 * Per-caller rate limit.
 *
 * The cache already protects the upstream; this protects the host from one client
 * looping on it. A fixed window is enough here — the limit is generous relative to the
 * desk's real poll rate, so a normal visitor never sees it, and the failure mode of
 * being slightly too permissive at a window boundary is uninteresting.
 */
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 60;
const hits = new Map<string, { windowStart: number; n: number }>();

function overLimit(who: string): boolean {
  const now = Date.now();
  const h = hits.get(who);
  if (!h || now - h.windowStart >= RATE_WINDOW_MS) {
    hits.set(who, { windowStart: now, n: 1 });
    if (hits.size > 5_000) {
      // Bound the map. Anything whose window has passed cannot be over the limit.
      for (const [k, v] of hits) if (now - v.windowStart >= RATE_WINDOW_MS) hits.delete(k);
    }
    return false;
  }
  h.n += 1;
  return h.n > RATE_MAX;
}

function callerOf(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0] : null)?.trim() || req.headers.get("x-real-ip") || "local";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const market = (url.searchParams.get("market") ?? "BTC").toUpperCase();
  const wantHistory = url.searchParams.get("history") === "1";
  const def = MARKETS.find((m) => m.key === market);

  if (overLimit(callerOf(req))) {
    return NextResponse.json(
      { market, error: `rate limited: more than ${RATE_MAX} requests in ${RATE_WINDOW_MS / 1000}s` },
      {
        status: 429,
        headers: {
          "cache-control": "no-store",
          "retry-after": String(Math.ceil(RATE_WINDOW_MS / 1000)),
        },
      },
    );
  }

  if (!def) {
    return NextResponse.json(
      { market, error: `molfi does not list ${market}` },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  const symbol = BINANCE[market];

  try {
    const got = await cached(`spot:${market}`, SPOT_TTL_MS, () => binance(symbol));
    if (got.price <= 0n) throw new Error("non-positive price");

    let returns: number[] | undefined;
    if (wantHistory) {
      const closes = await cached(`hist:${symbol}`, HISTORY_TTL_MS, () =>
        binanceHistory(symbol, 1000),
      );
      returns = [];
      for (let i = 1; i < closes.length; i++) {
        if (closes[i - 1] > 0 && closes[i] > 0) returns.push(Math.log(closes[i] / closes[i - 1]));
      }
    }

    // The oracle is asked for separately and allowed to fail on its own. A node that is
    // down should not take the demo desk with it — but it must not be silently absent
    // either, so the failure is reported in place rather than omitted.
    let oracle: Awaited<ReturnType<typeof pragma>> | null = null;
    let oracleError: string | null = null;
    try {
      oracle = await cached(`oracle:${market}`, ORACLE_TTL_MS, () => pragma(def.label));
    } catch (e) {
      oracleError = (e as Error).message;
    }

    return NextResponse.json(
      {
        market,
        pair: def.label,
        // The mark. What the screen shows between publishes.
        price: got.price.toString(),
        decimals: 8,
        source: got.source,
        at: Date.now(),
        // The settlement price. What the contract sees, and the only thing that resolves
        // a band.
        oracle: oracle
          ? {
              network: NETWORK,
              price: oracle.price.toString(),
              display: oracle.display,
              decimals: oracle.decimals,
              updatedAt: oracle.updatedAt,
              sources: oracle.sources,
              ageSeconds: oracle.ageSeconds,
              quotable: oracle.quotable,
              refusal: oracle.refusal,
            }
          : null,
        oracleError,
        ...(returns ? { returns, returnsInterval: "1m" } : {}),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { market, error: (e as Error).message },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
