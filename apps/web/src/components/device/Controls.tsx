"use client";
import { CoinMark } from "@/components/CoinMark";

/** Small raised key on the shell. Follows the cabinet's colourway. */
export function RailKey({
  children,
  onClick,
  active,
  title,
  label,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={label ?? title}
      className={`key grid h-8 w-[46px] shrink-0 place-items-center rounded-[10px] text-[13px] ${
        active ? "bg-[var(--color-cap-hi)]" : "bg-[var(--color-cap)]"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Output level, on the shell's bottom rail beside the key that mutes it.
 *
 * One scale drives the fill and the cap or the thumb drifts from the pointer: the fill is
 * `level%` wide, the cap sits at `level% − 7.5px` (half its own width), and a click reads
 * back as `(clientX − left) / width`. Three numbers, one source.
 */
export function VolumeRail({
  level,
  onChange,
}: {
  level: number;
  onChange: (v: number) => void;
}) {
  const pct = `${Math.max(0, Math.min(1, level)) * 100}%`;

  const pick = (e: React.PointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onChange(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  };

  return (
    <button
      onPointerDown={pick}
      onPointerMove={(e) => {
        if (e.buttons === 1) pick(e);
      }}
      title="volume"
      aria-label="Volume"
      className="relative h-8 flex-1 overflow-hidden rounded-[10px]"
      style={{
        background: "linear-gradient(180deg,#1c1f24,#14161a)",
        boxShadow: "inset 0 2px 6px rgba(0,0,0,.8), inset 0 0 0 1px rgba(255,255,255,.05)",
      }}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0"
        style={{
          width: pct,
          background: "linear-gradient(180deg,#f2564c,#d8382c)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,.35), 2px 0 6px rgba(0,0,0,.35)",
        }}
      />
      {/* The thumb, hidden at silence — at zero it would hang half outside the track and
          read as a control stuck against its own end stop. */}
      <span
        aria-hidden
        className="absolute inset-y-0 w-[15px]"
        hidden={level <= 0}
        style={{
          left: `calc(${pct} - 7.5px)`,
          background: "linear-gradient(180deg,#ffc247,#f0940c)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,.5), 0 0 6px rgba(0,0,0,.45)",
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center gap-[3px]"
      >
        {Array.from({ length: 3 }, (_, i) => (
          <span key={i} className="h-[13px] w-[2px] rounded bg-white/70" />
        ))}
      </span>
    </button>
  );
}

/**
 * The primary key. 96 square, in its own recessed frame.
 *
 * Bottom-right of the deck, always: it is the one control a thumb has to find without
 * looking, and moving it costs more than any layout it would improve.
 */
export function FireKey({
  onClick,
  disabled,
  armed,
}: {
  onClick: () => void;
  disabled?: boolean;
  armed?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label="Fire"
      className="key key-red relative grid h-24 w-24 place-items-center rounded-xl disabled:opacity-45"
    >
      <Mark size={54} />
      {armed ? (
        <span className="absolute inset-0 rounded-xl ring-2 ring-white/85" aria-hidden />
      ) : null}
    </button>
  );
}

/**
 * The mark: the band rotated, with the price sealed at its centre.
 *
 * Never a filter, never a gradient, never a second colour — it takes the colour of whatever
 * it is drawn on, which is why one file serves the red key, the tab icon and the wordmark's
 * ground alike.
 */
export function Mark({ size = 54, tone = "rgba(255,255,255,0.95)" }: { size?: number; tone?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <path
        d="M32 8 L56 32 L32 56 L8 32 Z"
        fill="none"
        stroke={tone}
        strokeWidth="9"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="32" r="6" fill={tone} />
    </svg>
  );
}

/**
 * Any hole cut in the deck: the frame a key or the knob sits in.
 *
 * Exported because more than one key can share one frame — two utility keys side by side
 * read as a pair of related destinations, where two separate frames read as two unrelated
 * ones and cost a row of chassis to say it.
 */
export function KeyFrame({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rounded-2xl p-[7px] ${className}`}
      style={{
        background: "var(--color-frame)",
        boxShadow:
          "inset 0 2px 6px rgba(0,0,0,.85), inset 0 0 0 1px rgba(255,255,255,.05), 0 1px 0 rgba(255,255,255,.07)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Glossy blue utility key.
 *
 * The count badge is hidden at zero rather than printing "0" — a badge exists to say there
 * is something behind the key, and one reading zero says the opposite while still drawing
 * the eye.
 */
export function BlueKey({
  label,
  count,
  onClick,
}: {
  label: string;
  count?: number;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="key key-blue relative flex h-11 w-full min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden rounded-xl px-2"
    >
      <span
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "repeating-linear-gradient(90deg,rgba(255,255,255,.13) 0 1px,transparent 1px 4px)",
        }}
      />
      <span
        className="mono relative truncate text-[12px] font-semibold tracking-[0.1em] text-white"
        style={{ textShadow: "0 1px 2px rgba(0,0,0,.45)" }}
      >
        {label}
      </span>
      {count && count > 0 ? (
        <span className="tnum relative grid h-5 min-w-[22px] place-items-center rounded-md bg-black/35 px-1.5 text-[10px] font-semibold text-white">
          {count}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The market switcher, as a chip beside the price it changes.
 *
 * It was a 92px deck key for one tap a session. Next to the price it costs nothing and reads
 * as what it is — a label on the number, which happens to be pressable.
 */
export function MarketChip({
  symbol,
  tone,
  onClick,
}: {
  symbol: string;
  /**
   * Kept for the chart and the band, which tint themselves per market. The chip itself draws
   * the project's own mark now — a coloured disc identifies nothing, and BTC and ETH have had
   * the same two shapes for a decade.
   */
  tone: string;
  onClick?: () => void;
}) {
  void tone;
  return (
    <button
      onClick={onClick}
      title="tap to switch market"
      aria-label="Change market"
      className="key flex items-center gap-1.5 rounded-full bg-[#141414] py-[3px] pl-[3px] pr-2"
      style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,.07)" }}
    >
      <CoinMark coin={symbol} size={19} />
      <span className="mono text-[9.5px] tracking-[0.15em] text-white">{symbol}</span>
      <span className="text-[8px] text-dim" aria-hidden>
        ▾
      </span>
    </button>
  );
}

/** Pill at the bottom of the deck, with its printed legend underneath. */
export function DeckKey({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={onClick}
        aria-label={label}
        className="key h-[26px] w-[62px] rounded-full"
        style={{
          background: "linear-gradient(180deg,var(--color-cap-hi),var(--color-cap))",
        }}
      />
      <span
        className="mono text-[8.5px] tracking-[0.18em]"
        style={{ color: "var(--color-ink)" }}
      >
        {label}
      </span>
    </div>
  );
}
