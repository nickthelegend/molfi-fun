import { createServer } from "node:http";
import type { Call } from "starknet";
import { HOUSE_EDGE_BPS, MARKETS, ROUND_SECONDS } from "@molfi/sdk";
import * as db from "./db.ts";
import { requestDrip } from "./faucet.ts";
import { aggregate } from "./exchanges.ts";
import { affordableCount, bankrollFor as sizeBankroll } from "./bankroll.ts";
import {
  MARKET,
  NETWORK,
  RELAY,
  account,
  allMarkets,
  createMarketCall,
  fundMarketCall,
  readMainnetMedian,
  readRelayed,
  relayCall,
  TOKEN,
  UPDOWN,
  allRounds,
  approveUpDownCall,
  createRoundCall,
  fundRoundCall,
  settleRoundCall,
  reason,
  send,
  settleCall,
  strkBalance,
  transferCall,
} from "./chain.ts";

/**
 * The keeper.
 *
 * molfi's contract needs nobody to run: settlement is permissionless and anyone may poke an
 * expired market. That is a real property and it is also why, left alone, nothing happens —
 * a market with no one watching it stays open past its cutoff, and a demo shows a countdown
 * that never reaches zero.
 *
 * So this exists to be the somebody. Every cycle it:
 *
 *   1. reads mainnet Pragma and republishes it to the Sepolia relay,
 *   2. settles every market past its cutoff,
 *   3. opens a fresh round for any pair whose latest has settled.
 *
 * None of it is privileged except the relay and the listing. Anyone could run step 2, and
 * the fact that we do is convenience, not control.
 */

const CYCLE_MS = Number(process.env.KEEPER_CYCLE_MS ?? 60_000);

/**
 * The contract's publisher floor, mirrored here so a thin read is refused before it costs a fee.
 *
 * `market.cairo` and `updown.cairo` both assert `num_sources_aggregated >= 3`. Relaying a
 * two-venue median would land, and then every settle against it would revert on THIN_PRICE —
 * a market that can be opened and never resolved, which is the worst failure this system has.
 */
const MIN_SOURCES = 3;

/**
 * How stale molfi's own median may get before it is republished.
 *
 * The couriered pairs republish when Pragma publishes something newer. These have no upstream
 * publisher to wait for, so age since the last relay is the whole test. Under the 600s the
 * desk quotes on, so a quote is never refused for staleness molfi could have prevented.
 */
const RELAY_MIN_AGE_SECONDS = 240;
const PORT = Number(process.env.PORT ?? 8080);
const ONCE = process.argv.includes("--once");

/** New rounds are listed at this tier. 0 is 15 minutes, the shortest molfi can settle. */
const TIER = Number(process.env.KEEPER_TIER ?? 0);

/** What the house puts behind each new market. Small on a testnet, and real. */
/** The most the desk will put behind any one market. A ceiling, not a fixed amount. */
const BANKROLL_MAX = BigInt(process.env.KEEPER_BANKROLL ?? "200000000000000000");

const LOW_BALANCE = BigInt(process.env.KEEPER_LOW_BALANCE ?? "3000000000000000000");

/**
 * How stale the on-chain print may get before it is republished, in seconds.
 *
 * The contract refuses to settle against anything older than 900s and the desk stops quoting
 * at 600s, so this has to sit below both with room for a cycle. Lower is not better: each
 * republish is real L2 gas, and the keeper's balance is the thing that decides whether the
 * desk stays open at all.
 */
const RELAY_MIN_AGE = Number(process.env.KEEPER_RELAY_MIN_AGE ?? 420);

const state = {
  startedAt: new Date().toISOString(),
  cycles: 0,
  lastCycleAt: null as string | null,
  lastError: null as string | null,
  relayed: 0,
  settled: 0,
  listed: 0,
  balance: null as string | null,
  stoppedListing: null as string | null,
  /**
   * Cycles in a row that ended with the desk unable to list, and when the run began.
   *
   * A keeper that answers, reports no error and has quietly stopped listing is the failure
   * that looks like health — it is how this desk went dark for hours and was found by hand
   * rather than by a monitor.
   */
  stalledCycles: 0,
  stalledSince: null as string | null,
  /** Unix seconds before which asking the faucet again is pointless. */
  faucetRetryAfter: 0,
  lastDrip: null as string | null,
};

