"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import {
  MARKETS,
  RangeMarketAbi,
  TestAUSDAbi,
  XorrVaultAbi,
  type MarketDef,
} from "@molfi/sdk";
import { ADDRESSES, connectWallet, explorerTx, publicClient, walletClientFor } from "./chain";
import type { PricePoint } from "./usePaperDesk";

const HISTORY = 160;
const READ_EVERY_MS = 900; // block number ticks at 300ms; contract reads are heavier

export interface LiveTicket {
  id: bigint;
  low: bigint;
  high: bigint;
  stake: bigint;
  payout: bigint;
  multiplierBps: number;
  prob1e6: number;
  /** uint48 on-chain, which viem decodes as a JS number. */
  openBlock: number;
  expiryBlock: number;
  settledPrice: bigint;
  status: number;
}

export interface LiveState {
  ready: boolean;
  error: string | null;
  account: Address | null;
  block: bigint;
  spot: bigint;
  history: PricePoint[];
  balance: bigint;
  allowance: bigint;
  utilisationBps: bigint;
  roundBlocks: number[];
  tickets: LiveTicket[];
  /**
   * Every open ticket past its cutoff, whoever opened it.
   *
   * Settlement is permissionless — the contract lets anyone poke an expired ticket, and
   * the keeper exists only to make sure somebody does. A console that settles only its
   * own tickets quietly implies otherwise, so the desk surfaces the whole queue and
   * lets a player clear it.
   */
  dueTickets: LiveTicket[];
  pending: string | null;
  lastTx: { hash: Hex; label: string } | null;
}

/**
 * The live desk. Everything on screen is read from the chain: the block height, the
 * oracle print, the quote, the vault's utilisation, and the player's own tickets.
 * Nothing here is simulated — if the RPC is down, the desk says so rather than
 * quietly falling back to made-up numbers.
 */
/**
 * The most informative sentence available from a chain error.
 *
 * viem maps JSON-RPC error codes onto canned messages, so a node that is simply not
 * answering surfaces as "Missing or invalid parameters" — which sends whoever is
 * debugging at the request rather than at the dead node. The original text survives on
 * `details`/`shortMessage`, so prefer those.
 */
function chainErrorText(e: unknown): string {
  const err = e as { details?: string; shortMessage?: string; message?: string };
  const pick = err?.details || err?.shortMessage || err?.message || String(e);
  return pick.split("\n")[0].slice(0, 120);
}

/**
 * One transaction at a time, per session.
 *
 * Two fires in flight from the same account collide on a nonce: the wallet hands both
 * the same one, the second is rejected as a replacement, and the desk shows a failure
 * for a ticket the user did open. On a 300ms chain that is not a rare race — it is what
 * happens when someone hits the key twice, which the product actively encourages by
 * telling them to stack.
 *
 * A queue rather than a lock, because refusing the second press would be worse than
 * sequencing it: the band is sent as a shape and centred at execution, so a fire that
 * waits its turn is still the band the player painted.
 */
let txQueue: Promise<unknown> = Promise.resolve();

function queued<T>(job: () => Promise<T>): Promise<T> {
  const run = txQueue.then(job, job);
  // Keep the chain alive after a rejection; a failed fire must not wedge every later one.
  txQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Retry a read that failed for a transport reason, and never one that failed for a
 * contract reason.
 *
 * A reverted simulation is an answer — the band is too tight, the price is stale — and
 * retrying it just repeats the same answer more slowly. A dropped connection is not an
 * answer, and on a node that is briefly busy the difference between surfacing it and
 * retrying once is the difference between a demo that stutters and one that fails.
 */
async function withBackoff<T>(what: string, job: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await job();
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      // Anything the contract or the user decided is final.
      if (
        /revert|rejected|denied|insufficient|Stale|Band|Tier|Market|execution reverted|User/i.test(
          msg,
        )
      ) {
        throw e;
      }
      lastErr = e;
      if (i < attempts - 1) {
        // 200ms, then 600ms. Short: the round these serve is three seconds long.
        await new Promise((r) => setTimeout(r, 200 * 3 ** i));
      }
    }
  }
  throw new Error(
    `${what} failed after ${attempts} attempts: ${String((lastErr as Error)?.message ?? lastErr).slice(0, 160)}`,
  );
}

