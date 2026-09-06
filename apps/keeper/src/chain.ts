import { Account, CallData, RpcProvider, hash, transaction, type Call } from "starknet";

import {
  CALIBRATED_MARKETS,
  ROUND_SECONDS,
  SETTLEMENT_MAX_PRICE_AGE_SECONDS,
  decodePrint,
  freshness,
  pairId,
} from "@molfi/sdk";
import { PRAGMA } from "@molfi/sdk";
import { boundsFrom, type BareEstimate } from "./bounds.ts";
import { reason, transient } from "./reason.ts";


/** Re-exported so callers keep importing their failure explanations from one place. */
export { reason };

/**
 * Everything the keeper does on chain.
 *
 * Two networks at once, and the asymmetry is the whole point: **mainnet is read** for
 * Pragma's median, and **Sepolia is written** — the relay, the settlements, the new rounds.
 * The keeper never signs anything on mainnet.
 */

export const NETWORK = process.env.MOLFI_NETWORK ?? "sepolia";
export const SEPOLIA_RPC =
  process.env.STARKNET_RPC_URL ?? "https://api.cartridge.gg/x/starknet/sepolia";
export const MAINNET_RPC =
  process.env.MAINNET_RPC_URL ?? "https://api.cartridge.gg/x/starknet/mainnet";

export const MARKET = required("MOLFI_MARKET");
/**
 * The direction game, optional.
 *
 * `required` rather than optional would tie the keeper's boot to a contract that may not be
 * deployed on a given network — it is null on mainnet and on devnet. Empty means "this
 * network has no direction game", and the cycle skips that half rather than failing.
 */
export const UPDOWN = process.env.MOLFI_UPDOWN ?? "";
export const RELAY = required("MOLFI_RELAY");
export const TOKEN = required("MOLFI_TOKEN");

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export const provider = new RpcProvider({ nodeUrl: SEPOLIA_RPC });
export const mainnet = new RpcProvider({ nodeUrl: MAINNET_RPC });

export const account = new Account({
  provider,
  address: required("KEEPER_ADDRESS"),
  signer: required("KEEPER_PRIVATE_KEY"),
});

const u256 = (lo: string, hi: string) => (BigInt(hi) << 128n) | BigInt(lo);
export const hex = (v: bigint | number) => "0x" + BigInt(v).toString(16);

/** felt → the short string it encodes. */
export function toLabel(felt: string): string {
  let n = BigInt(felt);
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  return String.fromCharCode(...bytes);
}


export interface MarketState {
  id: number;
  pair: string;
  cutoffAt: number;
  roundSeconds: number;
  isSettled: boolean;
  settledPrice: bigint;
  settledAt: number;
  settledSources: number;
  staked: bigint;
  paid: bigint;
  bankroll: bigint;
  reserved: bigint;
}

export async function marketCount(): Promise<number> {
  const [n] = await provider.callContract({
    contractAddress: MARKET,
    entrypoint: "market_count",
    calldata: [],
  });
  return Number(BigInt(n));
}

export async function readMarket(id: number): Promise<MarketState> {
  const r = await provider.callContract({
    contractAddress: MARKET,
    entrypoint: "get_market",
    calldata: CallData.compile([id]),
  });
  return {
    id,
    pair: toLabel(r[0]),
    cutoffAt: Number(BigInt(r[1])),
    roundSeconds: Number(BigInt(r[2])),
    settledPrice: u256(r[8], r[9]),
    settledAt: Number(BigInt(r[10])),
    settledSources: Number(BigInt(r[12])),
    isSettled: BigInt(r[13]) === 1n,
    staked: u256(r[14], r[15]),
    paid: u256(r[16], r[17]),
    bankroll: u256(r[18], r[19]),
    reserved: u256(r[20], r[21]),
  };
}

export async function allMarkets(): Promise<MarketState[]> {
  const n = await marketCount();
  const out: MarketState[] = [];
  for (let id = 1; id <= n; id += 1) out.push(await readMarket(id));
  return out;
}

