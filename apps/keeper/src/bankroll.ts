/**
 * How much the desk puts behind a market, and how much it is allowed to spend doing it.
 *
 * Extracted from `index.ts` for the same reason `bounds.ts` was: this is arithmetic with no
 * network and no environment in it, it decides whether the desk keeps running, and it has now
 * been wrong twice in production. Both times the keeper emptied itself and stopped listing
 * anything — which takes the whole product offline, because a desk with no open market is a
 * desk nobody can trade on.
 *
 * The first version used a flat amount per market. That is fine at four markets and arithmetic
 * at nine: `fund_market` is one-way, so every market ever listed locks its backing for ever,
 * and a constant times a growing market count walks straight through the floor.
 *
 * The second version divided what was spendable by the number of markets. That is a *share*,
 * not a budget — funding all of them spends the entire amount by construction, every cycle, and
 * any drift between the count used for the division and the count actually funded takes it
 * past the floor. It did: 94 STRK to 0.01 with nothing listed.
 *
 * So there are two functions here and they do different jobs. `bankrollFor` sizes one market.
 * `affordableCount` says how many of them the balance can actually stand behind. The caller
 * needs both, and the floor is only a floor if it is checked against the running total.
 */

/**
 * What one market gets: the ceiling, or an equal share of what is spendable, whichever is
 * smaller. Zero when nothing is spendable, which the caller must treat as "do not list".
 */
export function bankrollFor(
  balance: bigint,
  markets: number,
  floor: bigint,
  ceiling: bigint,
): bigint {
  if (markets <= 0) return 0n;
  const spendable = balance > floor ? balance - floor : 0n;
  const share = spendable / BigInt(markets);
  return share < ceiling ? share : ceiling;
}

/**
 * How many markets can be funded at `per` without breaching the floor.
 *
 * The number the loop must actually stop at. Deriving it from the same balance and floor the
 * per-market amount came from is what stops the two disagreeing — which is the exact shape of
 * the second drain.
 */
export function affordableCount(balance: bigint, per: bigint, floor: bigint): number {
  if (per <= 0n) return 0;
  const spendable = balance > floor ? balance - floor : 0n;
  return Number(spendable / per);
}
