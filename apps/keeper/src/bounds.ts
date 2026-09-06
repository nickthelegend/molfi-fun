/**
 * Turning what a transaction costs into what the keeper is willing to bound it at.
 *
 * Extracted from `chain.ts` for the same reason `reason.ts` was: this is arithmetic with no
 * network and no environment in it, and it has now been wrong twice in ways that stopped the
 * whole product. Both mistakes were the same mistake — treating a **product** as if padding
 * either factor were free.
 *
 * The chain validates `Σ max_amount × max_price_per_unit` against the account's balance, and
 * charges the actual consumption. So the bound has to be high enough to be included and low
 * enough to be affordable, and the gap between those two is the only room there is.
 */

export interface BareEstimate {
  /** What the node says this costs, with nothing added. */
  fee: bigint;
  l1: { amount: bigint; price: bigint };
  l2: { amount: bigint; price: bigint };
  data: { amount: bigint; price: bigint };
}

export interface ResourceBounds {
  l1_gas: { max_amount: bigint; max_price_per_unit: bigint };
  l1_data_gas: { max_amount: bigint; max_price_per_unit: bigint };
  l2_gas: { max_amount: bigint; max_price_per_unit: bigint };
}

/**
 * How much headroom the **amounts** get.
 *
 * The node has just measured this execution and it is deterministic, so in principle the
 * amounts need nothing. In practice they need this much, because the estimate is taken with
 * `SKIP_VALIDATE` and therefore leaves out the account's own `__validate__` — see
 * `AMOUNT_FLOOR`, which is the same shortfall written as a hard limit.
 */
export const AMOUNT_MARGIN = 150n; // percent

/**
 * How much headroom the **prices** get, on their own.
 *
 * This is the margin that was missing, and its absence is subtle enough to be worth writing
 * down. `FEE_MARGIN` used to be 150 while `AMOUNT_MARGIN` was also 150, so the whole of the
 * total headroom was spent padding amounts and the price multiplier — `cap / paddedTotal` —
 * came out at exactly 1.00. Every transaction was bounded at the spot gas price with nothing
 * over it, and any upward tick between the estimate and inclusion failed validation. The
 * relay batch that exposed this missed by 0.014%: max L1DataGas price 655,061,595,784
 * against an actual 655,154,611,171.
 *
 * Thirty percent is not generous. `max_price_per_unit` is a **ceiling**, not a payment — the
 * chain charges the price that actually clears — so the only cost of raising it is needing
 * the balance to cover the bound, and the only cost of setting it too low is a transaction
 * that pays its fee to fail. Those are not symmetric.
 */
export const PRICE_MARGIN = 130n; // percent

/**
 * How much of the bare fee to offer as headroom, in total.
 *
 * Derived rather than chosen, because the total is a **product** of the two factors and
 * writing a third number down by hand is how they came apart the first time: a margin here
 * that is smaller than `AMOUNT_MARGIN × PRICE_MARGIN` silently steals from the prices,
 * which is a bound that gets included until the moment gas moves.
 */
export const FEE_MARGIN = (AMOUNT_MARGIN * PRICE_MARGIN) / 100n; // percent
/** Never offer the whole balance: the account still needs to pay for the next one. */
export const SPENDABLE = 92n; // percent

/**
 * The amount bound is never trimmed below this, whatever the balance says.
 *
 * The node estimates with `SKIP_VALIDATE`, so its L2 figure leaves out the account's
 * `__validate__` — and that is not the rounding error it sounds like. Measured on this
 * account: estimate 1,422,912 L2 gas, actual 1,742,400, a **22% shortfall**. The first relay
 * sent with a 15% amount margin reverted on `Insufficient max L2Gas` and paid its fee anyway.
 * Below this floor the transaction cannot execute, so the honest answer is a refusal rather
 * than a bound that will burn the fee to fail.
 */
export const AMOUNT_FLOOR = 135n; // percent

export class Unaffordable extends Error {
  /**
   * Assigned rather than declared as parameter properties: the keeper runs under Node's
   * type-stripping loader, which refuses `constructor(readonly x)` outright.
   */
  readonly fee: bigint;
  readonly balance: bigint;

  constructor(fee: bigint, balance: bigint) {
    super(`cannot afford this: the fee alone is ${fee} and the balance is ${balance}`);
    this.name = "Unaffordable";
    this.fee = fee;
    this.balance = balance;
  }
}