/** Mainnet Pragma's median for one pair, with the block it was read at. */
export async function readMainnetMedian(pair: string) {
  const block = await mainnet.getBlockLatestAccepted();
  const raw = await mainnet.callContract({
    contractAddress: PRAGMA.mainnet,
    entrypoint: "get_data_median",
    calldata: ["0x0", hex(pairId(pair))],
  });
  const print = decodePrint(raw as string[]);
  // The contract's rule, not the desk's. Pragma publishes every seven to ten minutes, so a
  // 600s cutoff would stall the relay for a third of every cycle over a price the contract
  // would have settled against without complaint.
  return {
    print,
    check: freshness(print, undefined, SETTLEMENT_MAX_PRICE_AGE_SECONDS),
    block: block.block_number,
  };
}

/** What the relay currently holds for a pair. */
export async function readRelayed(pair: string) {
  const r = await provider.callContract({
    contractAddress: RELAY,
    entrypoint: "get_relayed",
    calldata: [hex(pairId(pair))],
  });
  return {
    price: BigInt(r[0]),
    decimals: Number(BigInt(r[1])),
    publishedAt: Number(BigInt(r[2])),
    sources: Number(BigInt(r[3])),
    sourceBlock: Number(BigInt(r[4])),
    relayedAt: Number(BigInt(r[5])),
  };
}

/**
 * Send one transaction and wait for the chain to accept it.
 *
 * Waiting matters: the keeper decides what to do next from chain state, and acting on state
 * that predates its own last transaction is how it settles the same market twice or lists a
 * duplicate round.
 *
 * The nonce is tracked locally rather than asked for every time. A public RPC's nonce view
 * lags its own accepted transactions by a moment, so back-to-back sends — which is exactly
 * what a keeper does — get handed the same nonce and the second is rejected. Locally it is
 * simply the last one plus one, and any nonce complaint resyncs from the chain and retries.
 */
let nextNonce: bigint | null = null;

/**
 * The account's next nonce, counting what is already in the mempool.
 *
 * `getNonce()` defaults to the **latest** block, which is the confirmed state and says
 * nothing about transactions that have been accepted and not yet mined. When anything else
 * signs from this account — the previous replica during a rolling deploy, or a hand-run
 * `sncast` — its transaction sits pending, `latest` still reports the nonce it consumed, and
 * the keeper picks the same one. The node answers `DuplicateNonce`, `transient()` correctly
 * calls that retryable, the retry re-syncs, and reads the identical stale value again. It
 * never converges: observed live as three attempts on nonce `0x2cf`, then a hard failure, for
 * both a settle and a funding, on every cycle.
 *
 * `pending` includes the mempool, so the next nonce is the one nothing has claimed.
 */
async function syncNonce(): Promise<bigint> {
  const n = await account.getNonce("pending");
  nextNonce = BigInt(n);
  return nextNonce;
}


/**
 * `call` may be several calls, and when it is they land as one transaction.
 *
 * Fees on Sepolia are dominated by per-transaction L2 gas — a listing cost three separate
 * transactions at about 0.1 STRK each, which on a faucet-funded keeper is the difference
 * between a desk that stays open and one that runs dry inside an hour.
 */
/**
 * Fee bounds the account can actually pay, rather than the default headroom.
 *
 * The chain validates against the *bound*, not the eventual fee, and the bound carries
 * padding. An account can therefore be refused a transaction whose real cost it could
 * comfortably pay, which is a procedural refusal rather than a real one — so the bound is
 * capped at what the balance covers, and never dropped below the estimate itself.
 *
 * When the bare estimate is already unaffordable this throws before anything is signed,
 * naming both numbers. That is worth more than it sounds: the alternative is the node's
 * "Account validation failed — Resources bounds ({ l1_gas: … }) exceed balance (…)", which
 * says the same thing in two hundred characters of gas dictionaries, after a nonce and a
 * round trip have been spent finding out.
 *
 * Measured on Sepolia: one relay costs 0.0416 STRK against a 0.0808 balance. It was refused
 * for a day anyway, because the figure being compared was starknet.js's padded 0.0928 rather
 * than the node's own number — see `bareEstimate`. The shortfall was the padding.
 *
 * Passing explicit bounds also means `execute` does not estimate again, so this costs no
 * extra round trip.
 */
