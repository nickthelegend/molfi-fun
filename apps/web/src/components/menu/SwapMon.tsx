"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseEther, type Address, type Hex } from "viem";
import { quoteSell, type Level } from "@molfi/sdk";
import { ADDRESSES, activeChain, connectWallet, injected, publicClient, walletClientFor } from "@/lib/chain";

/** Kuru's router and the MON-AUSD book, on Monad. */
const ROUTER = "0xd651346d7c789536ebf06dc72aE3C8502cd695CC" as Address;
const NATIVE = "0x0000000000000000000000000000000000000000" as Address;

const ROUTER_ABI = [
  {
    name: "anyToAnySwap",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_marketAddresses", type: "address[]" },
      { name: "_isBuy", type: "bool[]" },
      { name: "_nativeSend", type: "bool[]" },
      { name: "_debitToken", type: "address" },
      { name: "_creditToken", type: "address" },
      { name: "_amount", type: "uint256" },
      { name: "_minAmountOut", type: "uint256" },
    ],
    outputs: [{ name: "_amountOut", type: "uint256" }],
  },
] as const;

const PRESETS = ["1", "5", "25", "100"];

/**
 * Top up by selling MON into Kuru's order book.
 *
 * Everyone on Monad holds MON — it is the gas token — and nobody starts with AUSD. So
 * the shortest path from "I have a wallet" to "I can play" runs through the venue this
 * market is already priced from. The quote below is not a spot price with a fee bolted
 * on: it walks the actual resting bids, so the number shown is the fill the book can
 * give, and a size larger than the touch is honestly quoted worse.
 */
