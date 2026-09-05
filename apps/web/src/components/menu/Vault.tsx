"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtUsd, XorrVaultAbi } from "@molfi/sdk";
import type { Address, Hex } from "viem";
import {
  ADDRESSES,
  LIVE_CONFIGURED,
  activeChain,
  connectWallet,
  injected,
  publicClient,
  walletClientFor,
} from "@/lib/chain";

const ERC20 = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "o", type: "address" },
      { name: "s", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "s", type: "address" },
      { name: "v", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

interface VaultState {
  totalAssets: bigint;
  freeAssets: bigint;
  reserved: bigint;
  utilisationBps: bigint;
  totalShares: bigint;
  myShares: bigint;
  myAssets: bigint;
  walletAusd: bigint;
  allowance: bigint;
}

const PRESETS = ["25", "100", "500"];

/**
 * The other side of the market.
 *
 * Every ticket a player fires is underwritten by this bankroll, and the console has
 * never let anyone see it, let alone join it. Deposit and you take the house's side:
 * you earn the spread when bands break and pay when they hold.
 *
 * The number that matters here is `freeAssets`. The vault reserves the FULL payout of
 * every open ticket, so a round where every player wins is still covered — which means
 * an LP cannot withdraw money that is currently backing someone's open position. That
 * ceiling is shown rather than discovered at the point of a failed transaction.
 */
export function Vault() {
  const [s, setS] = useState<VaultState | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  /**
   * The poll below reads through this rather than through state.
   *
   * An interval created once captures whatever `account` was at the time — null, before
   * the wallet had been read — and would then keep re-reading as nobody, wiping the
   * balances the first read had found. The symptom was a connected wallet reporting a
   * zero balance it demonstrably had.
   */
  const accountRef = useRef<Address | null>(null);
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<{ hash: Hex; what: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const vault = ADDRESSES.vault;
  const ausd = ADDRESSES.ausd;

  const read = useCallback(
    async (who: Address | null) => {
      if (!vault || !ausd) return;
      try {
        const [totalAssets, freeAssets, reserved, utilisationBps, totalShares] =
          (await Promise.all([
            publicClient.readContract({ address: vault, abi: XorrVaultAbi, functionName: "totalAssets" }),
            publicClient.readContract({ address: vault, abi: XorrVaultAbi, functionName: "freeAssets" }),
            publicClient.readContract({ address: vault, abi: XorrVaultAbi, functionName: "reserved" }),
            publicClient.readContract({ address: vault, abi: XorrVaultAbi, functionName: "utilisationBps" }),
            publicClient.readContract({ address: vault, abi: XorrVaultAbi, functionName: "totalShares" }),
          ])) as bigint[];

        let myShares = 0n;
        let myAssets = 0n;
        let walletAusd = 0n;
        let allowance = 0n;
        if (who) {
          [myShares, walletAusd, allowance] = (await Promise.all([
            publicClient.readContract({ address: vault, abi: XorrVaultAbi, functionName: "sharesOf", args: [who] }),
            publicClient.readContract({ address: ausd, abi: ERC20, functionName: "balanceOf", args: [who] }),
            publicClient.readContract({ address: ausd, abi: ERC20, functionName: "allowance", args: [who, vault] }),
          ])) as bigint[];
          if (myShares > 0n) {
            myAssets = (await publicClient.readContract({
              address: vault,
              abi: XorrVaultAbi,
              functionName: "convertToAssets",
              args: [myShares],
            })) as bigint;
          }
        }
        setS({ totalAssets, freeAssets, reserved, utilisationBps, totalShares, myShares, myAssets, walletAusd, allowance });
        setErr(null);
      } catch (e) {
        setErr((e as Error).message.split("\n")[0]);
      }
    },
    [vault, ausd],
  );

  useEffect(() => {
    let stop = false;
    const boot = async () => {
      let who: Address | null = null;
      const eth = injected();
      if (eth) {
        try {
          const accs = (await eth.request({ method: "eth_accounts" })) as Address[];
          who = accs?.[0] ?? null;
        } catch {
          /* not authorised yet */
        }
      }
      if (stop) return;
      accountRef.current = who;
      setAccount(who);
      await read(who);
    };
    void boot();
    const id = setInterval(() => void read(accountRef.current), 4000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [read]);

  const units = useMemo(() => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return 0n;
    return BigInt(Math.round(n * 1e6));
  }, [amount]);

  /** What this deposit would be worth, or what these shares would return. */
  const preview = useMemo(() => {
    if (!s || units === 0n) return null;
    if (mode === "deposit") {
      const share = s.totalAssets === 0n ? 1 : Number(units) / Number(s.totalAssets + units);
      return { label: "Share of the bankroll", value: `${(share * 100).toFixed(2)}%` };
    }
    return { label: "You receive", value: fmtUsd(units) };
  }, [s, units, mode]);

  const act = useCallback(async () => {
    if (!vault || !ausd || units === 0n) return;
    setErr(null);
    setDone(null);
    try {
      const who = account ?? (await connectWallet());
      if (!account) {
        accountRef.current = who;
        setAccount(who);
      }
      const wallet = walletClientFor(who);

      if (mode === "deposit") {
        if (!s || s.allowance < units) {
          setBusy("approving");
          const a = await wallet.writeContract({
            address: ausd,
            abi: ERC20,
            functionName: "approve",
            args: [vault, units],
            chain: activeChain,
            account: who,
          });
          await publicClient.waitForTransactionReceipt({ hash: a });
        }
        setBusy("depositing");
        const hash = await wallet.writeContract({
          address: vault,
          abi: XorrVaultAbi,
          functionName: "deposit",
          args: [units],
          chain: activeChain,
          account: who,
        });
        await publicClient.waitForTransactionReceipt({ hash });
        setDone({ hash, what: `deposited ${fmtUsd(units)}` });
      } else {
        // Withdraw takes shares, not assets — convert at the current rate.
        const shares = (await publicClient.readContract({
          address: vault,
          abi: XorrVaultAbi,
          functionName: "convertToShares",
          args: [units],
        })) as bigint;
        setBusy("withdrawing");
        const hash = await wallet.writeContract({
          address: vault,
          abi: XorrVaultAbi,
          functionName: "withdraw",
          args: [shares],
          chain: activeChain,
          account: who,
        });
        await publicClient.waitForTransactionReceipt({ hash });
        setDone({ hash, what: `withdrew ${fmtUsd(units)}` });
      }
      await read(who);
    } catch (e) {
      setErr((e as Error).message.split("\n")[0].slice(0, 150));
    } finally {
      setBusy(null);
    }
  }, [vault, ausd, units, account, mode, s, read]);

  /**
   * Check for the vault specifically, not just "is anything deployed".
   *
   * A deployment can carry a range market without a vault address configured, and the
   * broader check passed while the read below returned early — leaving the screen
   * saying "reading the vault" forever with nothing to read. An unconfigured screen
   * should say so immediately.
   */
  if (!LIVE_CONFIGURED || !vault || !ausd) {
    return (
      <p className="mt-8 text-center text-[13px] leading-relaxed text-white/45">
        The bankroll lives on-chain, so this needs a deployment.
        <br />
        The demo desk runs on paper and has no vault to join.
      </p>
    );
  }
  if (err && !s) return <p className="mt-8 text-center text-[13px] text-red">{err}</p>;
  if (!s) return <p className="label mt-8 text-center">reading the vault</p>;

  const util = Number(s.utilisationBps) / 100;
  const overFree = mode === "withdraw" && units > s.freeAssets;
  const overWallet = mode === "deposit" && units > s.walletAusd;
  const overMine = mode === "withdraw" && units > s.myAssets;

  return (
    <div className="space-y-3 pb-6">
      {/* ---- the bankroll */}
      <div className="rounded-2xl bg-[#141414] p-4">
        <div className="label">Bankroll</div>
        <div className="tnum mt-1 text-[28px] font-bold leading-none text-white">
          {fmtUsd(s.totalAssets)}
        </div>

        <div className="mt-3">
          <div className="flex items-baseline justify-between">
            <span className="label">Utilisation</span>
            <span className={`tnum text-[12px] ${util > 60 ? "text-amber" : "text-white/70"}`}>
              {util.toFixed(2)}% <span className="text-dim">of 80% cap</span>
            </span>
          </div>
          {/* The cap is drawn, so a full house is visible before it is hit. */}
          <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-[#242424]">
            <div
              className={`h-full w-full origin-left transition-transform duration-[240ms] ease-out ${util > 60 ? "bg-amber" : "bg-green-2"}`}
              style={{ transform: `scaleX(${Math.min(1, util / 80)})` }}
            />
            <span className="absolute inset-y-0 right-0 w-[1px] bg-red" aria-hidden />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-4">
          <Stat label="Backing open tickets" value={fmtUsd(s.reserved)} />
          <Stat label="Free to withdraw" value={fmtUsd(s.freeAssets)} />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-white/40">
          The vault reserves the <span className="text-white/70">full payout</span> of every
          open ticket, so a round where everyone wins is still covered. That is why free
          assets are less than the bankroll.
        </p>
      </div>

      {/* ---- your position */}
      <div className="rounded-2xl bg-[#141414] p-4">
        <div className="label">Your position</div>
        {account ? (
          <div className="mt-2 grid grid-cols-2 gap-4">
            <Stat label="Value" value={fmtUsd(s.myAssets)} big />
            <Stat
              label="Share"
              value={
                s.totalShares === 0n
                  ? "0.00%"
                  : `${((Number(s.myShares) / Number(s.totalShares)) * 100).toFixed(2)}%`
              }
              big
            />
          </div>
        ) : (
          <p className="mt-1 text-[13px] text-white/50">Connect a wallet to take the house side.</p>
        )}
      </div>

      {/* ---- act */}
      <div className="rounded-2xl bg-[#141414] p-4">
        <div className="flex rounded-full bg-[#0d0d0d] p-1">
          {(["deposit", "withdraw"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-full py-2 text-[12px] font-bold tracking-[0.08em] transition-colors ${
                mode === m ? "bg-amber text-black" : "text-white/45"
              }`}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="mt-3 flex gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setAmount(p)}
              className={`mono flex-1 rounded-lg py-2 text-[11px] transition-colors ${
                amount === p ? "bg-[#2a2a2a] text-white" : "bg-[#1e1e1e] text-white/55 hover:bg-[#262626]"
              }`}
            >
              ${p}
            </button>
          ))}
          <button
            onClick={() =>
              setAmount(
                String(
                  Number(
                    mode === "deposit"
                      ? s.walletAusd
                      : s.myAssets < s.freeAssets
                        ? s.myAssets
                        : s.freeAssets,
                  ) / 1e6,
                ),
              )
            }
            className="mono flex-1 rounded-lg bg-[#1e1e1e] py-2 text-[11px] text-white/55 hover:bg-[#262626]"
          >
            MAX
          </button>
        </div>

        <label className="mt-2 flex items-center gap-2 rounded-xl bg-[#0d0d0d] px-3 py-2.5">
          <span className="mono shrink-0 text-[13px] text-dim">$</span>
          <input
            value={amount}
            inputMode="decimal"
            aria-label={`AUSD to ${mode}`}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className="tnum w-full bg-transparent text-[16px] font-semibold text-white outline-none"
          />
          <span className="mono shrink-0 text-[11px] text-dim">AUSD</span>
        </label>

        {preview ? (
          <div className="mt-2.5 flex items-baseline justify-between">
            <span className="label">{preview.label}</span>
            <span className="tnum text-[14px] font-semibold text-green">{preview.value}</span>
          </div>
        ) : null}

        {overWallet ? (
          <p className="mt-2 text-[11px] leading-relaxed text-red">
            Wallet holds {fmtUsd(s.walletAusd)}.
          </p>
        ) : null}
        {overMine ? (
          <p className="mt-2 text-[11px] leading-relaxed text-red">
            Your position is {fmtUsd(s.myAssets)}.
          </p>
        ) : null}
        {overFree && !overMine ? (
          <p className="mt-2 text-[11px] leading-relaxed text-amber">
            Only {fmtUsd(s.freeAssets)} is free — the rest is backing open tickets and
            cannot be withdrawn until they settle.
          </p>
        ) : null}

        <button
          onClick={() => void act()}
          disabled={Boolean(busy) || units === 0n || overWallet || overMine || overFree}
          className="mt-3 w-full rounded-xl bg-amber-2 py-3 text-[13px] font-bold text-black disabled:opacity-45"
        >
          {busy
            ? `${busy.toUpperCase()}…`
            : account
              ? mode === "deposit"
                ? "DEPOSIT TO THE VAULT"
                : "WITHDRAW FROM THE VAULT"
              : "CONNECT AND CONTINUE"}
        </button>

        {done ? (
          <p className="mono mt-2 break-all text-[10px] leading-relaxed text-green">
            {done.what.toUpperCase()} · {done.hash.slice(0, 24)}…
          </p>
        ) : null}
        {err ? <p className="mt-2 text-[11px] leading-relaxed text-red">{err}</p> : null}
      </div>
    </div>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={`tnum mt-0.5 font-semibold text-white ${big ? "text-[18px]" : "text-[14px]"}`}>
        {value}
      </div>
    </div>
  );
}