const log = (s: string) => console.log(`[${new Date().toISOString()}] ${s}`);

/**
 * Step 1 — republish mainnet's median.
 *
 * A print mainnet itself would refuse is never relayed. The relay cannot improve a bad number
 * and must not launder one, so a stale or thin mainnet print simply does not cross.
 */
async function relayPrices(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const calls: Call[] = [];
  const relayed: { pair: string; price: bigint; sources: number; block: number }[] = [];

  for (const m of MARKETS) {
    try {
      const held = await readRelayed(m.label);

      /**
       * Republish on age, not on every change mainnet happens to have.
       *
       * The contract settles against anything under 900s old and the desk quotes under 600s,
       * so a print that is four minutes old is not worth 0.1 STRK of L2 gas to replace —
       * and replacing it every time Pragma moved was most of what this keeper spent its
       * balance on. Relaying at RELAY_MIN_AGE keeps the on-chain print comfortably inside
       * both windows with a whole cycle of margin.
       */
      if (held.publishedAt > 0 && now - held.publishedAt < RELAY_MIN_AGE) continue;

      /**
       * Two sources of truth, and the market says which one it gets.
       *
       * A `settle: "pragma"` market is republished from Pragma mainnet's own median — molfi is
       * a courier for it and nothing more. A `settle: "molfi"` market has no oracle to courier
       * from: Pragma's `get_data_median` errors on the pair id, so molfi computes the median
       * across five independent exchanges and publishes that.
       *
       * Both paths put a **counted** number of sources on chain, and the contract's
       * `MIN_SOURCES >= 3` is checked against it. The count is never asserted: a venue that
       * times out is a venue that did not answer, and three is refused rather than rounded up.
       */
      let print: { raw: bigint; decimals: number; updatedAt: number; sources: number };
      let block: number;

      if (m.settle === "molfi") {
        const agg = await aggregate(m.symbol);
        if (agg.sources < MIN_SOURCES) {
          log(`relay ${m.label}: skipped, only ${agg.sources} venues answered`);
          continue;
        }
        /**
         * Timestamped now, because that is when molfi observed it.
         *
         * A Pragma print carries the publisher's own timestamp and this must not borrow that
         * shape: these prices were read this second, from live tickers, and claiming any other
         * moment would be inventing provenance. Freshness downstream is then exactly true.
         */
        print = { raw: agg.price, decimals: 8, updatedAt: now, sources: agg.sources };
        block = 0;
        // Republish on the same age rule as the couriered pairs; there is no publisher
        // timestamp to compare against, so age since the last relay is the whole test.
        if (now - held.publishedAt < RELAY_MIN_AGE_SECONDS) continue;
      } else {
        const read = await readMainnetMedian(m.label);
        if (!read.check.fresh) {
          log(`relay ${m.label}: skipped, mainnet says ${read.check.reason}`);
          continue;
        }
        print = read.print;
        block = read.block;
        // Nothing to do if the relay already holds this exact print. The contract would refuse
        // an older one anyway; skipping saves a fee for no change.
        if (held.publishedAt >= print.updatedAt) continue;
      }

      calls.push(relayCall(m.label, print.raw, print.decimals, print.updatedAt, print.sources, block));
      relayed.push({ pair: m.label, price: print.raw, sources: print.sources, block });
    } catch (e) {
      const why = reason(e);
      log(`relay ${m.label}: FAILED ${why}`);
      await db.record({
        kind: "relay", network: NETWORK, pair: m.label, marketId: null, txHash: null,
        ok: false, detail: why,
      });
    }
  }

  if (calls.length === 0) return;

  const noted = async (pairs: typeof relayed, tx: string | null, why?: string) => {
    for (const r of pairs) {
      await db.record({
        kind: "relay", network: NETWORK, pair: r.pair, marketId: null, txHash: tx,
        ok: tx !== null,
        detail: tx
          ? `${r.price} from ${r.sources} publishers, mainnet block ${r.block}`
          : (why ?? "unknown"),
        meta: tx
          ? { price: r.price.toString(), sources: r.sources, sourceBlock: r.block }
          : undefined,
      });
    }
  };

  /**
   * Every pair in one transaction, then one at a time if that will not go through.
   *
   * Three pairs meant three transactions and three lots of per-transaction L2 gas for what
   * is three storage writes, and the relay is the keeper's most frequent action. But a V3
   * transaction is validated against its fee *bounds*, which scale with the batch — so on a
   * thin balance the cheap batch is the one that cannot be attempted at all, and failing it
   * as a unit takes every pair down together. A stale relay stops every market settling, so
   * this is the one place where getting *some* of it done matters more than doing it cheaply.
   */
  try {
    const tx = await send(calls, `relayed ${relayed.map((r) => r.pair).join(", ")}`);
    state.relayed += relayed.length;
    await noted(relayed, tx);
    return;
  } catch (e) {
    log(`relay batch: ${reason(e)} — falling back to one pair at a time`);
  }

  for (let i = 0; i < relayed.length; i += 1) {
    try {
      const tx = await send(calls[i], `relayed ${relayed[i].pair}`);
      state.relayed += 1;
      await noted([relayed[i]], tx);
    } catch (e) {
      const why = reason(e);
      log(`relay ${relayed[i].pair}: FAILED ${why}`);
      await noted([relayed[i]], null, why);
    }
  }
}

