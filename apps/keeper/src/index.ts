import { createServer } from "node:http";
import { MARKETS } from "@molfi/sdk";
import * as db from "./db.ts";
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
const PORT = Number(process.env.PORT ?? 8080);
const ONCE = process.argv.includes("--once");

/** New rounds are listed at this tier. 0 is 15 minutes, the shortest molfi can settle. */
const TIER = Number(process.env.KEEPER_TIER ?? 0);

/** What the house puts behind each new market. Small on a testnet, and real. */
const BANKROLL = BigInt(process.env.KEEPER_BANKROLL ?? "200000000000000000");

/** Below this the keeper stops listing new markets rather than stranding an unfunded one. */
const LOW_BALANCE = BigInt(process.env.KEEPER_LOW_BALANCE ?? "3000000000000000000");

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
};

const log = (s: string) => console.log(`[${new Date().toISOString()}] ${s}`);

/**
 * Step 1 — republish mainnet's median.
 *
 * A print mainnet itself would refuse is never relayed. The relay cannot improve a bad number
 * and must not launder one, so a stale or thin mainnet print simply does not cross.
 */
async function relayPrices(): Promise<void> {
  for (const m of MARKETS) {
    try {
      const { print, check, block } = await readMainnetMedian(m.label);
      if (!check.fresh) {
        log(`relay ${m.label}: skipped, mainnet says ${check.reason}`);
        continue;
      }

      // Nothing to do if the relay already holds this exact print. The contract would refuse
      // an older one anyway; skipping saves a fee for no change.
      const held = await readRelayed(m.label);
      if (held.publishedAt >= print.updatedAt) continue;

      const tx = await send(
        relayCall(m.label, print.raw, print.decimals, print.updatedAt, print.sources, block),
        `relayed ${m.label} @ ${print.raw}`,
      );
      state.relayed += 1;
      await db.record({
        kind: "relay", network: NETWORK, pair: m.label, marketId: null, txHash: tx,
        ok: true,
        detail: `${print.raw} from ${print.sources} publishers, mainnet block ${block}`,
        meta: { price: print.raw.toString(), sources: print.sources, sourceBlock: block },
      });
    } catch (e) {
      const why = reason(e);
      log(`relay ${m.label}: FAILED ${why}`);
      await db.record({
        kind: "relay", network: NETWORK, pair: m.label, marketId: null, txHash: null,
        ok: false, detail: why,
      });
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
  for (const m of markets) {
    if (m.isSettled || m.cutoffAt > now) continue;
    try {
      const tx = await send(settleCall(m.id), `settled market ${m.id} (${m.pair})`);
      state.settled += 1;
      await db.record({
        kind: "settle", network: NETWORK, pair: m.pair, marketId: m.id, txHash: tx,
        ok: true, detail: `settled ${m.roundSeconds}s round`,
      });
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
async function openNewRounds(
  markets: Awaited<ReturnType<typeof allMarkets>>,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const balance = await strkBalance(account.address);
  state.balance = balance.toString();

  if (balance < LOW_BALANCE) {
    // Stop listing before the account cannot fund what it lists. Settling still runs: it is
    // cheaper, and leaving markets unsettled is the worse failure.
    state.stoppedListing = `balance ${balance} is below the floor ${LOW_BALANCE}`;
    log(`not listing: ${state.stoppedListing}`);
    return;
  }
  state.stoppedListing = null;

  for (const m of MARKETS) {
    const open = markets.filter((x) => x.pair === m.label && !x.isSettled && x.cutoffAt > now);
    if (open.length > 0) continue;

    try {
      /**
       * Re-read immediately before listing, and check this pair specifically.
       *
       * The snapshot this loop is walking was taken before any of its own listings, so by
       * the third pair it is several transactions out of date. Combined with a confirmation
       * that timed out on a transaction that had actually landed, that produced two ETH
       * markets and no STRK market in one cycle — each with a bankroll paid for it.
       *
       * The chain is the only thing that knows what exists. Asking it costs one call and
       * makes a duplicate structurally impossible rather than merely unlikely.
       */
      const fresh = await allMarkets();
      const alreadyOpen = fresh.some(
        (x) => x.pair === m.label && !x.isSettled && x.cutoffAt > Math.floor(Date.now() / 1000),
      );
      if (alreadyOpen) {
        log(`list ${m.label}: already open on chain, skipping`);
        continue;
      }

      const seconds = MARKETS.find((x) => x.label === m.label)!.rounds[TIER].seconds;
      const cutoffAt = now + seconds;
      const tx = await send(createMarketCall(m.label, TIER, cutoffAt), `listed ${m.label}`);
      state.listed += 1;

      // The new id is the count, because ids are assigned sequentially from one.
      const created = await allMarkets();
      const listedMarket = created[created.length - 1];

      // Fund it in the same cycle. The contract measures funding as a balance delta, so the
      // tokens have to arrive before the call that records them.
      await send(transferCall(MARKET, BANKROLL), `sent bankroll for market ${listedMarket.id}`);
      const fundTx = await send(
        fundMarketCall(listedMarket.id, BANKROLL),
        `funded market ${listedMarket.id}`,
      );

      await db.record({
        kind: "list", network: NETWORK, pair: m.label, marketId: listedMarket.id, txHash: tx,
        ok: true, detail: `${seconds}s round, cutoff ${cutoffAt}`,
        meta: { cutoffAt, seconds, bankroll: BANKROLL.toString(), fundTx },
      });
    } catch (e) {
      const why = reason(e);
      log(`list ${m.label}: FAILED ${why}`);
      await db.record({
        kind: "list", network: NETWORK, pair: m.label, marketId: null, txHash: null,
        ok: false, detail: why,
      });
    }
  }
}

/**
 * Step 2.5 — fund anything open that has no bankroll.
 *
 * A listing is three transactions: create, transfer, fund. Any of them can fail on its own,
 * and when the funding leg does the market is left open, quotable-looking, and able to sell
 * nothing at all — the contract refuses every position it cannot already cover. That is the
 * worst of the three outcomes, because it looks fine from outside.
 *
 * Recovering it here rather than at listing time means a transient failure heals on the next
 * cycle instead of stranding a market until someone notices.
 */
async function fundUnfunded(
  markets: Awaited<ReturnType<typeof allMarkets>>,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  for (const m of markets) {
    if (m.isSettled || m.cutoffAt <= now || m.bankroll > 0n) continue;
    log(`market ${m.id} (${m.pair}) is open with no bankroll — funding it`);
    try {
      await send(transferCall(MARKET, BANKROLL), `sent bankroll for market ${m.id}`);
      const tx = await send(fundMarketCall(m.id, BANKROLL), `funded market ${m.id}`);
      await db.record({
        kind: "fund", network: NETWORK, pair: m.pair, marketId: m.id, txHash: tx,
        ok: true, detail: `recovered an unfunded market with ${BANKROLL}`,
      });
    } catch (e) {
      const why = reason(e);
      log(`fund ${m.id}: FAILED ${why}`);
      await db.record({
        kind: "fund", network: NETWORK, pair: m.pair, marketId: m.id, txHash: null,
        ok: false, detail: why,
      });
    }
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
    markets = await allMarkets();
    await openNewRounds(markets);
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
      // Healthy means "has run recently", not "is running". A process that is up and stuck
      // is the failure a health check exists to catch.
      const healthy = state.cycles > 0 && lagMs !== null && lagMs < CYCLE_MS * 3;
      return json(healthy ? 200 : 503, {
        ok: healthy,
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
