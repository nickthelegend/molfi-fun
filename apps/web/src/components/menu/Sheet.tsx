"use client";

import { useEffect } from "react";
import { SheetBoundary } from "./SheetBoundary";

/**
 * The console's bottom sheet. Slides over the device rather than navigating away, so
 * the round keeps running underneath while you look at the leaderboard.
 */
export function Sheet({
  children,
  onClose,
  title,
  onBack,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title?: string;
  onBack?: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal>
      <button
        aria-label="close"
        onClick={onClose}
        className="scrim-in absolute inset-0 bg-black/55 backdrop-blur-[3px]"
      />
      <div className="sheet-up relative flex max-h-[88dvh] w-full max-w-[420px] flex-col rounded-t-[22px] bg-black">
        <div className="flex justify-center pb-1 pt-2">
          <span className="h-1 w-9 rounded-full bg-white/25" />
        </div>

        {title ? (
          <div className="flex items-center gap-3 px-5 pb-3 pt-2">
            {onBack ? (
              <button
                onClick={onBack}
                aria-label="back"
                className="grid h-9 w-9 place-items-center rounded-full bg-[#1a1a1a] text-white"
              >
                ‹
              </button>
            ) : null}
            <h2 className="text-[26px] font-bold leading-none">{title}</h2>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {/* Every screen goes through here, so one boundary covers all of them. */}
          <SheetBoundary title={title ?? "This screen"}>{children}</SheetBoundary>
        </div>
      </div>
    </div>
  );
}

export function Tile({
  icon,
  label,
  onClick,
  dim,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  dim?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl bg-[#161616] transition-colors hover:bg-[#1e1e1e] ${
        dim ? "opacity-45" : ""
      }`}
    >
      <span className="text-[30px] leading-none">{icon}</span>
      <span className="text-[12px] font-medium text-white/85">{label}</span>
    </button>
  );
}

export function Row({
  icon,
  label,
  onClick,
}: {
  icon?: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl bg-[#161616] px-4 py-4 text-left transition-colors hover:bg-[#1e1e1e]"
    >
      {icon ? <span className="text-[20px]">{icon}</span> : null}
      <span className="flex-1 text-[15px] font-semibold">{label}</span>
      <span className="text-white/35">›</span>
    </button>
  );
}
