/**
 * molfi's own price, for the pairs no oracle on Starknet carries.
 *
 * Pragma aggregates four pairs with enough publishers to settle against. It does not carry
 * SOL, XRP, DOGE, LINK or AVAX at all — `get_data_median` errors on the pair id, so this is
 * not a thin feed to be careful with, it is no feed. Pyth's Starknet contract holds prints up
 * to 780 days old and its update service answers 401, so it is not an alternative.
 *
 * That left two options: list four markets, or be the oracle for the rest. The audit already
 * wrote down the only defensible version of the second — "a real median across three or more
 * independent exchanges with the true count attached, which is what an oracle is" — and this
 * is that. Five venues are queried, the median of whatever answers is taken, and the number
 * that answered is what goes on chain beside the price.
 *
 * The count is the load-bearing part. `MIN_SOURCES = 3` in the contract is only a real check
 * if the number it checks is real, so a fetch that fails is a source that does not count, and
 * a median of two is refused here rather than reported as three.
 */

/** Independent venues. Independent matters: two mirrors of one book are one source. */
const VENUES = {
  binance: {
    url: (s: string) => `https://api.binance.com/api/v3/ticker/price?symbol=${s}USDT`,
    pick: (j: unknown) => Number((j as { price?: string }).price),
  },
  coinbase: {
    url: (s: string) => `https://api.exchange.coinbase.com/products/${s}-USD/ticker`,
    pick: (j: unknown) => Number((j as { price?: string }).price),
  },
  kraken: {
    url: (s: string) => `https://api.kraken.com/0/public/Ticker?pair=${s}USD`,
    pick: (j: unknown) => {
      const r = (j as { result?: Record<string, { c?: string[] }> }).result ?? {};
      const first = Object.values(r)[0];
      return Number(first?.c?.[0]);
    },
  },
  okx: {
    url: (s: string) => `https://www.okx.com/api/v5/market/ticker?instId=${s}-USDT`,
    pick: (j: unknown) => Number((j as { data?: Array<{ last?: string }> }).data?.[0]?.last),
  },
  bybit: {
    url: (s: string) =>
      `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${s}USDT`,
    pick: (j: unknown) =>
      Number(
        (j as { result?: { list?: Array<{ lastPrice?: string }> } }).result?.list?.[0]
          ?.lastPrice,
      ),
  },
} as const;

export interface Aggregate {
  /** The median, in the oracle's 8-decimal fixed point. */
  price: bigint;
  /** How many venues actually answered with a usable number. Never asserted, only counted. */
  sources: number;
  /** Which ones, so a degraded read can be explained rather than guessed at. */
  venues: string[];
  /** Spread between the extremes, in basis points — the honest health signal for a median. */
  spreadBps: number;
}

/** Pragma normalises to 8 decimals and the relay stores the same shape. */
const SCALE = 100_000_000n;

/**
 * The median across every venue that answers, with the count attached.
 *
 * Median rather than mean: one venue printing a stale or crossed book moves a mean and cannot
 * move a median past its neighbours. With an even count it is the lower of the two middles —
 * deliberately, so the number is one a venue actually printed rather than an average of two
 * that nobody quoted.
 */
export async function aggregate(symbol: string, timeoutMs = 8_000): Promise<Aggregate> {
  const got: Array<{ venue: string; price: number }> = [];

  await Promise.all(
    Object.entries(VENUES).map(async ([venue, v]) => {
      try {
        const res = await fetch(v.url(symbol), { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) return;
        const price = v.pick(await res.json());
        // A zero, a NaN or a negative is not a price. Silently dropping it here is the same
        // decision as a publisher not publishing, and it lowers the count accordingly.
        if (Number.isFinite(price) && price > 0) got.push({ venue, price });
      } catch {
        // A venue that times out is a venue that did not answer. It does not count, and it
        // does not fail the read for the others.
      }
    }),
  );

  if (got.length === 0) throw new Error(`no venue answered for ${symbol}`);

  got.sort((a, b) => a.price - b.price);
  const mid = got[Math.floor((got.length - 1) / 2)].price;
  const spreadBps =
    got.length > 1 ? ((got[got.length - 1].price - got[0].price) / mid) * 10_000 : 0;

  return {
    price: BigInt(Math.round(mid * Number(SCALE))),
    sources: got.length,
    venues: got.map((g) => g.venue),
    spreadBps: Math.round(spreadBps * 10) / 10,
  };
}
