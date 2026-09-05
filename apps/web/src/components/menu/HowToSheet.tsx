"use client";

import type { CalibratedRound } from "@molfi/sdk";
import { Sheet } from "./Sheet";

export function HowToBody() {
  const steps = [
    ["Pick a band", "Drag the two amber rules on the screen. Tighter pays more."],
    ["Hit the red key", "Your stake is locked and the band projects out to the cutoff."],
    ["Stack if you like", "Every stack is a fresh ticket on the same band, priced right then."],
    ["The cutoff hits", "If the price prints inside your band, you get paid the multiplier."],
  ];

  return (
    <div className="space-y-3 pb-4">
      {steps.map(([h, p], i) => (
        <div key={h} className="flex gap-3 rounded-2xl bg-[#141414] p-4">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber text-[13px] font-bold text-black">
            {i + 1}
          </span>
          <div>
            <div className="text-[15px] font-bold">{h}</div>
            <p className="mt-0.5 text-[13px] leading-relaxed text-white/55">{p}</p>
          </div>
        </div>
      ))}

      <div className="rounded-2xl bg-[#141414] p-4">
        <div className="label">The multiplier</div>
        <p className="mt-1 text-[13px] leading-relaxed text-white/55">
          It is <span className="text-white">1 ÷ chance</span>, less a 4% fee. The chance
          comes from a distribution measured on real market tape for each round length —
          not a curve we assumed. Over a three-second round the price often does not move
          at all, and pricing that off a bell curve would be wrong in the house&apos;s
          favour.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-white/55">
          <span className="text-white">The 4% fee is not the whole spread.</span> Volatility
          moves faster than any fixed calibration, so the chance quoted is not the middle of
          what the market has recently done — it is the high end of it, taken across many
          recent windows. Quoting a chance at or above the real one is what keeps the vault
          solvent when the regime changes, and it costs real money: replayed across four
          separate stretches of held-out tape the effective edge ran from about 3% to about
          42%, depending far more on how volatile that stretch happened to be than on the
          round length. It is always in the house&apos;s favour. It is also why no win
          percentage is printed on the deck — the model&apos;s number is a pricing input,
          not a forecast.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-white/55">
          The keeper re-marks volatility on-chain as it moves, which narrows that spread
          toward the fee.
        </p>
      </div>

      <div className="rounded-2xl bg-[#141414] p-4">
        <div className="label">The cutoff</div>
        <p className="mt-1 text-[13px] leading-relaxed text-white/55">
          A block number, not a clock. Monad produces a block about every 300ms, so a
          ten-block round is roughly three seconds.
        </p>
      </div>
    </div>
  );
}

export function HowToSheet({
  onClose,
}: {
  onClose: () => void;
  round?: CalibratedRound;
}) {
  return (
    <Sheet onClose={onClose} title="How it works">
      <HowToBody />
    </Sheet>
  );
}