export function SwapMon({ onDone }: { onDone?: () => void }) {
  const [bids, setBids] = useState<Level[] | null>(null);
  const [bookErr, setBookErr] = useState<string | null>(null);
  const [market, setMarket] = useState<Address | null>(null);
  const [amount, setAmount] = useState("5");
  const [account, setAccount] = useState<Address | null>(null);
  const [monBalance, setMonBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ hash: Hex; got: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // The same depth the oracle prices from, read through the contract.
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch("/api/kuru", { cache: "no-store" });
        const j = (await r.json()) as {
          onchain?: { bids: Level[] };
          market?: string;
          error?: string;
        };
        if (stop) return;
        if (!j.onchain) {
          setBookErr(j.error ?? "no book available");
          return;
        }
        setBookErr(null);
        setBids(j.onchain.bids);
        if (j.market) setMarket(j.market as Address);
      } catch (e) {
        if (!stop) setBookErr((e as Error).message);
      }
    };
    void load();
    const id = setInterval(load, 6000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  const refreshAccount = useCallback(async (who: Address | null) => {
    setAccount(who);
    if (!who) return;
    try {
      setMonBalance(await publicClient.getBalance({ address: who }));
    } catch {
      setMonBalance(null);
    }
  }, []);

  useEffect(() => {
    const eth = injected();
    if (!eth) return;
    void (async () => {
      try {
        const accs = (await eth.request({ method: "eth_accounts" })) as Address[];
        await refreshAccount(accs?.[0] ?? null);
      } catch {
        /* not authorised yet; the connect button handles it */
      }
    })();
  }, [refreshAccount]);

  const size = Number(amount);
  const fill = useMemo(
    () => (bids && Number.isFinite(size) && size > 0 ? quoteSell(bids, size) : null),
    [bids, size],
  );

  const swap = useCallback(async () => {
    setErr(null);
    setDone(null);
    if (!market || !fill) return;

    setBusy(true);
    try {
      const who = account ?? (await connectWallet());
      if (!account) await refreshAccount(who);

      const wallet = walletClientFor(who);
      const value = parseEther(amount);

      // Accept 1% worse than the book currently shows. The book can move between the
      // quote and the block that includes this, and a swap that silently fills far
      // worse is the thing this guard exists to prevent.
      const minOut = BigInt(Math.floor(fill.proceeds * 1e6 * 0.99));

      const hash = await wallet.writeContract({
        address: ROUTER,
        abi: ROUTER_ABI,
        functionName: "anyToAnySwap",
        args: [[market], [false], [true], NATIVE, ADDRESSES.ausd as Address, value, minOut],
        value,
        chain: activeChain,
        account: who,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setDone({ hash, got: fill.proceeds });
      await refreshAccount(who);
      onDone?.();
    } catch (e) {
      setErr((e as Error).message.split("\n")[0].slice(0, 140));
    } finally {
      setBusy(false);
    }
  }, [market, fill, account, amount, refreshAccount, onDone]);

  const enough =
    monBalance === null || !Number.isFinite(size) ? true : monBalance >= parseEther(amount || "0");

  return (
    <div className="rounded-2xl bg-[#141414] p-4">
      <div className="flex items-baseline justify-between">
        <span className="label">Top up with MON</span>
        <span className="mono text-[9px] tracking-[0.1em] text-dim">VIA KURU</span>
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-white/45">
        Sell MON into the same order book this desk prices from. The quote walks the
        real resting bids, so the size you pick is priced the way it would actually fill.
      </p>

      {bookErr ? (
        <p className="mt-3 text-[12px] text-red">book unavailable: {bookErr}</p>
      ) : !bids ? (
        <p className="label mt-3">reading the book</p>
      ) : (
        <>
          <div className="mt-3 flex gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setAmount(p)}
                className={`mono flex-1 rounded-lg py-2 text-[11px] transition-colors ${
                  amount === p ? "bg-amber text-black" : "bg-[#1e1e1e] text-white/60 hover:bg-[#262626]"
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <label className="mt-2 flex items-center gap-2 rounded-xl bg-[#0d0d0d] px-3 py-2.5">
            <input
              value={amount}
              inputMode="decimal"
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              className="tnum w-full bg-transparent text-[16px] font-semibold text-white outline-none"
              aria-label="MON to sell"
            />
            <span className="mono shrink-0 text-[11px] text-dim">MON</span>
          </label>

          {fill && fill.filled > 0 ? (
            <div className="mt-3 space-y-1.5">
              <Row label="You receive" value={`${fill.proceeds.toFixed(4)} AUSD`} strong />
              <Row label="Average price" value={fill.averagePrice.toFixed(6)} />
              <Row
                label="Price impact"
                value={`${fill.slippageBps.toFixed(0)} bps`}
                tone={fill.slippageBps > 100 ? "text-amber" : undefined}
              />
              <Row
                label="Book levels used"
                value={`${fill.levelsConsumed}`}
                tone={fill.levelsConsumed > 3 ? "text-amber" : undefined}
              />
              {fill.partial ? (
                <p className="mt-2 text-[11px] leading-relaxed text-amber">
                  The book only has {fill.filled.toFixed(2)} MON of bids, so this size
                  cannot fill. Sending it anyway would hand the router more MON than
                  there are orders to meet.{" "}
                  <button
                    onClick={() => setAmount(String(Math.floor(fill.filled * 100) / 100))}
                    className="underline decoration-amber/50 underline-offset-2"
                  >
                    Use {(Math.floor(fill.filled * 100) / 100).toFixed(2)} instead
                  </button>
                </p>
              ) : null}
              {!enough ? (
                <p className="mt-2 text-[11px] leading-relaxed text-red">
                  This address holds{" "}
                  {monBalance === null ? "—" : (Number(monBalance) / 1e18).toFixed(3)} MON.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-[12px] text-white/40">Enter an amount to see the fill.</p>
          )}

          <button
            onClick={() => void swap()}
            // A partial fill is refused rather than attempted: the router would be sent
            // the full amount with only part of it fillable.
            disabled={busy || !fill || fill.filled <= 0 || fill.partial || !enough}
            className="mt-3 w-full rounded-xl bg-amber-2 py-3 text-[13px] font-bold text-black disabled:opacity-45"
          >
            {busy ? "SWAPPING…" : account ? "SELL MON FOR AUSD" : "CONNECT AND SWAP"}
          </button>

          {done ? (
            <p className="mono mt-2 break-all text-[10px] leading-relaxed text-green">
              FILLED · {done.got.toFixed(4)} AUSD · {done.hash.slice(0, 22)}…
            </p>
          ) : null}
          {err ? <p className="mt-2 text-[11px] leading-relaxed text-red">{err}</p> : null}
        </>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="label shrink-0">{label}</span>
      <span
        className={`tnum text-right ${strong ? "text-[15px] font-semibold text-green" : `text-[12px] ${tone ?? "text-white/70"}`}`}
      >
        {value}
      </span>
    </div>
  );
}
