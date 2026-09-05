/**
 * Paper desk. A local mirror of RangeMarket + XorrVault so a first-time player can
 * fire real rounds in under fifteen seconds with no wallet and no chain.
 *
 * It deliberately re-implements the *rules*, not just the arithmetic: the same stake
 * caps, the same band gates, the same full-payout reservation, the same repricing on
 * stack. A demo that lets you do something the chain would reject is a demo that
 * teaches the wrong game.
 */

import {
  BPS,
  bandLimits,
  payoutFor,
  quote,
  sigmaForBlocks,
  type Quote,
} from "./pricing.ts";
import {
  HOUSE_EDGE_BPS,
  MAX_MULTIPLIER_BPS,
  MIN_MULTIPLIER_BPS,
  ROUND_BLOCKS,
  type MarketDef,
} from "./markets.ts";

export type TicketStatus = "open" | "won" | "lost" | "void";

export interface PaperTicket {
  id: number;
  marketKey: string;
  tier: number;
  low: bigint;
  high: bigint;
  stake: bigint;
  payout: bigint;
  multiplierBps: bigint;
  prob1e6: bigint;
  openBlock: number;
  expiryBlock: number;
  openSpot: bigint;
  settledPrice: bigint | null;
  status: TicketStatus;
  parentId: number | null;
}

export interface EngineConfig {
  /** 6-decimal asset units, matching AUSD */
  startingBalance: bigint;
  /** house bankroll backing paper payouts */
  vaultAssets: bigint;
  minStake: bigint;
  maxStake: bigint;
  maxUtilisationBps: bigint;
}

export const DEFAULT_CONFIG: EngineConfig = {
  startingBalance: 250_000_000n, // $250
  // Deliberately small. The house battery is a real gauge — utilisation is reserved
  // payouts over everything the vault holds, and past 80% the contract refuses new
  // exposure. Against a $250k bankroll a $10 ticket moves it by 0.03% and the meter
  // reads as decoration, so the paper desk runs a bankroll a session can actually
  // fill up.
  vaultAssets: 1_200_000_000n, // $1,200
  minStake: 1_000_000n, // $1
  maxStake: 10_000_000n, // $10
  maxUtilisationBps: 8_000n,
};

export type FireError =
  | { kind: "stake"; min: bigint; max: bigint }
  | { kind: "balance"; available: bigint }
  | { kind: "band-too-wide"; multiplierBps: bigint; floorBps: bigint }
  | { kind: "band-too-tight"; prob1e6: bigint; floor1e6: bigint }
  | { kind: "bad-band" }
  | { kind: "bad-tier" }
  | { kind: "too-late-to-stack" }
  | { kind: "over-utilised" };

export type FireResult =
  | { ok: true; ticket: PaperTicket }
  | { ok: false; error: FireError };

export class PaperEngine {
  block = 0;
  balance: bigint;
  vaultAssets: bigint;
  reserved = 0n;
  tickets: PaperTicket[] = [];
  private nextId = 1;
  readonly cfg: EngineConfig;

  constructor(cfg: Partial<EngineConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    this.balance = this.cfg.startingBalance;
    this.vaultAssets = this.cfg.vaultAssets;
  }

  get utilisationBps(): bigint {
    const total = this.vaultAssets;
    if (total === 0n) return this.reserved === 0n ? 0n : BPS;
    return (this.reserved * BPS) / total;
  }

  get freeAssets(): bigint {
    return this.vaultAssets > this.reserved ? this.vaultAssets - this.reserved : 0n;
  }

  get openTickets(): PaperTicket[] {
    return this.tickets.filter((t) => t.status === "open");
  }

  quoteBand(
    market: MarketDef,
    spot: bigint,
    low: bigint,
    high: bigint,
    tier: number,
    sigmaOverride?: bigint,
  ): Quote | null {
    const round = market.rounds[tier];
    if (!round) return null;
    if (low >= spot || high <= spot || low >= high) return null;
    try {
      return quote(round.probTable, spot, low, high, sigmaOverride ?? round.sigma1e4, HOUSE_EDGE_BPS);
    } catch {
      return null;
    }
  }

