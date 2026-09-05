"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtUsd } from "@molfi/sdk";
import {
  ADDRESSES,
  LIVE_CONFIGURED,
  activeChain,
  connectWallet,
  injected,
  publicClient,
} from "@/lib/chain";
import type { Address } from "viem";

const ERC20_BALANCE = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const short = (a: string) => `${a.slice(0, 10)}…${a.slice(-8)}`;

/**
 * Who you are on this chain, and what the desk is pointed at.
 *
 * Deliberately shows the deployment addresses rather than hiding them. The claim this
 * project makes is that the market is real and on-chain; the least it can do is print
 * the addresses so anyone can go and check.
 */
export function Account() {
  const [account, setAccount] = useState<Address | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [gas, setGas] = useState<bigint | null>(null);
  const [block, setBlock] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async (who: Address | null) => {
    try {
      const b = await publicClient.getBlockNumber();
      setBlock(b);
      if (!who || !ADDRESSES.ausd) return;
      const [bal, native] = await Promise.all([
        publicClient.readContract({
          address: ADDRESSES.ausd,
          abi: ERC20_BALANCE,
          functionName: "balanceOf",
          args: [who],
        }),
        publicClient.getBalance({ address: who }),
      ]);
      setBalance(bal as bigint);
      setGas(native);
    } catch (e) {
      setErr((e as Error).message.split("\n")[0]);
    }
  }, []);

  useEffect(() => {
    const eth = injected();
    if (!eth) {
      void refresh(null);
      return;
    }
    void (async () => {
      try {
        // Read whatever is already authorised without prompting for access.
        const accs = (await eth.request({ method: "eth_accounts" })) as Address[];
        const who = accs?.[0] ?? null;
        setAccount(who);
        await refresh(who);
      } catch {
        void refresh(null);
      }
    })();
  }, [refresh]);

  const connect = async () => {
    setBusy(true);
    setErr(null);
    try {
      const who = await connectWallet();
      setAccount(who);
      await refresh(who);
    } catch (e) {
      setErr((e as Error).message.split("\n")[0]);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* clipboard refused; the address is on screen to read */
    }
  };

  return (
    <div className="space-y-3 pb-6">
      {/* ---- identity */}
      <div className="rounded-2xl bg-[#141414] p-4">
        <div className="label">Wallet</div>
        {account ? (
          <>
            <button
              onClick={() => copy("address", account)}
              className="tnum mt-1 block w-full truncate text-left text-[15px] font-semibold text-white"
            >
              {short(account)}
            </button>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <div className="label">AUSD</div>
                <div className="tnum mt-0.5 text-[15px] font-semibold text-white">
                  {balance === null ? "—" : fmtUsd(balance)}
                </div>
              </div>
              <div>
                <div className="label">Gas ({activeChain.nativeCurrency.symbol})</div>
                <div className="tnum mt-0.5 text-[15px] font-semibold text-white">
                  {gas === null ? "—" : (Number(gas) / 1e18).toFixed(4)}
                </div>
              </div>
            </div>
            {gas !== null && gas === 0n ? (
              <p className="mt-3 text-[11px] leading-relaxed text-amber">
                No {activeChain.nativeCurrency.symbol} for gas. Firing will fail until
                this address can pay for a transaction.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="mt-1 text-[13px] leading-relaxed text-white/50">
              {injected()
                ? "No wallet connected. The demo desk needs none — this is only for live rounds."
                : "No wallet found in this browser. The demo desk still works without one."}
            </p>
            {injected() ? (
              <button
                onClick={() => void connect()}
                disabled={busy}
                className="mt-3 w-full rounded-xl bg-amber-2 py-3 text-[13px] font-bold text-black disabled:opacity-60"
              >
                {busy ? "CONNECTING…" : "CONNECT WALLET"}
              </button>
            ) : null}
          </>
        )}
        {copied ? (
          <p className="mono mt-2 text-[10px] tracking-[0.08em] text-green">COPIED {copied.toUpperCase()}</p>
        ) : null}
        {err ? <p className="mt-2 text-[11px] leading-relaxed text-red">{err}</p> : null}
      </div>

      {/* ---- network */}
      <div className="rounded-2xl bg-[#141414] p-4">
        <div className="label">Network</div>
        <Line label="Chain" value={`${activeChain.name} · ${activeChain.id}`} />
        <Line label="Head" value={block === null ? "—" : `block ${block.toString()}`} />
      </div>

      {/* ---- what the desk is pointed at */}
      <div className="rounded-2xl bg-[#141414] p-4">
        <div className="label">Deployment</div>
        {LIVE_CONFIGURED ? (
          <>
            <Copyable label="Range market" value={ADDRESSES.rangeMarket} onCopy={copy} />
            <Copyable label="Vault" value={ADDRESSES.vault} onCopy={copy} />
            <Copyable label="AUSD" value={ADDRESSES.ausd} onCopy={copy} />
            <Copyable label="Oracle" value={ADDRESSES.oracle} onCopy={copy} />
            <p className="mt-3 text-[11px] leading-relaxed text-white/40">
              Printed so they can be checked. Every quote, fire and settlement the desk
              shows came from these contracts.
            </p>
          </>
        ) : (
          <p className="mt-1 text-[13px] leading-relaxed text-white/50">
            No deployment configured. The desk is running on paper.
          </p>
        )}
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2 flex items-baseline justify-between gap-3">
      <span className="label shrink-0">{label}</span>
      <span className="tnum truncate text-[12px] text-white/75">{value}</span>
    </div>
  );
}

function Copyable({
  label,
  value,
  onCopy,
}: {
  label: string;
  value?: string | null;
  onCopy: (label: string, value: string) => void;
}) {
  if (!value) return null;
  return (
    <button
      onClick={() => onCopy(label, value)}
      className="mt-2 flex w-full items-baseline justify-between gap-3 text-left"
    >
      <span className="label shrink-0">{label}</span>
      <span className="tnum truncate text-[11px] text-white/60 hover:text-white">{value}</span>
    </button>
  );
}