/**
 * Step 2 — settle everything due.
 *
 * A market that cannot settle yet is not an error and is not logged as one. Pragma's print
 * has to be fresh *at the moment settle runs*, so a market can be past its cutoff and still
 * legitimately have to wait for the next relay.
 */
async function settleDue(markets: Awaited<ReturnType<typeof allMarkets>>): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const due = markets.filter((m) => !m.isSettled && m.cutoffAt <= now);
  if (due.length === 0) return;

  const record = async (m: (typeof due)[number], tx: string) => {
    state.settled += 1;
    await db.record({
      kind: "settle", network: NETWORK, pair: m.pair, marketId: m.id, txHash: tx,
      ok: true, detail: `settled ${m.roundSeconds}s round`,
    });
  };

  /**
   * All of them in one transaction, and one at a time only if that fails.
   *
   * Rounds are listed together and expire together, so the batch is the normal case and it
   * pays one transaction's L2 gas instead of three. It is not the only case: settlement
   * needs a fresh print *per pair*, so one stale oracle would revert the whole batch and
   * take two good settlements down with it. Hence the fallback — cheap when everything is
   * ready, correct when it is not.
   */
  if (due.length > 1) {
    try {
      const tx = await send(
        due.map((m) => settleCall(m.id)),
        `settled markets ${due.map((m) => m.id).join(", ")}`,
      );
      for (const m of due) await record(m, tx);
      return;
    } catch (e) {
      log(`settle batch: ${reason(e)} — falling back to one at a time`);
    }
  }

  for (const m of due) {
    try {
      const tx = await send(settleCall(m.id), `settled market ${m.id} (${m.pair})`);
      await record(m, tx);
    } catch (e) {
      const why = reason(e);
      // STALE_PRICE means the relay has not caught up yet — normal, and the next cycle
      // handles it. Logging it as a failure would bury the failures that matter.
      if (why === "STALE_PRICE" || why === "BEFORE_CUTOFF") {
        log(`settle ${m.id}: waiting (${why})`);
        continue;
      }
      log(`settle ${m.id}: FAILED ${why}`);
      await db.record({
        kind: "settle", network: NETWORK, pair: m.pair, marketId: m.id, txHash: null,
        ok: false, detail: why,
      });
    }
  }
}

/**
 * Step 3 — keep a market open for every pair.
 *
 * A judge who lands on "no open markets" is looking at a dead product. As soon as a pair's
 * latest round settles, the next one opens — and it is funded in the same cycle, because a
 * market with no bankroll can sell nothing at all and an unfunded listing is worse than no
 * listing.
 */
/**
 * The direction game's half of the cycle: settle what is due, list what is missing, fund it.
 *
 * Kept as one function rather than threaded through `settleDue` / `openNewRounds`, because
 * those are typed to `OnChainMarket` and a direction round is a different shape — a reference
 * price and one multiplier where a range market has a seventeen-knot table. Sharing them would
 * mean a union type every caller has to discriminate, for no gain: the two games list on the
 * same cadence and settle against the same relay, and that is all they have in common.
 *
 * Skipped entirely when `MOLFI_UPDOWN` is unset, which is the honest state on a network where
 * the direction game is not deployed.
 */
