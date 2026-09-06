"use client";

import { RailKey, VolumeRail } from "./Controls";

/**
 * The console body. Everything in molfi happens inside this chassis, on any screen size:
 * the device is the app, not a decoration around a web page.
 *
 * Three surfaces, nested, and the nesting is the point — chassis → recess → black glass,
 * radii 32 → 22 → 15. The glass used to sit straight on the body, which reads as a dark box
 * on a slightly less dark box; a bezel between them is most of what makes it hardware.
 *
 * The deck and the footer are passed in rather than composed here because their contents
 * differ between the paper desk and the live one, while the body they sit in must not.
 */
export function DeviceFrame({
  glass,
  deck,
  footer,
  soundOn,
  onToggleSound,
  volume,
  onVolume,
}: {
  glass: React.ReactNode;
  deck: React.ReactNode;
  footer?: React.ReactNode;
  soundOn: boolean;
  onToggleSound: () => void;
  volume: number;
  onVolume: (v: number) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[414px] px-3 py-4">
      <div className="shell rounded-[32px] p-[10px]">
        {/* bezel → glass */}
        <div className="recess rounded-[22px] p-[9px]">{glass}</div>

        {deck}

        {footer}

        {/*
          * Sound, next to the level it controls.
          *
          * There is no transport key beside it any more. A pause button implied the market
          * stops when the console is not being watched, which is the opposite of the claim
          * the rest of the device makes.
          */}
        <div className="mt-[11px] flex items-center gap-2 px-[3px] pb-[2px]">
          <RailKey
            onClick={onToggleSound}
            active={soundOn}
            title={soundOn ? "mute" : "unmute"}
            label={soundOn ? "Mute sound" : "Unmute sound"}
          >
            <span style={{ color: soundOn ? "#fff" : "rgba(255,255,255,.32)" }}>♪</span>
          </RailKey>
          <VolumeRail level={soundOn ? volume : 0} onChange={onVolume} />
          <span
            className="mono tnum min-w-[34px] shrink-0 text-right text-[9.5px] tracking-[0.1em]"
            style={{ color: "var(--color-ink)" }}
          >
            {soundOn ? Math.round(volume * 100) : "MUTE"}
          </span>
        </div>
      </div>
    </div>
  );
}
