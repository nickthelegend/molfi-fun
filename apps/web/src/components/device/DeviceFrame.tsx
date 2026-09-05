"use client";

import { RailKey, StakeRail } from "./Controls";

/**
 * The console body. Everything in XORR happens inside this frame, on any screen size:
 * the device is the app, not a decoration around a web page.
 */
export function DeviceFrame({
  children,
  stakeStep,
  maxStake,
  onStakeStep,
  soundOn,
  onToggleSound,
  running,
  onToggleRunning,
}: {
  children: React.ReactNode;
  stakeStep: number;
  maxStake: number;
  onStakeStep: (v: number) => void;
  soundOn: boolean;
  onToggleSound: () => void;
  running: boolean;
  onToggleRunning: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[420px] px-3 py-4">
      <div className="shell rounded-[28px] p-3">
        {/* top rail */}
        <div className="mb-3 flex items-center gap-2">
          <RailKey onClick={onToggleSound} active={soundOn} title="sound">
            <span className={soundOn ? "" : "opacity-40"}>♪</span>
          </RailKey>
          <RailKey onClick={onToggleRunning} title={running ? "pause" : "run"}>
            <span className="text-[#e8453c]">{running ? "❚❚" : "▶"}</span>
          </RailKey>
          <StakeRail value={stakeStep} max={maxStake} onChange={onStakeStep} />
        </div>

        {children}
      </div>
    </div>
  );
}