async function tendDirectionRounds(): Promise<void> {
  if (!UPDOWN) return;

  const now = Math.floor(Date.now() / 1000);
  const rounds = await allRounds();

  // ---- settle anything past its cutoff
  const due = rounds.filter((r) => !r.isSettled && r.cutoffAt <= now);
  for (const r of due) {
    try {
      const tx = await send(settleRoundCall(r.id), `settled round ${r.id}`);
      state.settled += 1;
      await db.record({
        kind: "settle", network: NETWORK, pair: r.pair, marketId: r.id, txHash: tx,
        ok: true, detail: `direction round ${r.roundSeconds}s`,
      });
    } catch (e) {
      const why = reason(e);
      // The same two waits the range market has: the relay has not caught up, or the cutoff
      // has not actually passed on the chain's clock. Neither is a failure worth recording.
      if (why === "STALE_PRICE" || why === "BEFORE_CUTOFF") {
        log(`settle round ${r.id}: waiting (${why})`);
        continue;
      }
      log(`settle round ${r.id}: FAILED ${why}`);
    }
  }

  /**
   * List the next round *before* the current one closes, not after it has.
   *
   * This used to return whenever anything was open, which sounds right and leaves a hole in
   * the product. A round closes; the keeper notices on its next cycle, up to `CYCLE_MS`
   * later; it lists a replacement, which has no bankroll; the funding pass picks that up on
   * the cycle after that. For the two or three minutes in between, every visitor to the
   * direction game is told `NO OPEN ROUND` — the desk is shut, on a schedule, several times
   * an hour, and nothing anywhere reports a fault because nothing has faulted.
   *
   * So a round is listed once the last one to close is inside `LIST_LEAD` of its cutoff. The
   * lead has to cover listing *and* funding — a round with no bankroll cannot sell a ticket,
   * so an unfunded round is not an open one — which is two cycles, plus a cycle of margin for
   * a retry. Derived from `CYCLE_MS` rather than written down, because a keeper on a slower
   * loop needs a longer lead and would otherwise reintroduce the same gap quietly.
   *
   * The overlap is deliberate and the console already expects it: `useRounds` offers the open
   * round with the *furthest* cutoff, so a trader is never handed the one about to expire.
   */
  const LIST_LEAD = Math.max((3 * CYCLE_MS) / 1000, 180);
  const open = rounds.filter((r) => !r.isSettled && r.cutoffAt > now);
  const furthest = open.reduce((a, r) => (r.cutoffAt > a ? r.cutoffAt : a), 0);
  if (open.length > 0 && furthest - now > LIST_LEAD) return;

  const balance = await strkBalance(account.address);
  if (balance < LOW_BALANCE) {
    log(`not listing a direction round: balance ${balance} is below the floor`);
    return;
  }

  const seconds = ROUND_SECONDS[TIER] ?? 900;
  const pair = MARKETS[0]?.label ?? "BTC/USD";
  try {
    const tx = await send(
      createRoundCall(pair, now + seconds + 60, seconds, TOKEN, Number(HOUSE_EDGE_BPS)),
      `listed direction round for ${pair}`,
    );
    state.listed += 1;
    state.stoppedListing = null;
    await db.record({
      kind: "list", network: NETWORK, pair, marketId: null, txHash: tx,
      ok: true, detail: `direction round, ${seconds}s`,
    });
  } catch (e) {
    log(`list direction round: FAILED ${reason(e)}`);
  }
}

/**
 * Fund any direction round that has no bankroll, by the id the chain reports.
 *
 * This used to be a third call in the listing transaction, funding `rounds.length + 1` — the
 * id the new round was *assumed* to get. It is a guess, and the guess was wrong the first
 * time it ran unattended: two cycles listed rounds 3 and 4, and both fundings landed on 3,
 * which ended up with 40 STRK while 4 had nothing. A round with no bankroll cannot sell a
 * ticket, so that is a market that looks open and refuses everyone.
 *
 * `create_round` returns the new id but a multicall cannot feed a return value into the next
 * call, so there is no way to fund it atomically without guessing. Funding in a later pass
 * against an id that was actually read is the honest version: a round may exist unfunded for
 * one cycle, and during that cycle `open_ticket` correctly refuses it rather than selling
 * something the round cannot cover.
 */
