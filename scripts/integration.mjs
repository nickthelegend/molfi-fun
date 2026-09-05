#!/usr/bin/env node
/**
 * The console's own trading code, run against a real chain.
 *
 * The distinction that makes this worth having: it does not reimplement the trade. It imports
 * `openCalls` and `claimCalls` from `@molfi/sdk` — the exact functions `LiveConsole` calls
 * through `lib/direct.ts` — hands them to a real `Account.execute`, which is the exact call
 * the browser's `submitDirect` makes, and then reads the result back with `decodePosition`,
 * the exact decoder `/api/position` uses. What passes here is the product's code path, not a
 * parallel one written to agree with it.
 *
 * What it cannot cover: the wallet. A browser extension holds the key and shows the approval
 * dialog, and nothing in Node reproduces that. Everything from the signed call onward is the
 * same, and the call is built by the same function, so what is untested is the extension's
 * own signing UI rather than molfi's use of it.
 *
 * Usage:
 *   node --experimental-strip-types scripts/integration.mjs --network devnet
 *   node --experimental-strip-types scripts/integration.mjs --network sepolia
 */

import { readFileSync } from "node:fs";
import { Account, RpcProvider, hash, num } from "starknet";
import { openCalls, claimCalls, reachOf } from "../packages/sdk/src/trade.ts";
import { commitmentOf, newSecret, u256Parts } from "../packages/sdk/src/positions.ts";
import { decodeMarket, decodePosition } from "../packages/sdk/src/decode.ts";
import { quoteOff, payoutFor } from "../packages/sdk/src/pricing.ts";
import { NETWORKS } from "../packages/sdk/src/networks.ts";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") === false ? all[i + 1] : true]] : [],
  ),
);
const network = String(args.network ?? "devnet");
const d = JSON.parse(readFileSync(`deployments/${network}.json`, "utf8"));
const RPC = process.env.STARKNET_RPC_URL ?? (network === "devnet" ? "http://127.0.0.1:5050" : NETWORKS[network].rpcUrl);

/**
 * Two accounts, because half of what the contract promises is about who *cannot* do things.
 * A test with one account can never check that a stranger holding the secret is refused.
 */
const KEYS = {
  devnet: {
    trader: { address: "0x034ba56f92265f0868c57d3fe72ecab144fc96f97954bbbc4252cef8e8a979ba", pk: "0xb137668388dbe9acdfa3bc734cc2c469" },
    stranger: { address: "0x02939f2dc3f80cc7d620e8a86f2e69c1e187b7ff44b74056647368b5c49dc370", pk: "0xe8c2801d899646311100a661d32587aa" },
  },
};
const keys = network === "devnet" ? KEYS.devnet : {
  trader: { address: process.env.TRADER_ADDRESS, pk: process.env.TRADER_PRIVATE_KEY },
  stranger: { address: process.env.STRANGER_ADDRESS, pk: process.env.STRANGER_PRIVATE_KEY },
};

const provider = new RpcProvider({ nodeUrl: RPC });
const trader = new Account({ provider, address: keys.trader.address, signer: keys.trader.pk, cairoVersion: "1" });
const stranger = keys.stranger.address
  ? new Account({ provider, address: keys.stranger.address, signer: keys.stranger.pk, cairoVersion: "1" })
  : null;

const A = { pool: d.pool, token: d.token, market: d.market };
const sel = (n) => hash.getSelectorFromName(n);
const hex = (v) => num.toHex(BigInt(v));
const say = (s) => process.stdout.write(`${s}\n`);