  /** @param spot the price the band will be centred on; the endpoints depend on it */
  limitsFor(market: MarketDef, tier: number, spot: bigint) {
    const round = market.rounds[tier];
    return bandLimits(
      round.probTable,
      spot,
      round.sigma1e4,
      HOUSE_EDGE_BPS,
      MIN_MULTIPLIER_BPS,
      round.minProb1e6,
    );
  }

  fire(
    market: MarketDef,
    spot: bigint,
    low: bigint,
    high: bigint,
    stake: bigint,
    tier: number,
  ): FireResult {
    const round = market.rounds[tier];
    if (!round) return { ok: false, error: { kind: "bad-tier" } };
    return this.#open(market, spot, low, high, stake, this.block + round.blocks, tier, round.sigma1e4, null);
  }

  /**
   * Same band, same cutoff, quoted against the price and remaining blocks right now.
   * Carrying the parent's multiplier forward would let a player wait until the price
   * was sitting dead centre one block from the cutoff and top up at odds priced when
   * the outcome was still open.
   */
  stack(market: MarketDef, parentId: number, spot: bigint, stake: bigint): FireResult {
    const p = this.tickets.find((t) => t.id === parentId);
    if (!p || p.status !== "open") return { ok: false, error: { kind: "bad-band" } };
    const remaining = p.expiryBlock - this.block;
    if (remaining < ROUND_BLOCKS[0]) return { ok: false, error: { kind: "too-late-to-stack" } };

    const sigmas = market.rounds.map((r) => r.sigma1e4);
    const { sigma1e4, tableTier } = sigmaForBlocks(ROUND_BLOCKS, sigmas, remaining);
    return this.#open(market, spot, p.low, p.high, stake, p.expiryBlock, tableTier, sigma1e4, p.id);
  }

  #open(
    market: MarketDef,
    spot: bigint,
    low: bigint,
    high: bigint,
    stake: bigint,
    expiryBlock: number,
    tier: number,
    sigma1e4: bigint,
    parentId: number | null,
  ): FireResult {
    const round = market.rounds[tier];
    if (!round) return { ok: false, error: { kind: "bad-tier" } };
    if (stake < this.cfg.minStake || stake > this.cfg.maxStake) {
      return { ok: false, error: { kind: "stake", min: this.cfg.minStake, max: this.cfg.maxStake } };
    }
    if (stake > this.balance) return { ok: false, error: { kind: "balance", available: this.balance } };
    if (low >= high || low >= spot || high <= spot) return { ok: false, error: { kind: "bad-band" } };

    const q = this.quoteBand(market, spot, low, high, tier, sigma1e4);
    if (!q) return { ok: false, error: { kind: "bad-band" } };

    if (q.prob1e6 < round.minProb1e6) {
      return {
        ok: false,
        error: { kind: "band-too-tight", prob1e6: q.prob1e6, floor1e6: round.minProb1e6 },
      };
    }
    if (q.multiplierBps < MIN_MULTIPLIER_BPS) {
      return {
        ok: false,
        error: { kind: "band-too-wide", multiplierBps: q.multiplierBps, floorBps: MIN_MULTIPLIER_BPS },
      };
    }
    const multCeiling =
      round.maxMultiplierBps < MAX_MULTIPLIER_BPS ? round.maxMultiplierBps : MAX_MULTIPLIER_BPS;
    const mult = q.multiplierBps > multCeiling ? multCeiling : q.multiplierBps;
    const payout = payoutFor(stake, mult);

    // Stake lands in the bankroll first, then the payout is reserved against it.
    const nextAssets = this.vaultAssets + stake;
    const reserveCeiling = (nextAssets * this.cfg.maxUtilisationBps) / BPS;
    if (this.reserved + payout > reserveCeiling) {
      return { ok: false, error: { kind: "over-utilised" } };
    }

    this.balance -= stake;
    this.vaultAssets = nextAssets;
    this.reserved += payout;

    const ticket: PaperTicket = {
      id: this.nextId++,
      marketKey: market.key,
      tier,
      low,
      high,
      stake,
      payout,
      multiplierBps: mult,
      prob1e6: q.prob1e6,
      openBlock: this.block,
      expiryBlock,
      openSpot: spot,
      settledPrice: null,
      status: "open",
      parentId,
    };
    this.tickets.push(ticket);
    return { ok: true, ticket };
  }

  /** Advance one block and settle anything whose cutoff has arrived. */
  tick(spot: bigint): PaperTicket[] {
    this.block += 1;
    const due = this.tickets.filter((t) => t.status === "open" && this.block >= t.expiryBlock);
    for (const t of due) this.#settle(t, spot);
    return due;
  }

  #settle(t: PaperTicket, price: bigint) {
    t.settledPrice = price;
    this.reserved -= t.payout;
    if (price >= t.low && price <= t.high) {
      t.status = "won";
      this.vaultAssets -= t.payout;
      this.balance += t.payout;
    } else {
      t.status = "lost";
    }
  }

  /** Net P&L across every settled ticket, in asset units. */
  get pnl(): bigint {
    return this.tickets
      .filter((t) => t.status !== "open")
      .reduce((acc, t) => acc + (t.status === "won" ? t.payout - t.stake : -t.stake), 0n);
  }
}