async function fundUnfundedRounds(): Promise<void> {
  if (!UPDOWN) return;
  const rounds = await allRounds();
  const now = Math.floor(Date.now() / 1000);
  const empty = rounds.filter((r) => !r.isSettled && r.cutoffAt > now && r.bankroll === 0n);
  if (empty.length === 0) return;

  // Sized like a market's: what is spendable above the floor, split across what needs funding.
  const roundBankroll = sizeBankroll(await strkBalance(account.address), empty.length, LOW_BALANCE, BANKROLL_MAX);
  if (roundBankroll === 0n) {
    log(`not funding ${empty.length} direction round(s): nothing spendable above the floor`);
    return;
  }

  for (const r of empty) {
    try {
      const tx = await send(
        [approveUpDownCall(roundBankroll), fundRoundCall(r.id, roundBankroll)],
        `funded direction round ${r.id}`,
      );
      await db.record({
        kind: "fund", network: NETWORK, pair: r.pair, marketId: r.id, txHash: tx,
        ok: true, detail: `direction round bankroll ${roundBankroll}`,
      });
    } catch (e) {
      log(`fund direction round ${r.id}: FAILED ${reason(e)}`);
    }
  }
}

async function openNewRounds(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  let balance = await strkBalance(account.address);
  state.balance = balance.toString();

  /**
   * Ask the faucet before giving up on the round.
   *
   * The desk stopping is the failure this project can least afford, and the only reason it
   * stopped was that nobody was there to run a script. A keeper that settles markets
   * unattended and then needs a person to keep its own lights on is not unattended.
   *
   * Once per stall, never against the stated cooldown, and never for a second address.
   */
  if (balance < LOW_BALANCE && Math.floor(Date.now() / 1000) >= state.faucetRetryAfter) {
    log(`balance ${balance} is below the floor — asking the faucet`);
    const drip = await requestDrip(account.address).catch((e) => ({
      ok: false as const,
      detail: reason(e),
    }));
    state.lastDrip = `${new Date().toISOString()} · ${drip.detail}`;
    // Whatever the answer, do not ask again this soon. A refusal that carries its own
    // retry time is honoured exactly; anything else waits an hour.
    state.faucetRetryAfter =
      ("retryAfter" in drip && drip.retryAfter) || Math.floor(Date.now() / 1000) + 3600;
    await db.record({
      kind: "fund", network: NETWORK, pair: null, marketId: null,
      txHash: ("txHash" in drip && drip.txHash) || null,
      ok: drip.ok, detail: `faucet: ${drip.detail}`,
    });
    log(`faucet: ${drip.detail}`);
    if (drip.ok) {
      // Re-read rather than assume: the drip is confirmed on chain before it is spendable.
      balance = await strkBalance(account.address);
      state.balance = balance.toString();
    }
  }

  if (balance < LOW_BALANCE) {
    // Stop listing before the account cannot fund what it lists. Settling still runs: it is
    // cheaper, and leaving markets unsettled is the worse failure.
    state.stoppedListing = `balance ${balance} is below the floor ${LOW_BALANCE}`;
    state.stalledCycles += 1;
    if (state.stalledCycles === 1) {
      state.stalledSince = new Date().toISOString();
      // Once, at the edge, not every cycle: a row per cycle would bury the transition that
      // matters under a thousand identical ones.
      await db.record({
        kind: "stall", network: NETWORK, pair: null, marketId: null, txHash: null,
        ok: false, detail: `stopped listing — ${state.stoppedListing}`,
      });
    }
    log(`not listing: ${state.stoppedListing}`);
    return;
  }
  if (state.stalledCycles > 0) {
    await db.record({
      kind: "stall", network: NETWORK, pair: null, marketId: null, txHash: null,
      ok: true,
      detail: `listing again after ${state.stalledCycles} cycle(s) stopped since ${state.stalledSince}`,
    });
  }
  state.stoppedListing = null;
  state.stalledCycles = 0;
  state.stalledSince = null;

  /**
   * Re-read immediately before listing, and decide the whole round from that one snapshot.
   *
   * The list this function is handed was taken before settlement ran, so acting on it can
   * list a round that already exists. Reading once here and deriving every id from it makes
   * a duplicate arithmetic rather than a race — ids are assigned sequentially from one and
   * nothing else creates markets.
   */
  const fresh = await allMarkets();
  const chainNow = Math.floor(Date.now() / 1000);
  const wanted = MARKETS.filter(
    (m) => !fresh.some((x) => x.pair === m.label && !x.isSettled && x.cutoffAt > chainNow),
  );
  if (wanted.length === 0) return;

  /**
   * The whole round — every pair, created and funded — in one transaction.
   *
   * This was nine transactions: create, transfer and fund for each of three pairs, at
   * roughly 0.1 STRK of L2 gas apiece. Nearly a STRK per round in per-transaction overhead,
   * against a 0.05 STRK bankroll, on an account topped up 5 STRK a day. The overhead, not
   * the bankroll, is what emptied the keeper and left the desk with nothing open.
   *
   * Order matters inside the batch: `fund_market` records a balance delta, so each transfer
   * has to execute before the fund call that claims it. Multicalls run in order.
   */
  const planned = wanted.map((m, i) => ({
    pair: m.label,
    id: fresh.length + 1 + i,
    seconds: m.rounds[TIER].seconds,
    cutoffAt: now + m.rounds[TIER].seconds,
  }));

  /**
   * Sized to what this listing round can actually back, split across the markets in it.
   *
   * Nine markets at a flat ceiling is nearly two hundred STRK gone per cycle, permanently,
   * because nothing returns a market's bankroll. An equal share of what is spendable keeps
   * every pair listed at a size the desk can honour.
   */
  const perMarket = sizeBankroll(balance, planned.length, LOW_BALANCE, BANKROLL_MAX);

  /**
   * List only as many as the balance can back, and say what was left out.
   *
   * `bankrollFor` divides what is spendable by how many are planned, so funding all of them
   * spends the entire budget by construction — correct when the division is exact, and past
   * the floor the moment anything drifts. Trimming the plan to what fits keeps the floor a
   * floor, and listing six markets the desk can honour is strictly better than listing nine
   * it cannot and then having no gas to settle any of them.
   */
  if (perMarket > 0n) {
    const affordable = affordableCount(balance, perMarket, LOW_BALANCE);
    if (affordable < planned.length) {
      log(`listing ${affordable} of ${planned.length} markets: the rest would breach the floor`);
      planned.length = Math.max(0, affordable);
    }
  }
  if (planned.length === 0) {
    log("not listing: nothing spendable above the floor");
    return;
  }

  const callsFor = (p: (typeof planned)[number]) => [
    createMarketCall(p.pair, TIER, p.cutoffAt),
    transferCall(MARKET, perMarket),
    fundMarketCall(p.id, perMarket),
  ];

  const recordListed = async (p: (typeof planned)[number], tx: string) => {
    state.listed += 1;
    await db.record({
      kind: "list", network: NETWORK, pair: p.pair, marketId: p.id, txHash: tx,
      ok: true, detail: `${p.seconds}s round, cutoff ${p.cutoffAt}`,
      meta: { cutoffAt: p.cutoffAt, seconds: p.seconds, bankroll: perMarket.toString(), fundTx: tx },
    });
  };

  /**
   * The whole round first, then pair by pair if that will not go through.
   *
   * A V3 transaction is validated against its own fee *bounds*, not its eventual fee, and
   * the bounds scale with the batch. Nine calls needed most of the keeper's balance reserved
   * up front and failed validation outright at 1.97 STRK — the batch that saves the most fee
   * is exactly the one a nearly-empty account cannot afford to attempt. Three calls need a
   * third of that, so a poor keeper still lists a round; a funded one pays for one
   * transaction instead of three.
   */
  if (planned.length > 1) {
    try {
      const tx = await send(
        planned.flatMap(callsFor),
        `listed and funded ${planned.map((p) => `${p.pair} as ${p.id}`).join(", ")}`,
      );
      for (const p of planned) await recordListed(p, tx);
      return;
    } catch (e) {
      log(`list round: ${reason(e)} — falling back to one pair at a time`);
    }
  }

  /**
   * One pair at a time, and each one re-derives its id from the chain.
   *
   * The ids planned above assumed the whole round would land in one transaction. Once it is
   * three, each listing shifts the count for the next, and a stale id would fund a market
   * that does not exist yet.
   */
  for (const p of planned) {
    try {
      const count = (await allMarkets()).length;
      const id = count + 1;
      const tx = await send(
        callsFor({ ...p, id }),
        `listed and funded ${p.pair} as market ${id}`,
      );
      await recordListed({ ...p, id }, tx);
    } catch (e) {
      const why = reason(e);
      log(`list ${p.pair}: FAILED ${why}`);
      await db.record({
        kind: "list", network: NETWORK, pair: p.pair, marketId: null, txHash: null,
        ok: false, detail: why,
      });
    }
  }
}

