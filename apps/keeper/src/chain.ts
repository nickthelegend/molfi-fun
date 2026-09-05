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

/**
 * The one line worth reading out of a Starknet revert.
 *
 * A failed call comes back as several hundred characters of nested addresses wrapped around
 * a single quoted felt. Logging the envelope buries the reason; logging the felt loses
 * nothing anyone needs.
 */
export function reason(e: unknown): string {
  const text = String((e as Error)?.message ?? e);
  const named = text.match(/\('([A-Z0-9_]+)'\)/);
  if (named) return named[1];
  return text.split("\n")[0].slice(0, 200);
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
 */
export async function send(call: Call, label: string): Promise<string> {
  const { transaction_hash } = await account.execute(call);
  await provider.waitForTransaction(transaction_hash, { retryInterval: 2_000 });
  console.log(`  ${label} → ${transaction_hash}`);
  return transaction_hash;
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
