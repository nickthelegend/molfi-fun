"use client";

import { useEffect, useState } from "react";
import { CallData } from "starknet";
import { PRAGMA, fmtStrk } from "@molfi/sdk";
import {
  ADDRESSES,
  LIVE_CONFIGURED,
  activeNetwork,
  explorerContract,
  liveBlockedReason,
  provider,
  shortAddress,
} from "@/lib/chain";
import type { Connection, StarknetWallet } from "@/lib/wallet";

/**
 * Who you are on this chain, and what the desk is pointed at.
 *
 * The addresses are printed rather than hidden. The claim this project makes is that the
 * market is real and on chain; the least it can do is show where, so anyone can go and
 * check it themselves.
 *
 * Two balances, and the distinction is the product. The **public** balance is what any
 * observer can already see at this address. The **shielded** balance is inside the pool,
 * readable only because your own wallet holds the viewing key and chose to answer — molfi
 * never has one, which is why it can be unknown here and that is shown as unknown.
 */
export function Account({
  connection,
  wallets,
  shielded,
  onConnect,
  onDisconnect,
}: {
  connection: Connection | null;
  wallets: StarknetWallet[];
  shielded: bigint | null;
  onConnect: (wallet: StarknetWallet) => Promise<unknown>;
  onDisconnect: () => void;
}) {
  const [publicStrk, setPublicStrk] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!connection || !ADDRESSES.token) {
      setPublicStrk(null);
      return;
    }
    let stop = false;
    void (async () => {
      try {
        const r = await provider.callContract({
          contractAddress: ADDRESSES.token!,
          entrypoint: "balance_of",
          calldata: CallData.compile([connection.address]),
        });
        if (!stop) setPublicStrk((BigInt(r[1]) << 128n) | BigInt(r[0]));
      } catch (e) {
        if (!stop) {
          setPublicStrk(null);
          setErr(String((e as Error).message).split("\n")[0]);
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [connection]);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* clipboard refused; the address is on screen to read */
    }
  };

  const connect = async (wallet: StarknetWallet) => {
    setBusy(true);
    setErr(null);
    try {
      await onConnect(wallet);
    } catch (e) {
      setErr(String((e as Error).message).split("\n")[0]);
    } finally {
      setBusy(false);
    }
  };

  /**
   * What to call the settlement oracle, decided by which contract it actually is.
   *
   * On Sepolia this address is molfi's price relay, not Pragma. Printing "Pragma oracle"
   * above it sent anyone who followed the link to a contract that settles nothing here —
   * on the sheet whose entire purpose is "printed so they can be checked".
   */
  const oracleLabel =
    ADDRESSES.oracle &&
    ADDRESSES.oracle.toLowerCase() !==
      PRAGMA[activeNetwork.name === "mainnet" ? "mainnet" : "sepolia"]?.toLowerCase()
      ? "Price relay (mainnet Pragma, republished)"
      : "Pragma oracle";

  return (
    <div className="space-y-3 pb-6">
      {/* ---- identity */}
      <div className="rounded-2xl bg-[#141414] p-4">
        <div className="label">Wallet</div>
        {connection ? (
          <>
            <button
              onClick={() => copy("address", connection.address)}
              className="tnum mt-1 block w-full truncate text-left text-[15px] font-semibold text-white"
            >
              {shortAddress(connection.address, 10, 8)}
            </button>
            <p className="mt-0.5 text-[12px] text-white/40">
              {connection.walletName} ·{" "}
              {connection.network === "unknown" ? "unrecognised chain" : connection.network}
            </p>

            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <div className="label">Public STRK</div>
                <div className="tnum mt-0.5 text-[15px] font-semibold text-white">
                  {publicStrk === null ? "—" : fmtStrk(publicStrk, 3)}
                </div>
              </div>
              <div>
                <div className="label">Shielded STRK</div>
                <div className="tnum mt-0.5 text-[15px] font-semibold text-white">
                  {shielded === null ? "—" : fmtStrk(shielded, 3)}
                </div>
              </div>
            </div>

            <Capabilities connection={connection} />

            {publicStrk !== null && publicStrk === 0n ? (
              <p className="mt-3 text-[11px] leading-relaxed text-amber">
                No STRK at this address. Starknet charges fees in STRK, so every action —
                including shielding — will fail until it can pay for one.
              </p>
            ) : null}

            <button
              onClick={onDisconnect}
              className="mt-3 w-full rounded-xl bg-[#242424] py-2.5 text-[12px] font-semibold"
            >
              DISCONNECT
            </button>
          </>
        ) : (
          <>
            <p className="mt-1 text-[13px] leading-relaxed text-white/50">
              {wallets.length > 0
                ? "No wallet connected. The demo desk needs none — this is only for live rounds."
                : "No Starknet wallet found in this browser. The demo desk still works without one."}
            </p>
            {wallets.map((w) => (
              <button
                key={w.name}
                onClick={() => void connect(w)}
                disabled={busy}
                className="mt-3 flex w-full items-center gap-3 rounded-xl bg-amber-2 px-4 py-3 text-[13px] font-bold text-black disabled:opacity-60"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {w.icon ? <img src={w.icon} alt="" className="h-5 w-5 rounded" /> : null}
                {busy ? "CONNECTING…" : w.name.toUpperCase()}
              </button>
            ))}
          </>
        )}
        {copied ? (
          <p className="mono mt-2 text-[10px] tracking-[0.08em] text-green">
            COPIED {copied.toUpperCase()}
          </p>
        ) : null}
        {err ? <p className="mt-2 text-[11px] leading-relaxed text-red">{err}</p> : null}
      </div>

      {/* ---- network */}
      <div className="rounded-2xl bg-[#141414] p-4">
        <div className="label">Network</div>
        <Line label="Chain" value={`Starknet ${activeNetwork.name}`} />
        <Line label="Chain id" value={activeNetwork.chainId} />
      </div>

      {/* ---- what the desk is pointed at */}
      <div className="rounded-2xl bg-[#141414] p-4">
        <div className="label">Deployment</div>
        <Copyable label="Privacy pool" value={ADDRESSES.pool} onCopy={copy} />
        <Copyable label="molfi market" value={ADDRESSES.market} onCopy={copy} />
        <Copyable label="STRK" value={ADDRESSES.token} onCopy={copy} />
        {/* Labelled by what it is, not by what it wraps. On Sepolia this address is the
            price relay, and calling it "Pragma oracle" sent anyone who checked it to a
            contract that settles nothing here. */}
        <Copyable label={oracleLabel} value={ADDRESSES.oracle} onCopy={copy} />
        {LIVE_CONFIGURED ? (
          <p className="mt-3 text-[11px] leading-relaxed text-white/40">
            Printed so they can be checked. Every quote, position and settlement the desk
            shows came from these contracts.
          </p>
        ) : (
          <p className="mt-3 text-[11px] leading-relaxed text-amber">{liveBlockedReason()}</p>
        )}
      </div>
    </div>
  );
}

