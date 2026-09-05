/**
 * Order-book arithmetic.
 *
 * Quoting a trade against a real book means walking it. A single "price" is only the
 * top level, and anything larger than what rests there gets progressively worse fills —
 * which is exactly the number a player needs to see before they swap. Everything here
 * works on the depth read from the chain, so the estimate and the execution are looking
 * at the same orders.
 */

export interface Level {
  /** Price in quote per base. */
  price: number;
  /** Size in base units. */
  size: number;
}

export interface Fill {
  /** Base actually filled. */
  filled: number;
  /** Quote received (selling) or spent (buying). */
  proceeds: number;
  /** Weighted average price across the levels consumed. */
  averagePrice: number;
  /** How far the average sits from the touch, in bps. Always >= 0. */
  slippageBps: number;
  /** Levels the order would eat through. */
  levelsConsumed: number;
  /** True when the book ran out before the order was filled. */
  partial: boolean;
}

const EMPTY: Fill = {
  filled: 0,
  proceeds: 0,
  averagePrice: 0,
  slippageBps: 0,
  levelsConsumed: 0,
  partial: true,
};

/**
 * Sell `size` of the base asset into the bids.
 *
 * @param bids best first, descending in price
 */
export function quoteSell(bids: Level[], size: number): Fill {
  if (size <= 0 || bids.length === 0) return EMPTY;

  const touch = bids[0].price;
  let remaining = size;
  let proceeds = 0;
  let levels = 0;

  for (const level of bids) {
    if (remaining <= 0) break;
    if (level.size <= 0) continue;
    const take = Math.min(remaining, level.size);
    proceeds += take * level.price;
    remaining -= take;
    levels += 1;
  }

  const filled = size - remaining;
  if (filled <= 0) return EMPTY;

  const averagePrice = proceeds / filled;
  // Selling fills at or below the touch, so the average can only be worse.
  const slippageBps = touch > 0 ? Math.max(0, ((touch - averagePrice) / touch) * 10_000) : 0;

  return {
    filled,
    proceeds,
    averagePrice,
    slippageBps,
    levelsConsumed: levels,
    partial: remaining > 1e-12,
  };
}

/**
 * Buy `size` of the base asset from the asks.
 *
 * @param asks best first, ascending in price
 */
export function quoteBuy(asks: Level[], size: number): Fill {
  if (size <= 0 || asks.length === 0) return EMPTY;

  const touch = asks[0].price;
  let remaining = size;
  let cost = 0;
  let levels = 0;

  for (const level of asks) {
    if (remaining <= 0) break;
    if (level.size <= 0) continue;
    const take = Math.min(remaining, level.size);
    cost += take * level.price;
    remaining -= take;
    levels += 1;
  }

  const filled = size - remaining;
  if (filled <= 0) return EMPTY;

  const averagePrice = cost / filled;
  const slippageBps = touch > 0 ? Math.max(0, ((averagePrice - touch) / touch) * 10_000) : 0;

  return {
    filled,
    proceeds: cost,
    averagePrice,
    slippageBps,
    levelsConsumed: levels,
    partial: remaining > 1e-12,
  };
}

/** Total base resting within `bps` of the mid, both sides. A depth-at-a-glance number. */
export function depthWithin(bids: Level[], asks: Level[], bps: number): number {
  const best = bids[0]?.price ?? 0;
  const ask = asks[0]?.price ?? 0;
  if (!best || !ask) return 0;
  const mid = (best + ask) / 2;
  const band = (mid * bps) / 10_000;
  return [...bids, ...asks]
    .filter((l) => Math.abs(l.price - mid) <= band)
    .reduce((a, l) => a + l.size, 0);
}

/**
 * What it would cost to push the mark to a target price by eating the book.
 *
 * An attacker who wants a range to settle outside its band has to move the midpoint,
 * and the only way to move a midpoint is to consume one side until the touch is where
 * they want it. This walks the real ladder and reports what that takes — how many
 * levels, how much base, and how much quote they would have to put up.
 *
 * Two things it deliberately does NOT pretend.
 *
 * It is a lower bound, not a price. The cost of holding the book there for the length
 * of the settlement window is larger and unknowable from a snapshot: every second they
 * hold it, someone else's resting order can refill the level they just cleared, and
 * they pay the spread again to unwind. The number here is what it costs to get there
 * once, which is the floor under the real cost.
 *
 * And it stops at the end of the ladder rather than extrapolating. A book that does not
 * reach the target within the levels read is reported as `reachable: false` — inventing
 * depth beyond what rests there would turn a measurement into a guess.
 */
export interface MoveCost {
  /** Whether the visible ladder reaches the target at all. */
  reachable: boolean;
  /** Base units that must be consumed. */
  size: number;
  /** Quote that must be put up. */
  notional: number;
  /** Levels eaten through. */
  levels: number;
  /** Where the touch ends up, which is at or past the target when reachable. */
  resultingTouch: number;
  /** Which side has to be consumed to get there. */
  side: "bids" | "asks";
}

export function costToMoveMark(
  bids: Level[],
  asks: Level[],
  targetMid: number,
): MoveCost {
  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  if (!bestBid || !bestAsk) {
    return { reachable: false, size: 0, notional: 0, levels: 0, resultingTouch: 0, side: "asks" };
  }
  const mid = (bestBid + bestAsk) / 2;

  /**
   * Moving the mid UP means clearing the asks, because the mid is (bid + ask) / 2 and
   * the ask is the side above it. Moving it DOWN means clearing the bids. Consuming the
   * far side is what drags the touch, and therefore the midpoint, along with it.
   */
  const up = targetMid > mid;
  const side: "bids" | "asks" = up ? "asks" : "bids";
  const ladder = up ? asks : bids;

  let size = 0;
  let notional = 0;
  let levels = 0;
  let touch = up ? bestAsk : bestBid;

  for (const level of ladder) {
    // The mid once this level becomes the touch: the other side has not moved.
    const midHere = up ? (bestBid + level.price) / 2 : (level.price + bestAsk) / 2;
    const reached = up ? midHere >= targetMid : midHere <= targetMid;
    if (reached && levels > 0) {
      return { reachable: true, size, notional, levels, resultingTouch: touch, side };
    }
    size += level.size;
    notional += level.size * level.price;
    levels += 1;
    touch = level.price;
  }

  // The ladder ran out before the target. Say so rather than extrapolating.
  const finalMid = up ? (bestBid + touch) / 2 : (touch + bestAsk) / 2;
  const reached = up ? finalMid >= targetMid : finalMid <= targetMid;
  return { reachable: reached, size, notional, levels, resultingTouch: touch, side };
}