/**
 * Step 2.5 — fund anything open that has no bankroll.
 *
 * Listing now creates, transfers and funds in one transaction, so the three legs succeed or
 * fail together and this should never fire. It stays because the failure it repairs is the
 * worst one available — a market open, quotable-looking, and able to sell nothing at all,
 * because the contract refuses every position it cannot already cover — and because markets
 * listed before the batch existed can still be in that state. It costs one balance read per
 * cycle when there is nothing to do.
 */
async function fundUnfunded(
  markets: Awaited<ReturnType<typeof allMarkets>>,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const needy = markets.filter((m) => !m.isSettled && m.cutoffAt > now && m.bankroll === 0n);
  if (needy.length === 0) return;
  const balanceNow = await strkBalance(account.address);
  const recoverAmount = sizeBankroll(balanceNow, needy.length, LOW_BALANCE, BANKROLL_MAX);
  if (recoverAmount === 0n) {
    log(`not recovering ${needy.length} unfunded market(s): nothing spendable above the floor`);
    return;
  }
  /**
   * A running budget, checked before each transfer.
   *
   * Dividing what is spendable by the number of markets that need it is a *share*, not a
   * budget: the loop then funds every one of them and spends the entire amount, every cycle,
   * and any drift between the count used for the division and the count actually funded takes
   * it past the floor. It did — the keeper went from 94 STRK to 0.01 with nothing listed,
   * pouring the lot into a backlog of markets left unfunded by an earlier run that had itself
   * run dry mid-batch.
   *
   * The floor only means something if it is checked as the money leaves. This stops funding
   * when the next transfer would breach it and says how many it could not reach, which is a
   * desk that is short — a real state, worth reporting — rather than a desk that is empty.
   */
  let spent = 0n;
  let skipped = 0;
  for (const m of needy) {
    if (balanceNow - spent - recoverAmount < LOW_BALANCE) { skipped += 1; continue; }
    log(`market ${m.id} (${m.pair}) is open with no bankroll — funding it`);
    try {
      const tx = await send(
        [transferCall(MARKET, recoverAmount), fundMarketCall(m.id, recoverAmount)],
        `funded market ${m.id}`,
      );
      await db.record({
        kind: "fund", network: NETWORK, pair: m.pair, marketId: m.id, txHash: tx,
        ok: true, detail: `recovered an unfunded market with ${recoverAmount}`,
      });
      // Only count what actually left. A failed send spent a fee, not a bankroll.
      spent += recoverAmount;
    } catch (e) {
      const why = reason(e);
      log(`fund ${m.id}: FAILED ${why}`);
      await db.record({
        kind: "fund", network: NETWORK, pair: m.pair, marketId: m.id, txHash: null,
        ok: false, detail: why,
      });
    }
  }
  if (skipped > 0) {
    log(`left ${skipped} unfunded market(s) alone: funding them would breach the floor`);
  }
}