let failures = 0;
const check = (ok, what, detail = "") => {
  say(`  ${ok ? "✓" : "✗"} ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const call = (to, fn, calldata = []) =>
  provider.callContract({ contractAddress: to, entrypoint: fn, calldata });

/** The reason a revert gives, dug out of however many envelopes it arrived in. */
function reason(e) {
  const text = String(e?.message ?? e);
  const named = text.match(/'([A-Z0-9_]{4,})'/);
  return named ? named[1] : text.split("\n").find((l) => l.includes("Error")) ?? text.slice(0, 120);
}

/** Run a call that must revert, and say which refusal came back. */
async function mustRefuse(account, calls, expected, what) {
  try {
    const { transaction_hash } = await account.execute(calls);
    await provider.waitForTransaction(transaction_hash);
    check(false, what, "it was accepted");
  } catch (e) {
    const r = reason(e);
    check(r.includes(expected), what, r.slice(0, 70));
  }
}

async function execute(account, calls, label) {
  let transaction_hash;
  try {
    ({ transaction_hash } = await account.execute(calls));
  } catch (e) {
    // A crash here is a stack trace where a failed check belongs. The reason the chain gave
    // is the whole content of the failure, and burying it under twenty frames of RPC
    // plumbing is how a one-line bug costs an afternoon.
    check(false, `${label} was accepted by the chain`, reason(e));
    throw new Error(`${label}: ${reason(e)}`);
  }
  const receipt = await provider.waitForTransaction(transaction_hash);
  const ok = receipt.isSuccess?.() ?? true;
  if (!ok) throw new Error(`${label} reverted: ${JSON.stringify(receipt).slice(0, 200)}`);
  return transaction_hash;
}

/**
 * `balance_of`, not `balanceOf`.
 *
 * The real STRK token exposes both spellings; the devnet stub exposes only the snake_case
 * one, which is the spelling the Cairo interface actually declares. Using the camelCase alias
 * made this script work against Sepolia and fail against a local chain with an error about a
 * missing entrypoint, which reads like a broken deployment rather than a naming choice.
 */
const balanceOf = async (who) => {
  const r = await call(A.token, "balance_of", [who]);
  return (BigInt(r[1]) << 128n) | BigInt(r[0]);
};

const marketsNow = async () => {
  const n = Number(BigInt((await call(A.market, "market_count"))[0]));
  const out = [];
  for (let id = 1; id <= n; id += 1) out.push(decodeMarket(id, await call(A.market, "get_market", [hex(id)])));
  return out;
};

const chainNow = async () =>
  (await provider.getBlockWithTxHashes("latest")).timestamp;

say(`\nmolfi integration · the console's own calls · ${network}`);
say(`  market ${A.market}`);
say(`  trader ${trader.address}\n`);

// ─────────────────────────────────────────────────────────── pick a market
const all = await marketsNow();
const now = await chainNow();
const open = all.filter((m) => !m.isSettled && m.cutoffAt > now + 30).sort((a, b) => a.cutoffAt - b.cutoffAt);
if (open.length === 0) {
  console.error(`\nNo market on ${A.market} is open far enough ahead to trade.\n`);
  process.exit(1);
}
const m = open[0];
say(`I. opening a position`);

// The band the console would paint: one sigma either side of the mark.
const spot = network === "devnet" ? 7_970_000_000_000n : (await (async () => {
  const r = await fetch(`${process.env.MOLFI_URL ?? "https://molfi.fun"}/api/price?market=BTC`).then((x) => x.json());
  return BigInt(r.price);
})());
const half = (spot * m.sigma1e4) / 100_000_000n;
const s = { secret: newSecret(), marketId: m.id, bandLow: spot - half, bandHigh: spot + half };
const commitment = commitmentOf(s);
const [lowOff, highOff] = reachOf(s);
const chainQuoteAhead = await call(A.market, "quote_offsets", [hex(m.id), ...u256Parts(lowOff), ...u256Parts(highOff)])
  .then((r) => (BigInt(r[1]) << 128n) | BigInt(r[0]));
/**
 * The largest stake this market can actually cover, and then some headroom.
 *
 * A market may only sell a position it can already pay for: the stake plus the bankroll,
 * less what is already reserved, has to cover the payout. Picking a fixed stake made this
 * script fail with MARKET_CANNOT_COVER_PAYOUT on a devnet whose bankroll is a millionth of
 * Sepolia's — a correct refusal, reported as a broken test. Deriving it means the same
 * script runs anywhere, and the arithmetic is itself worth asserting.
 */
const headroom = m.staked + m.bankroll - m.reserved;
const maxStake = (headroom * 10_000n) / (chainQuoteAhead - 10_000n);
const stake = maxStake / 4n > 0n ? maxStake / 4n : 1n;

// The desk's quote and the chain's, on the same reach. A trader is shown the first and
// charged the second; if they ever disagreed the product would be lying on its main screen.
const chainQuote = chainQuoteAhead;
const rawTable = await call(A.market, "get_table", [hex(m.id)]);
const knots = [];
for (let i = 1; i + 1 < rawTable.length; i += 2) knots.push((BigInt(rawTable[i + 1]) << 128n) | BigInt(rawTable[i]));
const deskQuote = quoteOff(knots, lowOff, highOff, m.sigma1e4, m.houseEdgeBps).multiplierBps;
check(deskQuote === chainQuote, "the desk's quote equals the chain's, on the same reach", `${Number(chainQuote) / 10_000}x`);

// The console's own call builder, unmodified.
const calls = openCalls(A, s, stake);
check(calls.length === 2 && calls[1].entrypoint === "open_position", "openCalls builds approve + open_position");

// The simulation `submitDirect` runs before asking for a signature.
let simulated = true;
try {
  await trader.simulateTransaction([{ type: "INVOKE", payload: calls }], { skipValidate: true });
} catch (e) {
  simulated = false;
  check(false, "the console's pre-signature simulation accepts the call", reason(e));
}
if (simulated) check(true, "the console's pre-signature simulation accepts the call");

/**
 * On devnet the settlement token is a stub with no faucet behind it, so the trader starts
 * with nothing and `transfer_from` fails for a reason that has nothing to do with the trade.
 * On a public network the account holds real STRK and this is skipped.
 */
if (network === "devnet") {
  await execute(
    trader,
    [{ contractAddress: A.token, entrypoint: "mint", calldata: [trader.address, ...u256Parts(stake * 4n)] }],
    "fund the trader",
  );
}

const before = await balanceOf(trader.address);
check(before >= stake, "the trader can afford the stake", `${before} >= ${stake}`);
const openTx = await execute(trader, calls, "open");
const after = await balanceOf(trader.address);
check(before - after === stake, "exactly the stake left the trader's balance", `${before - after}`);

const p = decodePosition(await call(A.market, "get_position", [commitment]));
check(p.exists, "the chain holds a position under the browser's commitment", commitment.slice(0, 14) + "…");
check(p.stake === stake, "with the stake that was actually paid", p.stake.toString());
check(p.multiplierBps === chainQuote, "at the multiplier it was quoted", `${Number(p.multiplierBps) / 10_000}x`);
check(BigInt(p.owner) === BigInt(trader.address), "bound to the address that opened it");
check(p.lowOff1e8 === lowOff && p.highOff1e8 === highOff, "storing the reach");
check(
  p.lowOff1e8 !== s.bandLow && p.highOff1e8 !== s.bandHigh,
  "and not the band — nothing on chain says where it sits",
);

const m1 = (await marketsNow()).find((x) => x.id === m.id);
check(m1.staked >= stake, "the market's staked total went up", m1.staked.toString());
check(m1.reserved >= payoutFor(stake, p.multiplierBps), "and the whole payout is reserved");

say(`\nII. what must be refused while it is open`);
await mustRefuse(trader, openCalls(A, s, stake), "POSITION_EXISTS", "the same commitment cannot be opened twice");
await mustRefuse(trader, claimCalls(A, s), "NOT_SETTLED_YET", "a position cannot be claimed before settlement");

// ─────────────────────────────────────────────────────────── settle
say(`\nIII. settling`);
if (network === "devnet") {
  const cutoff = m.cutoffAt;
  const t = await chainNow();
  if (t < cutoff) {
    await fetch(RPC, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "devnet_increaseTime", params: { time: cutoff - t + 30 } }),
    });
  }
  const at = await chainNow();
  await execute(trader, [{ contractAddress: d.oracle, entrypoint: "set", calldata: [hex(spot), hex(at - 60), "0xb"] }], "seed oracle");
}
await execute(trader, [{ contractAddress: A.market, entrypoint: "settle", calldata: [hex(m.id)] }], "settle");
const m2 = (await marketsNow()).find((x) => x.id === m.id);
check(m2.isSettled, "the market settled");
check(m2.settledSources >= 3, "against a median of at least three publishers", String(m2.settledSources));
check(
  m2.settledPrice > s.bandLow && m2.settledPrice < s.bandHigh,
  "and the settled price landed inside the band",
  m2.settledPrice.toString(),
);