/** What this wallet can actually do, asked rather than assumed. */
function Capabilities({ connection }: { connection: Connection }) {
  const items = [
    { label: "private", on: connection.capabilities.privateActions },
    { label: "dry run", on: connection.capabilities.dryRun },
    { label: "balance", on: connection.capabilities.balances },
  ];
  return (
    <div className="mt-3 flex gap-1.5">
      {items.map((i) => (
        <span
          key={i.label}
          className={`mono rounded border px-1.5 py-0.5 text-[9px] uppercase ${
            i.on ? "border-amber/40 text-amber" : "border-white/10 text-white/25"
          }`}
        >
          {i.label}
        </span>
      ))}
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
  if (!value) {
    return (
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="label shrink-0">{label}</span>
        <span className="text-[11px] text-white/30">not deployed</span>
      </div>
    );
  }
  const link = explorerContract(value);
  return (
    <div className="mt-2 flex items-baseline justify-between gap-3">
      <span className="label shrink-0">{label}</span>
      <span className="flex min-w-0 items-baseline gap-2">
        <button
          onClick={() => onCopy(label, value)}
          className="tnum truncate text-[11px] text-white/60 hover:text-white"
        >
          {value}
        </button>
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer noopener"
            className="shrink-0 text-[11px] text-amber"
          >
            ↗
          </a>
        ) : null}
      </span>
    </div>
  );
}
