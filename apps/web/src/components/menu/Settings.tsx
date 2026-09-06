"use client";

import { MARKETS, ROUND_SECONDS, roundLabel } from "@molfi/sdk";
import { usePrefs, usePrefersReducedMotion, type Prefs } from "@/lib/usePrefs";

/**
 * Settings that change something.
 *
 * Every control here is wired to behaviour the player can immediately observe. A
 * switch that only writes to storage is decoration, and a settings screen full of them
 * teaches people not to trust the rest of the interface.
 */
export function Settings({ onSound }: { onSound?: (on: boolean) => void }) {
  const { prefs, set, reset } = usePrefs();
  const osReduced = usePrefersReducedMotion();

  return (
    <div className="space-y-3 pb-6">
      <Group title="Console">
        <Toggle
          label="Sound"
          hint="Synthesised on the fly — no audio files to load."
          value={prefs.sound}
          onChange={(v) => {
            set("sound", v);
            onSound?.(v);
          }}
        />
        <Toggle
          label="Reduced motion"
          hint={
            osReduced
              ? "Your system already asks for reduced motion, which is honoured regardless."
              : "Stops the console tilting and the band burning down."
          }
          value={prefs.reducedMotion || osReduced}
          disabled={osReduced}
          onChange={(v) => set("reducedMotion", v)}
        />
        {/*
          * There was a "Show the oracle strip" switch here, and it is gone rather than
          * fixed.
          *
          * Nothing read it — the strip has been on the glass unconditionally since the
          * console was rebuilt — so it was a switch that did nothing, which this screen's
          * own premise forbids. Wiring it back up would be worse: a stale print does not
          * settle one position wrongly, it settles every position in that market wrongly at
          * once, and that is not a fact a reader should be able to switch off.
          */}
      </Group>

      <Group title="Desk defaults">
        <Choice
          label="Market"
          value={prefs.market}
          options={MARKETS.map((m) => ({ value: m.key, label: m.symbol }))}
          onChange={(v) => set("market", v)}
        />
        <Choice
          label="Round"
          value={String(prefs.tier)}
          options={ROUND_SECONDS.map((_: number, i: number) => ({ value: String(i), label: roundLabel(i) }))}
          onChange={(v) => set("tier", Number(v) as Prefs["tier"])}
        />
      </Group>

      <button
        onClick={reset}
        className="mt-2 w-full rounded-xl bg-[#1e1e1e] py-3 text-[13px] font-semibold text-white/70 transition-colors hover:bg-[#262626]"
      >
        Restore defaults
      </button>

      <p className="px-1 pt-1 text-[11px] leading-relaxed text-white/35">
        Preferences live in this browser only. Nothing here is sent anywhere, and
        clearing site data resets them.
      </p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-[#141414] p-4">
      <div className="label">{title}</div>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className={`text-[14px] font-medium ${disabled ? "text-white/40" : "text-white"}`}>
          {label}
        </div>
        {hint ? <p className="mt-0.5 text-[11px] leading-relaxed text-white/40">{hint}</p> : null}
      </div>
      <button
        role="switch"
        aria-checked={value}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`relative mt-0.5 h-[26px] w-[46px] shrink-0 rounded-full transition-colors ${
          value ? "bg-green-2" : "bg-[#2a2a2a]"
        } ${disabled ? "opacity-50" : ""}`}
      >
        <span
          className="absolute left-[3px] top-[3px] h-5 w-5 rounded-full bg-white transition-transform duration-200 ease-out"
          style={{ transform: `translateX(${value ? 20 : 0}px)` }}
        />
      </button>
    </div>
  );
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="text-[14px] font-medium text-white">{label}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`mono rounded-lg px-2.5 py-1.5 text-[11px] tracking-wide transition-colors ${
              o.value === value
                ? "bg-amber text-black"
                : "bg-[#1e1e1e] text-white/60 hover:bg-[#262626]"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
