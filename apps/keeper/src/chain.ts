import { Account, CallData, RpcProvider, hash, type Call } from "starknet";

import {
  CALIBRATED_MARKETS,
  ROUND_SECONDS,
  SETTLEMENT_MAX_PRICE_AGE_SECONDS,
  decodePrint,
  freshness,
  pairId,
} from "@molfi/sdk";
import { PRAGMA } from "@molfi/sdk";
import { reason } from "./reason.ts";

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

async function syncNonce(): Promise<bigint> {
  const n = await account.getNonce();
  nextNonce = BigInt(n);
  return nextNonce;
}

/** Errors worth trying again. A contract refusal is an answer; a dropped socket is not. */
function transient(why: string): boolean {
  return /nonce|rate|timeout|fetch failed|ECONN|502|503|504|Gateway|temporarily/i.test(why);
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
 * Measured on Sepolia while writing this: one relay estimated at 0.09319 STRK against a
 * 0.08084 balance. The shortfall there is real and no bound can close it — the keeper needs
 * funding, not a tighter margin. The capping matters for the case one notch less bad, where
 * the fee fits and the padding does not.
 *
 * Passing explicit bounds also means `execute` does not estimate again, so this costs no
 * extra round trip.
 */
const FEE_MARGIN = 1.5;
/** Never offer the whole balance: the account still needs to pay for the next one. */
const SPENDABLE = 0.92;

async function boundsFor(call: Call | Call[], nonce: bigint) {
  const est = await account.estimateInvokeFee(call, { nonce });
  const estimated = est.overall_fee;
  const balance = await strkBalance(account.address);
  const affordable = (balance * BigInt(Math.round(SPENDABLE * 100))) / 100n;

  if (estimated > affordable) {
    throw new Error(
      `cannot afford this: the fee alone is ${estimated} and the balance is ${balance}`,
    );
  }

  const padded = (estimated * BigInt(Math.round(FEE_MARGIN * 100))) / 100n;
  const cap = padded <= affordable ? padded : affordable;
  // Scale the estimate's own resource bounds to the cap, keeping their shape.
  const scale = (v: bigint) => (estimated === 0n ? v : (v * cap) / estimated);
  const rb = est.resourceBounds;
  return {
    l1_gas: {
      max_amount: BigInt(rb.l1_gas.max_amount),
      max_price_per_unit: BigInt(rb.l1_gas.max_price_per_unit),
    },
    l1_data_gas: {
      max_amount: BigInt(rb.l1_data_gas.max_amount),
      max_price_per_unit: BigInt(rb.l1_data_gas.max_price_per_unit),
    },
    l2_gas: {
      max_amount: BigInt(rb.l2_gas.max_amount),
      max_price_per_unit: scale(BigInt(rb.l2_gas.max_price_per_unit)),
    },
  };
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
    try {
      await provider.waitForTransaction(hash, { retryInterval: 2_000 });
      console.log(`  ${label} → ${hash}`);
      return hash;
    } catch (e) {
      throw new Error(`${label} was submitted as ${hash} but could not be confirmed: ${reason(e)}`);
    }
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