/** Mirror chain state into the ledger, so the site can read history without replaying logs. */
async function indexMarkets(markets: Awaited<ReturnType<typeof allMarkets>>): Promise<void> {
  for (const m of markets) {
    await db.upsertMarket({
      network: NETWORK,
      marketId: m.id,
      pair: m.pair,
      roundSeconds: m.roundSeconds,
      cutoffAt: m.cutoffAt,
      settled: m.isSettled,
      settledPrice: m.isSettled ? m.settledPrice.toString() : null,
      settledAt: m.isSettled ? m.settledAt : null,
      settledSources: m.isSettled ? m.settledSources : null,
      staked: m.staked.toString(),
      paid: m.paid.toString(),
    });
  }
}

async function cycle(): Promise<void> {
  state.cycles += 1;
  log(`cycle ${state.cycles}`);
  try {
    await relayPrices();
    // Re-read after relaying: settling depends on a price that may have just landed.
    let markets = await allMarkets();
    await settleDue(markets);
    markets = await allMarkets();
    await fundUnfunded(markets);
    await openNewRounds();
    await tendDirectionRounds();
    await fundUnfundedRounds();
    await indexMarkets(await allMarkets());
    state.lastError = null;
  } catch (e) {
    state.lastError = reason(e);
    log(`cycle FAILED: ${state.lastError}`);
  }
  state.lastCycleAt = new Date().toISOString();
}

