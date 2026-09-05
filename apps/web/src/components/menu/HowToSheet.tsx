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
          Each market carries the seventeen-knot table it was listed with, so the spread it
          charges can be recomputed by anyone from the published calibration — see the
          verify link on any market.
        </p>
      </div>

      <div className="rounded-2xl bg-[#141414] p-4">
        <div className="label">The cutoff</div>
        <p className="mt-1 text-[13px] leading-relaxed text-white/55">
          A time, not a block. What limits a round here is how often the oracle republishes:
          Pragma posts a new median every few minutes, so the shortest round molfi can settle
          honestly is fifteen minutes. A shorter one would resolve against a price that was
          already public when it opened.
        </p>
      </div>

      <div className="rounded-2xl bg-[#141414] p-4">
        <div className="label">What stays hidden</div>
        <p className="mt-1 text-[13px] leading-relaxed text-white/55">
          The contract stores a hash of your position — the secret, the market, and the two
          band edges — and the pool never tells it who called. So nobody can see which band
          you bought, how much you staked, or whether a settled position was yours.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-white/55">
          What is public: that a position was opened, in which market, and each market&apos;s
          total staked and paid. Those last two have to be, because conservation is only a
          promise if somebody can check it. Shielding into the pool and withdrawing out of it
          are public legs too — the privacy is in what happens between them.
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