export function boundsFrom(est: BareEstimate, balance: bigint): ResourceBounds {
  const affordable = (balance * SPENDABLE) / 100n;

  /**
   * Only a shortfall against the **real** cost is a shortfall.
   *
   * This used to be asked of `account.estimateInvokeFee().overall_fee`, which starknet.js
   * has already padded — amount by ~1.5 and price by ~1.5, compounding to 2.23x. A keeper
   * holding 0.0808 STRK therefore spent a day refusing a 0.0416 STRK relay and reporting a
   * funding shortfall that did not exist. Anything above the real cost is a margin question,
   * answered by capping the bound rather than by refusing to send.
   */
  if (est.fee > affordable) throw new Unaffordable(est.fee, balance);

  const padded = (est.fee * FEE_MARGIN) / 100n;
  const cap = padded <= affordable ? padded : affordable;

  /**
   * `cap` is a total, and there are two factors to reach it with. Which one moves depends on
   * which way the gap runs.
   *
   * With room to spare, the amounts take their margin and the prices absorb the rest — that
   * is the ordinary case. When the balance is tight enough that even the padded amounts at
   * spot price overshoot, the prices cannot come down (a bound under spot is never included),
   * so the amount margin is what gives, shrinking back towards the node's own measurement and
   * never below it. If the *unpadded* cost still does not fit, that is a real shortfall and
   * the refusal above has already fired.
   */
  const padAmount = (v: bigint) => (v * AMOUNT_MARGIN) / 100n;
  const spotTotal =
    est.l1.amount * est.l1.price + est.data.amount * est.data.price + est.l2.amount * est.l2.price;
  const paddedTotal =
    padAmount(est.l1.amount) * est.l1.price +
    padAmount(est.data.amount) * est.data.price +
    padAmount(est.l2.amount) * est.l2.price;

  let amount: (v: bigint) => bigint;
  let price: (v: bigint) => bigint;

  if (paddedTotal === 0n) {
    amount = (v) => v;
    price = (v) => v;
  } else if (paddedTotal <= cap) {
    amount = padAmount;
    price = (v) => (v * cap) / paddedTotal;
  } else {
    /**
     * Not enough room for both margins, so they are ranked rather than quietly shared.
     *
     * The price margin is ranked first, which is the opposite of what this code used to do.
     * A bound at spot price is not the conservative choice it looks like — it is exactly the
     * bound that failed, because gas need only tick up a fraction of a percent between the
     * estimate and inclusion for validation to reject it. The amounts give way instead, back
     * towards the node's own measurement and never below `AMOUNT_FLOOR`.
     */
    price = (v) => (v * PRICE_MARGIN) / 100n;
    const atMarginPrice =
      est.l1.amount * price(est.l1.price) +
      est.data.amount * price(est.data.price) +
      est.l2.amount * price(est.l2.price);

    /** What multiple of the measured amounts the budget still allows at that price. */
    const room = atMarginPrice > 0n ? (cap * 100n) / atMarginPrice : AMOUNT_MARGIN;

    if (room >= AMOUNT_FLOOR) {
      const a = room < AMOUNT_MARGIN ? room : AMOUNT_MARGIN;
      amount = (v) => (v * a) / 100n;
    } else {
      /**
       * The floor and a full price margin cannot both fit. The floor stays — a transaction
       * bounded below the gas it needs cannot execute at all, while one bounded at spot is
       * merely at risk of not being included — and the price headroom is what gives, down
       * to spot but never under it.
       */
      amount = (v) => (v * AMOUNT_FLOOR) / 100n;
      const atFloor = (spotTotal * AMOUNT_FLOOR) / 100n;
      const priceRoom = atFloor > 0n ? (cap * 100n) / atFloor : 100n;
      const p = priceRoom > 100n ? priceRoom : 100n;
      price = (v) => (v * p) / 100n;
    }
  }

  const bounds = {
    l1_gas: { max_amount: amount(est.l1.amount), max_price_per_unit: price(est.l1.price) },
    l1_data_gas: { max_amount: amount(est.data.amount), max_price_per_unit: price(est.data.price) },
    l2_gas: { max_amount: amount(est.l2.amount), max_price_per_unit: price(est.l2.price) },
  };

  /**
   * The last word belongs to the chain's own sum.
   *
   * Three integer divisions can each round up by a wei, and the whole point of this function
   * is that the number below is the one that gets compared to the balance. If rounding has
   * pushed it over, trim the largest resource's amount until it is not — and if even the
   * measured cost cannot fit, say so rather than sending something that will be refused.
   */
  const l2Floor = (est.l2.amount * AMOUNT_FLOOR) / 100n;
  while (boundTotal(bounds) > affordable && bounds.l2_gas.max_amount > l2Floor) {
    bounds.l2_gas.max_amount -= 1n;
  }
  if (boundTotal(bounds) > affordable) {
    // Drop the price headroom before touching the amount floor: a bound at spot is still
    // includable, a bound below the gas the call needs is not.
    bounds.l2_gas.max_price_per_unit = est.l2.price;
    bounds.l1_gas.max_price_per_unit = est.l1.price;
    bounds.l1_data_gas.max_price_per_unit = est.data.price;
  }
  if (boundTotal(bounds) > affordable) throw new Unaffordable(boundTotal(bounds), balance);
  return bounds;
}

/** What the chain will compare against the balance. */
export function boundTotal(b: ResourceBounds): bigint {
  return (
    b.l1_gas.max_amount * b.l1_gas.max_price_per_unit +
    b.l1_data_gas.max_amount * b.l1_data_gas.max_price_per_unit +
    b.l2_gas.max_amount * b.l2_gas.max_price_per_unit
  );
}
