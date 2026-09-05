"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { activeNetwork } from "@/lib/chain";

/**
 * Deposit screen. The QR is a real encoding of the real receiving address — a decorative
 * pattern that does not scan would be worse than no QR at all.
 *
 * The address is the user's own Starknet account, not a contract. STRK arrives there in
 * public, and shielding it into the pool is a separate, deliberate step in the Pool sheet —
 * conflating the two would hide the one moment where the amount and the funder are both
 * visible on chain.
 */
export function AddFunds({ address }: { address: string | null }) {
  const [png, setPng] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      {/* No chevrons here. molfi settles in STRK on one chain, so a control that looks
          like a dropdown would be offering a choice that does not exist. */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="label">Currency</div>
          <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-[#161616] px-3 py-3">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-blue text-[11px] font-bold">
              S
            </span>
            <span className="flex-1 text-[14px] font-semibold">STRK</span>
          </div>
        </div>
        <div>
          <div className="label">Network</div>
          <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-[#161616] px-3 py-3">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-purple text-[11px] font-bold">
              M
            </span>
            <span className="flex-1 truncate text-[14px] font-semibold">
              Starknet {activeNetwork.name}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex gap-3 rounded-xl bg-[#2a2010] px-4 py-3">
        <span className="text-[16px]">⚠</span>
        <p className="text-[12px] leading-relaxed text-amber">
          Send only <span className="font-bold">STRK</span> on{" "}
          <span className="font-bold">Starknet {activeNetwork.name}</span> to this address.
          Anything else is lost.
        </p>
      </div>

      {address ? (
        <div className="mt-3 rounded-2xl bg-amber p-4">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-extrabold tracking-tight text-black">molfi</span>
            <span className="mono text-[10px] font-bold tracking-[0.12em] text-black/70">
              YOUR ADDRESS
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

          <p className="mt-2 text-center text-[11px] text-black/55">
            Arrives in public. Shield it in the Pool sheet before opening a position.
          </p>
        </div>
      ) : (
        <div className="mt-3 rounded-2xl bg-[#141414] p-6 text-center">
          <p className="text-[14px] text-white/60">
            Connect a wallet and this shows your own receiving address.
          </p>
          <p className="mt-2 text-[12px] text-white/35">
            On the demo desk the balance is paper, and there is nothing to fund.
          </p>
        </div>
      )}
    </div>
  );
}