/**
 * What the transaction actually costs, as the node itself reports it.
 *
 * `account.estimateInvokeFee` does not tell you this, and the difference is not small.
 * Measured against Sepolia on the same call, the same second: the node put one relay at
 * **0.0416 STRK** and starknet.js returned **0.0928** — it multiplies the gas *amount* by
 * about 1.5 and the *price* by about 1.5 before handing the figure back, so what it calls
 * `overall_fee` is already a padded bound and the two paddings compound to 2.23x.
 *
 * That number was then compared against the balance to decide affordability, so a keeper
 * holding 0.0808 STRK spent a day refusing a transaction it could have paid for twice over,
 * reporting a funding shortfall that did not exist. The affordability question has to be
 * asked of the real cost; the padding belongs in the bound, once, and is added below.
 *
 * `SKIP_VALIDATE` leaves out the account's signature check, which is a signature
 * verification and change from a rounding error next to the margin applied on top.
 */
async function bareEstimate(call: Call | Call[], nonce: bigint): Promise<BareEstimate> {
  const calls = Array.isArray(call) ? call : [call];
  const ZERO = { max_amount: "0x0", max_price_per_unit: "0x0" };
  const res = await fetch(SEPOLIA_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "starknet_estimateFee",
      params: {
        request: [
          {
            type: "INVOKE",
            version: "0x3",
            sender_address: account.address,
            calldata: transaction.getExecuteCalldata(calls, "1"),
            signature: ["0x0", "0x0"],
            nonce: "0x" + nonce.toString(16),
            resource_bounds: { l1_gas: ZERO, l1_data_gas: ZERO, l2_gas: ZERO },
            tip: "0x0",
            paymaster_data: [],
            account_deployment_data: [],
            nonce_data_availability_mode: "L1",
            fee_data_availability_mode: "L1",
          },
        ],
        simulation_flags: ["SKIP_VALIDATE"],
        block_id: "pending",
      },
    }),
  });
  const json = (await res.json()) as {
    result?: Array<Record<string, string>>;
    error?: unknown;
  };
  if (json.error || !json.result?.[0]) {
    /**
     * Carried as `baseError`, not flattened into the message.
     *
     * `reason()` digs the real explanation out of the deepest `baseError`, and a revert
     * during estimation is where `STALE_PRICE` lives — the difference between the keeper
     * logging "waiting" and logging an unreadable "Transaction execution error".
     */
    const err = new Error("the node would not estimate this") as Error & { baseError?: unknown };
    err.baseError = json.error;
    throw err;
  }
  const e = json.result[0];
  const n = (v: string | undefined) => BigInt(v ?? "0x0");
  return {
    fee: n(e.overall_fee),
    l1: { amount: n(e.l1_gas_consumed), price: n(e.l1_gas_price) },
    l2: { amount: n(e.l2_gas_consumed), price: n(e.l2_gas_price) },
    data: { amount: n(e.l1_data_gas_consumed), price: n(e.l1_data_gas_price) },
  };
}

async function boundsFor(call: Call | Call[], nonce: bigint) {
  const est = await bareEstimate(call, nonce);
  const balance = await strkBalance(account.address);
  return boundsFrom(est, balance);
}

