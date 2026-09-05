"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ADDRESSES, activeChain } from "@/lib/chain";
import { SwapMon } from "./SwapMon";

/**
 * Deposit screen. The QR is a real encoding of the real receiving address — a
 * decorative pattern that does not scan would be worse than no QR at all.
 */
export function AddFunds() {
  const [png, setPng] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // In demo mode there is no deposit address; show the vault so the screen is honest
  // about what it is pointing at.
  const address = ADDRESSES.vault ?? ADDRESSES.rangeMarket ?? null;

  useEffect(() => {
    if (!address) return;
    void QRCode.toDataURL(address, {
      width: 480,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
      errorCorrectionLevel: "M",
    }).then(setPng);
  }, [address]);

  return (
    <div className="pb-4">
      {/* Everyone arriving on Monad holds MON and nobody holds AUSD, so the swap comes
          before the deposit address. */}
      <SwapMon />

      <div className="mt-4 mb-3 flex items-center gap-3">
        <span className="h-px flex-1 bg-white/10" />
        <span className="label">or send AUSD</span>
        <span className="h-px flex-1 bg-white/10" />
      </div>

      {/* No chevrons here. The market settles in AUSD on one chain, so a control that
          looks like a dropdown would be offering a choice that does not exist. */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="label">Currency</div>
          <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-[#161616] px-3 py-3">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-blue text-[11px] font-bold">
              A
            </span>
            <span className="flex-1 text-[14px] font-semibold">AUSD</span>
          </div>
        </div>
        <div>
          <div className="label">Network</div>
          <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-[#161616] px-3 py-3">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-purple text-[11px] font-bold">
              M
            </span>
            <span className="flex-1 truncate text-[14px] font-semibold">{activeChain.name}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex gap-3 rounded-xl bg-[#2a2010] px-4 py-3">
        <span className="text-[16px]">⚠</span>
        <p className="text-[12px] leading-relaxed text-amber">
          Send only <span className="font-bold">AUSD</span> on{" "}
          <span className="font-bold">{activeChain.name}</span> to this address. Anything
          else is lost.
        </p>
      </div>

      {address ? (
        <div className="mt-3 rounded-2xl bg-amber p-4">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-extrabold tracking-tight text-black">XORR</span>
            <span className="mono text-[10px] font-bold tracking-[0.12em] text-black/70">
              DEPOSIT AUSD
            </span>
          </div>

          <div className="mt-3 rounded-xl bg-[#1a1508] p-4">
            <div className="mx-auto grid aspect-square w-full max-w-[220px] place-items-center rounded-lg bg-white p-2">
              {png ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={png} alt="deposit address QR" className="h-full w-full" />
              ) : (
                <span className="mono text-[10px] text-black/40">encoding…</span>
              )}
            </div>
            <p className="mono mt-3 text-center text-[10px] tracking-[0.14em] text-white/50">
              SCAN TO SEND
            </p>
          </div>

          <button
            onClick={() => {
              void navigator.clipboard?.writeText(address);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
            className="mono mt-3 w-full break-all rounded-lg bg-black/15 px-3 py-2 text-[10px] leading-relaxed text-black/80"
          >
            {copied ? "COPIED" : address}
          </button>

          <p className="mt-2 text-center text-[11px] text-black/55">Minimum $3 recommended</p>
        </div>
      ) : (
        <div className="mt-3 rounded-2xl bg-[#141414] p-6 text-center">
          <p className="text-[14px] text-white/60">
            You are on the demo desk — the balance is paper and there is nothing to fund.
          </p>
          <p className="mt-2 text-[12px] text-white/35">
            Deploy the contracts and set NEXT_PUBLIC_VAULT to take real deposits.
          </p>
        </div>
      )}
    </div>
  );
}
