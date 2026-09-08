/**
 * The price molfi settles against.
 *
 * Pyth was the obvious first choice and it does not work here: Pyth Core dropped Starknet on
 * 26 August 2026. The contracts are still deployed on both networks, which is the trap — they
 * answer, so a naive integration looks wired up, and every feed returns None. A market that
 * settles against an empty oracle is not a market.
 *
 * Pragma is Starknet's own oracle and is live: BTC, ETH and STRK all aggregate from ten or
 * more sources on mainnet. Sepolia's Pragma is effectively abandoned - the same call returns
 * a single source and a timestamp weeks old - so `freshness` below is not decoration. A stale
 * print is the one input that can silently settle every position wrongly, so it is checked
 * rather than trusted, and a caller that ignores the check has to ignore it deliberately.
 */

export const PRAGMA = {
  mainnet: "0x2a85bd616f912537c50a49a4076db02c00b29b2cdc8a197ce92ed1837fa875b",
  sepolia: "0x36031daa264c24520b11d93af622c848b2499b66b41d611bac95e13cfca131a",
} as const;

/** Pragma normalises spot medians to 8 decimals. */
export const PRICE_DECIMALS = 8;

/**
 * How old a print may be before molfi refuses to quote on it.
 *
 * 600s was chosen against a belief about Pragma that is true on the testnet relay and false on
 * mainnet: that a print arrives every seven to ten minutes. Mainnet's aggregator publishes on
 * *deviation*, not on a heartbeat. Measured over four and a half minutes of polling, BTC, ETH
 * and WBTC did not republish once and their prints aged from 1024s to 1309s; only STRK, the
 * most volatile of the four, printed twice. In a quiet hour those pairs go twenty minutes
 * between prints as a matter of course.
 *
 * So on mainnet a 600s rule does not protect anybody — it closes the desk for most of every
 * hour, which is what it did: every pair unquotable, the console showing dashes, on the chain
 * the product had just moved to.
 *
 * 1800s is the honest number for that oracle. It is deliberately still a refusal and not an
 * infinity: past half an hour the mark is old enough that the band around it is guesswork, and
 * the desk should say so rather than sell it. The staleness is shown on the deck either way —
 * quoting on an old price silently would be the actual dishonesty.
 */
export const MAX_PRICE_AGE_SECONDS =
  (process.env.NEXT_PUBLIC_NETWORK ?? process.env.MOLFI_NETWORK ?? "sepolia") === "mainnet"
    ? 1800
    : 600;

/**
 * The contract's own limit, which is looser than the desk's.
 *
 * Two different questions with two different answers. **Quoting** on a ten-minute-old price
 * means selling a band around a number that has moved, so the desk refuses at 600s.
 * **Settling** against one is the contract's rule and it is 900s. It is compiled into the
 * deployed class and cannot be widened from here, so on mainnet a round whose cutoff lands in
 * a quiet stretch waits for Pragma's next print before it can settle. The keeper retries every
 * cycle, so those markets settle late rather than never.
 *
 * Anything that decides whether a price is good enough to *act on chain* must use this one.
 * Using the desk's number there stalls the relay for a third of every publish cycle.
 */
export const SETTLEMENT_MAX_PRICE_AGE_SECONDS = 900;

export interface Print {
  /** Price in `decimals` fixed point, exactly as the oracle returned it. */
  raw: bigint;
  decimals: number;
  /** Unix seconds the aggregate was last updated on chain. */
  updatedAt: number;
  /** How many publishers went into the median. One source is not a median. */
  sources: number;
}

export interface Freshness {
  ageSeconds: number;
  fresh: boolean;
  /** Why it was rejected, when it was. Empty when the print is usable. */
  reason: string;
}

/**
 * Whether a print may be quoted on.
 *
 * Two independent ways a feed goes bad, and they need separate answers. An old print means
 * publishers stopped; a single-source print means the median is one opinion wearing a median's
 * clothes. Either one alone is disqualifying.
 */
export function freshness(
  print: Print,
  now = Math.floor(Date.now() / 1000),
  maxAgeSeconds = MAX_PRICE_AGE_SECONDS,
): Freshness {
  const ageSeconds = now - print.updatedAt;
  if (ageSeconds > maxAgeSeconds) {
    return {
      ageSeconds,
      fresh: false,
      reason: `last print is ${Math.round(ageSeconds / 60)} minutes old`,
    };
  }
  if (print.sources < 3) {
    return {
      ageSeconds,
      fresh: false,
      reason: `only ${print.sources} publisher${print.sources === 1 ? "" : "s"} in the median`,
    };
  }
  return { ageSeconds, fresh: true, reason: "" };
}

/** The oracle's fixed point, as a display number. Never used for settlement maths. */
export function toDisplay(print: Print): number {
  return Number(print.raw) / 10 ** print.decimals;
}

/**
 * The pair id Pragma keys a spot feed by: the label itself, as a short string.
 *
 * "BTC/USD" is seven ASCII bytes read as one felt. Cairo short strings are the ordinary way
 * to name things on Starknet, so this is the oracle's own encoding rather than a scheme
 * invented here.
 */
export function pairId(label: string): bigint {
  if (!/^[A-Z0-9]{2,6}\/[A-Z]{3}$/.test(label)) {
    throw new Error(`not a pair label: ${label}`);
  }
  let out = 0n;
  for (const byte of Buffer.from(label, "ascii")) out = (out << 8n) | BigInt(byte);
  return out;
}

/** Decodes what `get_data_median` returns, in declaration order. */
export function decodePrint(felts: readonly string[]): Print {
  if (felts.length < 4) throw new Error(`short oracle response: ${felts.length} felts`);
  return {
    raw: BigInt(felts[0]),
    decimals: Number(BigInt(felts[1])),
    updatedAt: Number(BigInt(felts[2])),
    sources: Number(BigInt(felts[3])),
  };
}