export async function send(call: Call | Call[], label: string, attempts = 3): Promise<string> {
  let last = "";
  for (let i = 0; i < attempts; i += 1) {
    let hash: string | null = null;
    try {
      if (nextNonce === null) await syncNonce();
      const resourceBounds = await boundsFor(call, nextNonce!);
      const sent = await account.execute(call, { nonce: nextNonce!, resourceBounds });
      hash = sent.transaction_hash;
      nextNonce! += 1n;
    } catch (e) {
      // Submission failed, so nothing reached the chain and retrying is safe. The local
      // nonce is suspect either way; ask the chain again.
      last = reason(e);
      nextNonce = null;
      if (!transient(last) || i === attempts - 1) throw new Error(last);
      console.log(`    ${label}: ${last} — retrying`);
      await new Promise((r) => setTimeout(r, 1_500 * (i + 1)));
      continue;
    }

    /**
     * Past this point the transaction has been submitted, and retrying is **never** safe.
     *
     * A failed confirmation says nothing about whether the transaction landed — and it
     * usually did. Retrying it listed the same market twice: the first `create_market`
     * succeeded, its receipt read timed out, and the retry created a duplicate. Two ETH
     * markets, no STRK market, and a bankroll paid twice for one round.
     *
     * So a confirmation failure is reported against the hash rather than retried. The next
     * cycle reads the chain and sees whatever actually happened, which is the only source
     * that knows.
     */
    /**
     * Bounded. An unbounded wait is how a keeper stops being a keeper.
     *
     * `waitForTransaction` polls until the transaction is accepted, and with no timeout that
     * is *until forever* if it never is. Observed in production: a cycle entered this call and
     * never left. `setInterval` kept starting new cycles, so the counter climbed while
     * `lastCycleAt` stood still — the desk went dark for seven minutes with two thousand STRK
     * in the account and nothing wrong with it. The retry loop also printed a status line per
     * poll, which crossed Railway's 500-lines-per-second limit and took the logs out with it,
     * so the one place that could have explained the stall was the first casualty.
     *
     * Ninety seconds is well past Sepolia's block time and well short of a cycle. Past it the
     * transaction is reported against its hash rather than waited on, which is the same rule
     * this function already applies to a failed confirmation: the next cycle reads the chain
     * and sees whatever actually happened.
     */
    const CONFIRM_TIMEOUT_MS = 90_000;
    let receipt: Awaited<ReturnType<typeof provider.waitForTransaction>>;
    try {
      receipt = await Promise.race([
        provider.waitForTransaction(hash, { retryInterval: 4_000 }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`not confirmed within ${CONFIRM_TIMEOUT_MS / 1000}s`)),
            CONFIRM_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch (e) {
      throw new Error(`${label} was submitted as ${hash} but could not be confirmed: ${reason(e)}`);
    }

    /**
     * Accepted is not the same as succeeded.
     *
     * A reverted transaction is included in a block, has a hash, and charges its fee in
     * full. `waitForTransaction` resolves for it perfectly happily. Without this check the
     * keeper counted one as a relay, wrote an `ok` row to the ledger with the hash attached,
     * and reported a price it had not moved — the failure mode that costs the fee *and* the
     * truth. Caught the day it first mattered: a relay reverted on
     * `Insufficient max L2Gas` and was logged as `relayed BTC/USD → 0x76ade8c…`.
     */
    const r = receipt as unknown as {
      execution_status?: string;
      revert_reason?: string;
      value?: { execution_status?: string; revert_reason?: string };
    };
    const status = r.execution_status ?? r.value?.execution_status;
    if (status === "REVERTED") {
      const why = (r.revert_reason ?? r.value?.revert_reason ?? "no reason given").trim();
      throw new Error(`${label} reverted on chain as ${hash}: ${reason(new Error(why))}`);
    }

    console.log(`  ${label} → ${hash}`);
    return hash;
  }
  throw new Error(last);
}

export const relayCall = (
  pair: string,
  price: bigint,
  decimals: number,
  publishedAt: number,
  sources: number,
  sourceBlock: number,
): Call => ({
  contractAddress: RELAY,
  entrypoint: "relay",
  calldata: [
    hex(pairId(pair)),
    hex(price),
    hex(decimals),
    hex(publishedAt),
    hex(sources),
    hex(sourceBlock),
  ],
});

export const settleCall = (id: number): Call => ({
  contractAddress: MARKET,
  entrypoint: "settle",
  calldata: CallData.compile([id]),
});

/** A Cairo short string as the felt it encodes. */
export function shortString(text: string): string {
  let out = 0n;
  for (const c of text) out = (out << 8n) | BigInt(c.charCodeAt(0));
  return "0x" + out.toString(16);
}

export function createMarketCall(pair: string, tier: number, cutoffAt: number): Call {
  const m = CALIBRATED_MARKETS.find((c) => c.label === pair);
  if (!m) throw new Error(`no calibration for ${pair}`);
  const round = m.rounds[tier];
  if (!round) throw new Error(`no round ${tier} for ${pair}`);

  const parts = (v: bigint) => [hex(v & ((1n << 128n) - 1n)), hex(v >> 128n)];
  return {
    contractAddress: MARKET,
    entrypoint: "create_market",
    calldata: [
      shortString(pair),
      hex(cutoffAt),
      hex(round.seconds),
      TOKEN,
      ...parts(round.sigma1e4),
      ...parts(400n),
      hex(round.probTable.length),
      ...round.probTable.flatMap((k) => parts(k)),
    ],
  };
}

export const transferCall = (to: string, amount: bigint): Call => {
  const parts = (v: bigint) => [hex(v & ((1n << 128n) - 1n)), hex(v >> 128n)];
  return {
    contractAddress: TOKEN,
    entrypoint: "transfer",
    calldata: [to, ...parts(amount)],
  };
};

export const fundMarketCall = (id: number, amount: bigint): Call => {
  const parts = (v: bigint) => [hex(v & ((1n << 128n) - 1n)), hex(v >> 128n)];
  return {
    contractAddress: MARKET,
    entrypoint: "fund_market",
    calldata: [hex(id), ...parts(amount)],
  };
};

export async function strkBalance(who: string): Promise<bigint> {
  const r = await provider.callContract({
    contractAddress: TOKEN,
    entrypoint: "balance_of",
    calldata: [who],
  });
  return u256(r[0], r[1]);
}

export { ROUND_SECONDS, hash };

/** List a direction round. The reference price is read by the contract, never supplied. */
export const createRoundCall = (
  pair: string,
  cutoffAt: number,
  roundSeconds: number,
  token: string,
  houseEdgeBps: number,
): Call => ({
  contractAddress: UPDOWN,
  entrypoint: "create_round",
  calldata: [
    shortString(pair),
    hex(cutoffAt),
    hex(roundSeconds),
    token,
    hex(houseEdgeBps),
    "0x0",
  ],
});

export const fundRoundCall = (roundId: number, amount: bigint): Call => ({
  contractAddress: UPDOWN,
  entrypoint: "fund_round",
  calldata: [hex(roundId), hex(amount), "0x0"],
});

export const settleRoundCall = (roundId: number): Call => ({
  contractAddress: UPDOWN,
  entrypoint: "settle",
  calldata: CallData.compile([roundId]),
});

/** Approve the direction market to pull a bankroll, the same shape the range market needs. */
export const approveUpDownCall = (amount: bigint): Call => ({
  contractAddress: TOKEN,
  entrypoint: "approve",
  calldata: [UPDOWN, hex(amount), "0x0"],
});

/** Every direction round the contract holds, newest last. */
export async function allRounds(): Promise<import("@molfi/sdk").OnChainRound[]> {
  if (!UPDOWN) return [];
  const { decodeRound } = await import("@molfi/sdk");
  const [countRaw] = await provider.callContract({
    contractAddress: UPDOWN, entrypoint: "round_count", calldata: [],
  });
  const count = Number(BigInt(countRaw));
  const out: import("@molfi/sdk").OnChainRound[] = [];
  for (let id = 1; id <= count; id += 1) {
    const r = await provider.callContract({
      contractAddress: UPDOWN, entrypoint: "get_round", calldata: [hex(id)],
    });
    out.push(decodeRound(id, r as string[]));
  }
  return out;
}