/**
 * Price walk for the paper desk.
 *
 * It replays REAL one-second returns rather than drawing from a bell curve. That is
 * not decoration: the multiplier is priced from a distribution measured on real
 * one-second tape, so a desk driven by a normal walk quotes one probability and
 * delivers another. Measured against the quote, a Gaussian feed paid out 31% on rounds
 * advertised at 76%. Replaying the same data the tables were fitted to makes the
 * realised win rate match the quote by construction.
 *
 * One real second is spread across 3.33 blocks (300ms each), so the aggregate move
 * over any round length is the sum of the real returns across that many seconds —
 * exactly the quantity each round's table was calibrated on.
 */
export class PaperFeed {
  price: bigint;
  readonly market: MarketDef;

  private returns: number[];
  private cursor: number;
  private readonly startPrice: bigint;
  /** Exact cumulative log return replayed so far. */
  private cumulative = 0;

  /** Blocks per real second at Monad's 300ms cadence. */
  private static readonly BLOCKS_PER_SECOND = 1000 / 300;

  /**
   * @param returns real log returns at one-second resolution
   * @param offset  where in the series to start, so two desks do not replay in lockstep
   */
  constructor(market: MarketDef, startPrice: bigint, returns: number[], offset = 0) {
    if (returns.length < 8) throw new Error("PaperFeed needs a real return series");
    this.market = market;
    this.price = startPrice;
    this.startPrice = startPrice;
    this.returns = returns;
    this.cursor = offset % returns.length;
  }

  /**
   * Integrate the piecewise-constant return series over one block.
   *
   * A block is 0.3 of a second, so most blocks straddle part of one second and part of
   * the next. Taking whichever second the block *starts* in and weighting it by 0.3
   * would give each second 3 or 4 blocks depending on where it lands, which silently
   * re-weights the real returns and breaks the equality this feed exists to preserve.
   */
  private integrate(from: number, to: number): number {
    const n = this.returns.length;
    let acc = 0;
    let t = from;
    while (t < to) {
      const idx = ((Math.floor(t) % n) + n) % n;
      const boundary = Math.floor(t) + 1;
      const segment = Math.min(to, boundary) - t;
      acc += this.returns[idx] * segment;
      t = Math.min(to, boundary);
    }
    return acc;
  }

  /** One 300ms block of real market motion. */
  step(): bigint {
    const next = this.cursor + 1 / PaperFeed.BLOCKS_PER_SECOND;
    this.cumulative += this.integrate(this.cursor, next);
    this.cursor = next;

    // Recompute from the start price each block rather than compounding, so integer
    // rounding never accumulates into a drift away from the real path.
    const scaled = Math.exp(this.cumulative) * 1e9;
    this.price = (this.startPrice * BigInt(Math.round(scaled))) / 1_000_000_000n;
    if (this.price <= 0n) this.price = 1n;
    return this.price;
  }
}