// ------------------------------------------------------------------ the service
//
// A keeper with no way to ask what it has done is a background process nobody can trust.
createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store",
      "access-control-allow-origin": "*" });
    res.end(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  };

  try {
    if (url.pathname === "/health" || url.pathname === "/") {
      const lagMs = state.lastCycleAt ? Date.now() - Date.parse(state.lastCycleAt) : null;
      /**
       * Healthy means "is doing its job", not "is running".
       *
       * A process that is up and stuck is the failure a health check exists to catch, and so
       * is one that is cycling happily while unable to list a single round. The desk went
       * quiet for hours reporting `ok: true` throughout, because "stopped listing" lived in
       * a field nothing checked. One stalled cycle is tolerated — the balance can dip and
       * recover between rounds — but two in a row is the desk going dark.
       */
      /**
       * Starting is not the same as stalled, and conflating them is a deadlock.
       *
       * `recent` requires at least one completed cycle, so a freshly booted keeper answered
       * **503 before its first cycle had run**. Railway health-checks a new deployment
       * immediately, got that 503, retried for five minutes and killed the replica — every
       * time. The process could never become healthy because it was never allowed to live
       * long enough to do the thing that would make it healthy, and the deploy that carried
       * the fix for a stalled keeper was the one that could not ship.
       *
       * A process gets one full cycle plus a margin to prove itself. Inside that window it is
       * `starting` and reports 200 with the reason; outside it, the stall rules below apply
       * exactly as before.
       */
      const starting =
        state.cycles === 0 && Date.now() - Date.parse(state.startedAt) < CYCLE_MS * 2;
      const recent = state.cycles > 0 && lagMs !== null && lagMs < CYCLE_MS * 3;
      const listing = state.stalledCycles < 2;
      const healthy = starting || (recent && listing);
      return json(healthy ? 200 : 503, {
        ok: healthy,
        // Say which half failed, so a 503 does not need a log to interpret.
        starting: starting || undefined,
        unhealthy: healthy
          ? null
          : !recent
            ? `no cycle in ${lagMs}ms, on a ${CYCLE_MS}ms loop`
            : `has not listed a round for ${state.stalledCycles} cycles: ${state.stoppedListing}`,
        network: NETWORK,
        market: MARKET,
        relay: RELAY,
        keeper: account.address,
        cycleSeconds: CYCLE_MS / 1000,
        lagMs,
        ...state,
        ledger: await db.summary(),
      });
    }
    if (url.pathname === "/actions") {
      return json(200, { actions: await db.recentActions(Number(url.searchParams.get("limit") ?? 50)) });
    }
    if (url.pathname === "/settled") {
      return json(200, { markets: await db.settledMarkets(Number(url.searchParams.get("limit") ?? 50)) });
    }
    return json(404, { error: "not found" });
  } catch (e) {
    return json(500, { error: reason(e) });
  }
}).listen(PORT, () => log(`keeper listening on :${PORT}`));

await db.init();
log(`keeper starting · network ${NETWORK} · market ${MARKET} · every ${CYCLE_MS / 1000}s`);
await cycle();

if (!ONCE) {
  setInterval(() => void cycle(), CYCLE_MS);
} else {
  log("--once: done");
  process.exit(0);
}
