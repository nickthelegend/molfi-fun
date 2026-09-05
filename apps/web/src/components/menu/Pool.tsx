"use client";

import { useMemo, useState } from "react";
import { MARKETS, fmtCountdown, fmtMultiplier, fmtPrice, fmtStrk, parseStrk } from "@molfi/sdk";
import { ADDRESSES, explorerTx, shortAddress } from "@/lib/chain";
import { exportPosition, forget, importPosition } from "@/lib/positions";
import type { LivePosition } from "@/lib/useLiveDesk";

/**
 * The pool sheet: money in, money out, and everything this browser is holding.
 *
 * The XORR original had a vault here — deposit to take the house side of the book. molfi has
 * no vault to deposit into: the market contract is its own bankroll and asserts that it can
 * never pay out more than it took in, which is a smaller promise than an LP position and one
 * that can be checked. So this sheet is the thing that actually exists in its place: the
 * public edges of the pool, and custody of the secrets that make a position claimable.
 */
export function Pool({
  shielded,
  positions,
  pending,
  address,
  onShield,
  onUnshield,
  onClaim,
}: {
  shielded: bigint | null;
  positions: LivePosition[];
  pending: string | null;
  address: string | null;
  onShield: (amount: bigint) => Promise<string>;
  onUnshield: (amount: bigint, to: string) => Promise<string>;
  onClaim: (p: LivePosition) => Promise<string>;
}) {
  const [amount, setAmount] = useState("10");
  const [to, setTo] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => {
    try {
      const v = parseStrk(amount || "0");
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }, [amount]);

  const run = async (job: () => Promise<string>) => {
    setBusy(true);
    setNote(null);
    try {
      const hash = await job();
      setNote(`Done · ${hash.slice(0, 18)}…`);
    } catch (e) {
      setNote(String((e as Error).message).slice(0, 160));
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || Boolean(pending) || !parsed;

  return (
    <div>
      <div className="rounded-2xl bg-[#161616] p-4">
        <div className="flex items-center justify-between">
          <span className="label">Shielded balance</span>
          <span className="label">{address ? shortAddress(address) : "not connected"}</span>
        </div>
        {/* Unknown is shown as unknown. Rendering an unreadable balance as "0.000" is a
            lie with a decimal point in it — and here it would read as "your money is gone". */}
        <div className="tnum mt-2 text-[30px] font-bold leading-none">
          {shielded === null ? "—" : fmtStrk(shielded, 3)}{" "}
          <span className="text-[15px] text-white/40">STRK</span>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-white/45">
          Read through your wallet, which holds the viewing key. molfi never sees one, so it
          can only show what the wallet is willing to tell it.
        </p>
      </div>

      <div className="mt-3 rounded-2xl bg-[#161616] p-4">
        <label className="label" htmlFor="pool-amount">
          Amount
        </label>
        <input
          id="pool-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="tnum mt-2 w-full rounded-xl bg-black px-3 py-3 text-[20px] outline-none"
        />

        <button
          onClick={() => void run(() => onShield(parsed!))}
          disabled={disabled}
          className="mt-3 w-full rounded-xl bg-amber py-3 text-[14px] font-bold text-black disabled:opacity-40"
        >
          ↓ SHIELD INTO THE POOL
        </button>
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          A public transfer. Anyone watching sees this address funding the pool, and the
          amount. What they cannot see is anything you do afterwards.
        </p>

        <label className="label mt-4 block" htmlFor="pool-to">
          Withdraw to
        </label>
        <input
          id="pool-to"
          placeholder="0x… public Starknet address"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="mono mt-2 w-full rounded-xl bg-black px-3 py-3 text-[12px] outline-none"
        />
        <button
          onClick={() => void run(() => onUnshield(parsed!, to))}
          disabled={disabled || !/^0x[0-9a-fA-F]{1,64}$/.test(to)}
          className="mt-3 w-full rounded-xl bg-[#242424] py-3 text-[14px] font-bold disabled:opacity-40"
        >
          ↑ WITHDRAW TO A PUBLIC ADDRESS
        </button>
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          Public again, and by design. Withdrawing straight back to the address you shielded
          from links the two ends together; a fresh address does not.
        </p>

        {note ? <p className="mono mt-3 text-[11px] text-amber">{note}</p> : null}
      </div>

      <Positions positions={positions} pending={pending} onClaim={onClaim} />
    </div>
  );
}

/**
 * The positions this browser is holding, and how to keep them.
 *
 * Every one is listed with a way to export it, because the export is the record and this
 * list is only a convenience on top of it. Clearing site data without the files is how a
 * payout becomes unreachable.
 */
function Positions({
  positions,
  pending,
  onClaim,
}: {
  positions: LivePosition[];
  pending: string | null;
  onClaim: (p: LivePosition) => Promise<string>;
}) {
  const [importError, setImportError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    try {
      importPosition(await file.text());
    } catch (e) {
      setImportError(String((e as Error).message));
    }
  };

  return (
    <div className="mt-3 rounded-2xl bg-[#161616] p-4">
      <div className="flex items-center justify-between">
        <span className="label">Your positions</span>
        <label className="cursor-pointer rounded-lg bg-[#242424] px-3 py-1.5 text-[11px] font-semibold">
          IMPORT
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
      </div>

      {importError ? (
        <p className="mono mt-2 text-[11px] text-red">{importError}</p>
      ) : null}

      {positions.length === 0 ? (
        <p className="mt-3 text-[13px] leading-relaxed text-white/45">
          Nothing here yet. A position is stored in this browser and in the file you download
          when you open it — the chain records only a hash, and cannot tell anyone, including
          you, which positions are yours.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {positions.map((p) => (
            <li key={p.commitment} className="rounded-xl bg-black p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[14px] font-semibold">{p.pair}</span>
                <Verdict p={p} />
              </div>
              <p className="mono mt-1 text-[10px] leading-relaxed tracking-wide text-white/35">
                {/* Enough decimals to tell the two edges apart. A market's display
                    precision is chosen for reading a price, not a band, and the tightest
                    bands are narrower than it — a receipt whose two numbers are the same
                    number is not a receipt. */}
                {fmtPrice(p.bandLow, bandDp(p))} – {fmtPrice(p.bandHigh, bandDp(p))} ·{" "}
                {fmtStrk(BigInt(p.stake), 2)} STRK
                {p.onChain?.exists
                  ? ` · pays ${fmtMultiplier(p.onChain.multiplierBps)}`
                  : p.onChain
                    ? " · not found on chain"
                    : " · unread"}
              </p>
              <p className="mono mt-0.5 text-[10px] tracking-wide text-white/25">
                {p.commitment.slice(0, 18)}…
                {p.market && !p.market.isSettled
                  ? ` · settles in ${fmtCountdown(Math.max(0, p.market.cutoffAt - Math.floor(Date.now() / 1000)))}`
                  : ""}
              </p>

              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => exportPosition(p, { contract: ADDRESSES.market })}
                  className="flex-1 rounded-lg bg-[#242424] py-2 text-[11px] font-semibold"
                >
                  EXPORT
                </button>
                {p.won === true && !p.claimedTxHash ? (
                  <button
                    onClick={() => void onClaim(p)}
                    disabled={Boolean(pending)}
                    className="flex-1 rounded-lg bg-green py-2 text-[11px] font-bold text-black disabled:opacity-40"
                  >
                    CLAIM
                  </button>
                ) : null}
                {p.claimedTxHash || p.won === false ? (
                  <button
                    onClick={() => forget(p.commitment)}
                    title="Removes it from this browser. Export first if you want to keep the record."
                    className="rounded-lg bg-[#242424] px-3 py-2 text-[11px] text-white/50"
                  >
                    ✕
                  </button>
                ) : null}
              </div>

              {p.claimedTxHash ? (
                <p className="mono mt-2 text-[10px] text-white/35">
                  claimed{" "}
                  {explorerTx(p.claimedTxHash) ? (
                    <a
                      href={explorerTx(p.claimedTxHash)!}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-amber underline"
                    >
                      {p.claimedTxHash.slice(0, 14)}…
                    </a>
                  ) : (
                    p.claimedTxHash.slice(0, 14)
                  )}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Enough decimals that a band's two edges are visibly different numbers. */
function bandDp(p: LivePosition): number {
  const base = MARKETS.find((m) => m.label === p.pair)?.dp ?? 2;
  for (let d = base; d <= 8; d += 1) {
    if (fmtPrice(p.bandLow, d) !== fmtPrice(p.bandHigh, d)) return d;
  }
  return 8;
}

/** Where a position stands, in one word, without guessing at anything unread. */
function Verdict({ p }: { p: LivePosition }) {
  if (p.claimedTxHash) return <span className="mono text-[10px] text-white/40">CLAIMED</span>;
  if (!p.market) return <span className="mono text-[10px] text-white/40">UNKNOWN MARKET</span>;
  if (!p.market.isSettled) return <span className="mono text-[10px] text-amber">OPEN</span>;
  if (p.won === true) return <span className="mono text-[10px] text-green">WON</span>;
  if (p.won === false) return <span className="mono text-[10px] text-red">MISSED</span>;
  return <span className="mono text-[10px] text-white/40">SETTLED</span>;
}