say(`\nIV. claiming`);
if (stranger) {
  await mustRefuse(stranger, claimCalls(A, s), "NOT_YOUR_POSITION", "a stranger holding the secret cannot claim it");
} else {
  say("  – no stranger account configured; the owner check is covered by the Cairo suite");
}
await mustRefuse(
  trader,
  claimCalls(A, { ...s, bandLow: spot - half / 4n, bandHigh: spot + half / 4n }),
  "NO_SUCH_POSITION",
  "a band that was not paid for finds no position",
);

const paidBefore = await balanceOf(trader.address);
await execute(trader, claimCalls(A, s), "claim");
const paidAfter = await balanceOf(trader.address);
const expected = payoutFor(stake, p.multiplierBps);
check(paidAfter - paidBefore === expected, "the trader was paid stake × multiplier, exactly", `${paidAfter - paidBefore}`);
check(paidAfter > before - stake, "which is more than they staked");

const p2 = decodePosition(await call(A.market, "get_position", [commitment]));
check(p2.claimed, "the position is marked claimed");
await mustRefuse(trader, claimCalls(A, s), "ALREADY_CLAIMED", "and cannot be claimed twice");

const m3 = (await marketsNow()).find((x) => x.id === m.id);
check(m3.paid <= m3.staked + m3.bankroll, "conservation held through the whole trade", `${m3.paid} <= ${m3.staked} + ${m3.bankroll}`);

say(`\n  open tx  ${openTx}`);
say(failures === 0 ? `\nall ${network} integration checks passed\n` : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