export function useLiveDesk(market: MarketDef, tier: number) {
  const [state, setState] = useState<LiveState>({
    ready: false,
    error: null,
    account: null,
    block: 0n,
    spot: 0n,
    history: [],
    balance: 0n,
    allowance: 0n,
    utilisationBps: 0n,
    roundBlocks: [],
    tickets: [],
    dueTickets: [],
    pending: null,
    lastTx: null,
  });

  const historyRef = useRef<PricePoint[]>([]);
  const accountRef = useRef<Address | null>(null);

  const range = ADDRESSES.rangeMarket;
  const vault = ADDRESSES.vault;
  const ausd = ADDRESSES.ausd;

  // ---- block height, straight off the chain, as fast as it moves
  useEffect(() => {
    if (!range) return;
    const unwatch = publicClient.watchBlockNumber({
      emitOnBegin: true,
      onBlockNumber: (block) => setState((s) => ({ ...s, block })),
      onError: (e) => setState((s) => ({ ...s, error: chainErrorText(e) })),
    });
    return () => unwatch();
  }, [range]);

  // ---- contract reads
  const refresh = useCallback(async () => {
    if (!range || !vault || !ausd) return;
    try {
      const account = accountRef.current;

      // Explicit parallel reads rather than one mixed multicall: viem cannot infer a
      // heterogeneous contracts array built with a conditional spread, and losing the
      // ABI types here would mean losing the compile-time check that the desk and the
      // contract still agree on every signature.
      const [limits, utilisationBps, roundsRaw] = await Promise.all([
        publicClient.readContract({
          address: range,
          abi: RangeMarketAbi,
          functionName: "bandLimits",
          args: [market.marketId as Hex, tier],
        }),
        publicClient.readContract({
          address: vault,
          abi: XorrVaultAbi,
          functionName: "utilisationBps",
        }),
        publicClient.readContract({ address: range, abi: RangeMarketAbi, functionName: "rounds" }),
      ]);

      const spot = (limits as readonly bigint[])[0];
      const roundBlocks = (roundsRaw as readonly number[]).map(Number);

      let balance = 0n;
      let allowance = 0n;
      let tickets: LiveTicket[] = [];

      if (account) {
        const [bal, allow, ids] = await Promise.all([
          publicClient.readContract({
            address: ausd,
            abi: TestAUSDAbi,
            functionName: "balanceOf",
            args: [account],
          }),
          publicClient.readContract({
            address: ausd,
            abi: TestAUSDAbi,
            functionName: "allowance",
            args: [account, range],
          }),
          publicClient.readContract({
            address: range,
            abi: RangeMarketAbi,
            functionName: "ticketsOf",
            args: [account],
          }),
        ]);
        balance = bal as bigint;
        allowance = allow as bigint;

        // Only the most recent handful; the tape does not need a full history.
        const recent = (ids as readonly bigint[]).slice(-12);
        const raw = await Promise.all(
          recent.map((id) =>
            publicClient.readContract({
              address: range,
              abi: RangeMarketAbi,
              functionName: "getTicket",
              args: [id],
            }),
          ),
        );
        tickets = raw.map((t, i) => ({ ...(t as Omit<LiveTicket, "id">), id: recent[i] }));
      }

      /**
       * The market-wide settle queue, scanned from the newest ticket backwards.
       *
       * Bounded on purpose: a full scan from id 1 grows without limit and this runs on
       * a four-second poll. The tail is where anything unsettled actually is, because
       * everything older has either been poked already or is past its window.
       */
      let dueTickets: LiveTicket[] = [];
      try {
        const head = await publicClient.getBlockNumber();
        const next = (await publicClient.readContract({
          address: range,
          abi: RangeMarketAbi,
          functionName: "nextTicketId",
        })) as bigint;
        const ids: bigint[] = [];
        for (let id = next - 1n; id >= 1n && ids.length < 24; id--) ids.push(id);
        const rows = await Promise.all(
          ids.map((id) =>
            publicClient.readContract({
              address: range,
              abi: RangeMarketAbi,
              functionName: "getTicket",
              args: [id],
            }),
          ),
        );
        dueTickets = rows
          .map((t, i) => ({ ...(t as Omit<LiveTicket, "id">), id: ids[i] }))
          .filter((t) => t.status === 0 && head >= BigInt(t.expiryBlock));
      } catch {
        // The queue is a convenience; the desk works without it.
      }

      if (spot > 0n) {
        const h = historyRef.current;
        const last = h[h.length - 1];
        if (!last || last.price !== spot) {
          h.push({ block: Number(state.block), price: spot });
          if (h.length > HISTORY) h.shift();
        }
      }

      setState((s) => ({
        ...s,
        ready: true,
        error: null,
        spot,
        history: [...historyRef.current],
        balance,
        allowance,
        utilisationBps: utilisationBps as bigint,
        roundBlocks,
        tickets,
        dueTickets,
      }));
    } catch (e) {
      setState((s) => ({ ...s, error: chainErrorText(e) }));
    }
  }, [range, vault, ausd, market.marketId, tier, state.block]);

  useEffect(() => {
    if (!range) return;
    void refresh();
    const id = setInterval(() => void refresh(), READ_EVERY_MS);
    return () => clearInterval(id);
    // refresh changes with every block; the interval only needs the latest closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, market.marketId, tier]);

  const connect = useCallback(async () => {
    try {
      const account = await connectWallet();
      accountRef.current = account;
      setState((s) => ({ ...s, account, error: null }));
      void refresh();
    } catch (e) {
      setState((s) => ({ ...s, error: chainErrorText(e) }));
    }
  }, [refresh]);

  /** Quote a band against the deployed contract, not a local guess. */
  const quoteOnChain = useCallback(
    async (low: bigint, high: bigint) => {
      if (!range) return null;
      try {
        const r = (await publicClient.readContract({
          address: range,
          abi: RangeMarketAbi,
          functionName: "quote",
          args: [market.marketId as Hex, low, high, tier],
        })) as readonly [bigint, bigint, bigint];
        return { multiplierBps: r[0], prob1e6: r[1], spot: r[2] };
      } catch {
        return null;
      }
    },
    [range, market.marketId, tier],
  );

  /**
   * Wait for a receipt and insist it succeeded.
   *
   * A reverted transaction still produces a receipt, so awaiting one proves only that
   * the chain saw it. Without this check the desk reported "fired" and printed a hash
   * for a transaction that had reverted and opened no ticket.
   */
  const confirm = useCallback(async (hash: Hex, what: string) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      setState((s) => ({ ...s, pending: null }));
      throw new Error(`${what} reverted on chain (${hash.slice(0, 12)}…)`);
    }
    return receipt;
  }, []);

  /**
   * @param lowHalf1e4  distance below the print, in 1e4-scaled bps
   * @param highHalf1e4 distance above the print, in 1e4-scaled bps
   *
   * The band is sent as a shape, not as two prices. Absolute endpoints race the
   * market: a band a few basis points wide, painted around the spot the desk last
   * read, is often already off-centre by the time the transaction lands, and the open
   * reverts. Sending the shape lets the contract centre it on the print at execution.
   */
  const fire = useCallback(
    (lowHalf1e4: bigint, highHalf1e4: bigint, stake: bigint) =>
      queued(async () => {
      const account = accountRef.current;
      if (!account || !range || !ausd) throw new Error("connect a wallet first");
      const wallet = walletClientFor(account);

      setState((s) => ({ ...s, pending: "approving" }));
      if (state.allowance < stake) {
        const approveHash = await wallet.writeContract({
          address: ausd,
          abi: TestAUSDAbi,
          functionName: "approve",
          args: [range, 2n ** 255n],
        });
        await confirm(approveHash, "approve");
      }

      setState((s) => ({ ...s, pending: "firing" }));

      // Simulate first. The market refuses bands for specific, nameable reasons —
      // too wide, too tight, spot outside, a stale print — and simulating turns those
      // into a decoded custom error instead of an opaque failed transaction.
      const { request } = await withBackoff("quoting the band", () =>
        publicClient.simulateContract({
          account,
          address: range,
          abi: RangeMarketAbi,
          functionName: "fireBand",
          args: [
            market.marketId as Hex,
            Number(lowHalf1e4),
            Number(highHalf1e4),
            stake,
            tier,
          ],
        }),
      );

      const hash = await wallet.writeContract(request);
      await confirm(hash, "fire");

      setState((s) => ({ ...s, pending: null, lastTx: { hash, label: "fired" } }));
      void refresh();
      return hash;
      }),
    [range, ausd, market.marketId, tier, state.allowance, refresh, confirm],
  );

  /** Anyone can poke a ticket once its cutoff block has passed. */
  const settle = useCallback(
    (id: bigint) =>
      queued(async () => {
      const account = accountRef.current;
      if (!account || !range) throw new Error("connect a wallet first");
      const wallet = walletClientFor(account);

      setState((s) => ({ ...s, pending: "settling" }));
      const { request } = await withBackoff("preparing the settle", () =>
        publicClient.simulateContract({
          account,
          address: range,
          abi: RangeMarketAbi,
          functionName: "settle",
          args: [id],
        }),
      );
      const hash = await wallet.writeContract(request);
      await confirm(hash, "settle");

      setState((s) => ({ ...s, pending: null, lastTx: { hash, label: "settled" } }));
      void refresh();
      return hash;
      }),
    [range, refresh, confirm],
  );

  /**
   * Clear the whole due queue in one transaction.
   *
   * `settleBatch` exists on the contract and had no way into the product, so a player
   * looking at eight expired tickets could only poke them one at a time — eight
   * signatures for something the contract was built to do in one. The contract caps the
   * batch, so this sends at most that many and leaves the rest for the next press
   * rather than reverting the lot.
   */
  const settleAllDue = useCallback(
    (ids: bigint[]) =>
      queued(async () => {
        const account = accountRef.current;
        if (!account || !range) throw new Error("connect a wallet first");
        if (ids.length === 0) throw new Error("nothing is due");
        const wallet = walletClientFor(account);

        const maxBatch = Number(
          (await publicClient.readContract({
            address: range,
            abi: RangeMarketAbi,
            functionName: "maxBatch",
          })) as number | bigint,
        );
        const batch = ids.slice(0, Math.max(1, maxBatch));

        setState((s) => ({ ...s, pending: "settling" }));
        const { request } = await withBackoff("preparing the batch", () =>
          publicClient.simulateContract({
            account,
            address: range,
            abi: RangeMarketAbi,
            functionName: "settleBatch",
            args: [batch],
          }),
        );
        const hash = await wallet.writeContract(request);
        await confirm(hash, "settle batch");

        setState((s) => ({
          ...s,
          pending: null,
          lastTx: { hash, label: `settled ${batch.length}` },
        }));
        void refresh();
        return hash;
      }),
    [range, refresh, confirm],
  );

  return { state, connect, fire, settle, settleAllDue, quoteOnChain, refresh, explorerTx };
}
