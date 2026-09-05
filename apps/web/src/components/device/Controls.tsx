"use client";

/** Small raised key on the shell's top rail. Follows the cabinet's colourway. */
export function RailKey({
  children,
  onClick,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`key grid h-8 w-10 place-items-center rounded-lg text-[13px] ${
        active ? "bg-[var(--color-cap-hi)]" : "bg-[var(--color-cap)]"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Stake slider dressed as a hardware volume rail — the red fill is how much of the
 * max stake is dialled in.
 */
export function StakeRail({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <button
      onClick={() => onChange(value >= max ? 1 : value + 1)}
      title="stake"
      // The only control on the shell with no text and no icon to read. Announce the
      // value, not just the name — "stake" alone tells a screen reader nothing about
      // where the rail is set, and the rail IS the value.
      aria-label={`Stake, step ${value} of ${max}`}
      role="button"
      className="key relative h-8 flex-1 overflow-hidden rounded-lg bg-[var(--color-cap)]"
    >
      <div
        className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#e8453c] to-[#ff7a2f]"
        style={{ width: `${pct * 100}%` }}
      />
      <div className="absolute inset-y-0 right-0 flex items-center gap-[3px] pr-2">
        {Array.from({ length: 3 }, (_, i) => (
          <span key={i} className="h-3 w-[2px] rounded bg-white/70" />
        ))}
      </div>
    </button>
  );
}

/** The big red fire key. */
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
      className="key relative grid aspect-square w-[104px] place-items-center rounded-2xl disabled:opacity-45"
      style={{
        background: disabled
          ? "linear-gradient(180deg,#8c3b36,#6f2d29)"
          : "linear-gradient(180deg,#f2564c,#c8362e)",
      }}
    >
      {/* Domino face: two pips over a bar, the XORR mark. */}
      <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
        <rect x="6" y="4" width="32" height="36" rx="8" fill="rgba(0,0,0,0.22)" />
        <rect x="12" y="12" width="8" height="8" rx="2.5" fill="rgba(255,255,255,0.9)" />
        <rect x="24" y="12" width="8" height="8" rx="2.5" fill="rgba(255,255,255,0.9)" />
        <rect x="12" y="26" width="20" height="5" rx="2.5" fill="rgba(255,255,255,0.9)" />
      </svg>
      {armed ? (
        <span className="absolute inset-0 rounded-2xl ring-2 ring-white/70" aria-hidden />
      ) : null}
    </button>
  );
}

/** Glossy blue utility key. */
export function BlueKey({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="key grid h-[92px] flex-1 place-items-center rounded-xl text-[13px] font-semibold tracking-wide text-white"
      style={{ background: "linear-gradient(180deg,#7cb3f0,#3f7fd0)" }}
    >
      {children}
    </button>
  );
}

/** Market select key: a coin in a black frame. */
export function CoinKey({
  symbol,
  onClick,
  tone = "#f7931a",
}: {
  symbol: string;
  onClick?: () => void;
  tone?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="key grid h-[92px] flex-1 place-items-center rounded-xl bg-[#0d0d0d] p-2"
    >
      <span
        className="grid h-14 w-14 place-items-center rounded-full text-[13px] font-bold text-white"
        style={{
          background: `radial-gradient(circle at 32% 28%, ${tone}, rgba(0,0,0,0.55))`,
          boxShadow: "inset 0 -2px 6px rgba(0,0,0,0.5)",
        }}
      >
        {symbol}
      </span>
    </button>
  );
}

/**
 * Stack of coins on the right of the deck — the balance, physically. Capped at six so
 * a healthy balance cannot grow the stack past the height of the keys beside it.
 */
export function CoinStack({ count }: { count: number }) {
  const n = Math.max(1, Math.min(6, count));
  return (
    <div className="flex w-[58px] flex-col-reverse items-center justify-start gap-[3px] self-end pb-1">
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className="coin-drop h-[11px] w-full rounded-[4px]"
          style={{
            background: "linear-gradient(180deg,#ffd84d 0%,#f5c518 45%,#d19a00 100%)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7), 0 1px 0 rgba(0,0,0,0.25)",
            animationDelay: `${i * 40}ms`,
          }}
        />
      ))}
    </div>
  );
}

/** Pill at the bottom of the deck, with its label underneath. Follows the colourway. */
export function DeckKey({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={onClick}
        aria-label={label}
        className="key h-7 w-[74px] rounded-full"
        style={{
          background:
            "linear-gradient(180deg,var(--color-cap-hi),var(--color-cap))",
        }}
      />
      {/* Ink is themed too: black legend on a charcoal body would be unreadable. */}
      <span
        className="mono text-[9px] tracking-[0.16em]"
        style={{ color: "var(--color-ink)" }}
      >
        {label}
      </span>
    </div>
  );
}
