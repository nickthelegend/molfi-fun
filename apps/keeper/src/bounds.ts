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

/** How much of the bare fee to offer as headroom, in total. */
export const FEE_MARGIN = 150n; // percent
/** Never offer the whole balance: the account still needs to pay for the next one. */
export const SPENDABLE = 92n; // percent
/**
 * Amounts get the smaller share of the headroom.
 *
 * The node has just measured this execution and it is deterministic; what moves between the
 * estimate and inclusion is the gas price. So amounts are padded a little against a
 * re-execution against a different block, and everything `cap` allows above that goes to the
 * prices.
 */
export const AMOUNT_MARGIN = 150n; // percent

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
    // Give back amount margin until the padded total fits — but never below the floor, which
    // is what execution actually needs once validation is counted.
    amount = (v) => {
      const scaled = (padAmount(v) * cap) / paddedTotal;
      const floor = (v * AMOUNT_FLOOR) / 100n;
      return scaled > floor ? scaled : floor;
    };
    price = (v) => v;
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
