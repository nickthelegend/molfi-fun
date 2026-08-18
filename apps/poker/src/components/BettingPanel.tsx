import { useState, useMemo, useEffect } from 'react';
import { potOdds, formatPotOdds, clampRaise } from '../game/betting';

interface Props {
  options: ('fold' | 'check' | 'call' | 'raise')[];
  currentBet: bigint;
  myBet: bigint;
  myStack: bigint;
  pot: bigint;
  bigBlind: bigint;
  onFold: () => void;
  onCheck: () => void;
  onCall: () => void;
  onRaise: (amount: bigint) => void;
  disabled: boolean;
}

function fmtChips(n: bigint) {
  if (n >= 10000n) return `${Math.round(Number(n) / 1000)}k`;
  if (n >= 1000n)  return `${(Number(n) / 1000).toFixed(Number(n % 1000n) === 0 ? 0 : 1)}k`;
  return n.toString();
}

export function BettingPanel({
  options,
  currentBet,
  myBet,
  myStack,
  pot,
  bigBlind,
  onFold,
  onCheck,
  onCall,
  onRaise,
  disabled,
}: Props) {
  const callAmount = currentBet - myBet;
  const totalStack = myStack + myBet;
  const minRaise = currentBet + bigBlind;
  const maxRaise = totalStack;

  const presets = useMemo(() => {
    const clamp = (v: bigint) => {
      if (v < minRaise) return minRaise;
      if (v > maxRaise) return maxRaise;
      return v;
    };

    const totalPot = pot + callAmount;
    const items: { label: string; amount: bigint }[] = [];

    const threeBB = currentBet + bigBlind * 3n;
    if (threeBB <= maxRaise) {
      items.push({ label: '3 BB', amount: clamp(threeBB) });
    }

    const halfPot = currentBet + totalPot / 2n;
    if (halfPot > (items[items.length - 1]?.amount ?? 0n) && halfPot <= maxRaise) {
      items.push({ label: '1/2 Pot', amount: clamp(halfPot) });
    }

    const potBet = currentBet + totalPot;
    if (potBet > (items[items.length - 1]?.amount ?? 0n) && potBet <= maxRaise) {
      items.push({ label: 'Pot', amount: clamp(potBet) });
    }

    if (maxRaise > (items[items.length - 1]?.amount ?? 0n)) {
      items.push({ label: 'All In', amount: maxRaise });
    }

    return items;
  }, [currentBet, bigBlind, pot, callAmount, minRaise, maxRaise]);

  const [raiseAmount, setRaiseAmount] = useState<bigint>(minRaise);

  const canRaise = options.includes('raise') && maxRaise >= minRaise;

  const sliderMin = Number(minRaise);
  const sliderMax = Number(maxRaise);
  const sliderVal = Number(raiseAmount < minRaise ? minRaise : raiseAmount > maxRaise ? maxRaise : raiseAmount);

  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRaiseAmount(BigInt(e.target.value));
  };

  const handlePreset = (amount: bigint) => {
    setRaiseAmount(amount);
  };

  const handleRaise = () => {
    onRaise(clampRaise(raiseAmount, minRaise, maxRaise));
  };

  /**
   * Pot odds, computed rather than quoted.
   *
   * The share of the final pot this call represents, which is also the equity the hand needs
   * to break even. It is the one number that turns a set of buttons into a decision, and it
   * is arithmetic the player would otherwise be doing in their head against a clock.
   *
   * The maths lives in game/betting.ts so it can be tested without rendering anything.
   */
  const odds = useMemo(() => potOdds(callAmount, pot), [callAmount, pot]);

  /**
   * Keyboard play.
   *
   * Poker is played against a clock and a player who has to find a button with a mouse every
   * street is playing a different game from one who does not. F, C and R are the bindings
   * every online room has used for twenty years, so they need no teaching, and the legend
   * under the buttons covers the case where they do.
   *
   * Bindings are dropped entirely while the panel is disabled or while a text field has
   * focus, so typing a game id into a box never folds a hand.
   */
  useEffect(() => {
    if (disabled) return;

    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === 'f' && options.includes('fold')) {
        event.preventDefault();
        onFold();
      } else if (key === 'c') {
        if (options.includes('check')) {
          event.preventDefault();
          onCheck();
        } else if (options.includes('call')) {
          event.preventDefault();
          onCall();
        }
      } else if (key === 'r' && canRaise) {
        event.preventDefault();
        handleRaise();
      } else if (key >= '1' && key <= '9' && canRaise) {
        const preset = presets[Number(key) - 1];
        if (preset) {
          event.preventDefault();
          handlePreset(preset.amount);
        }
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disabled, options, canRaise, presets, onFold, onCheck, onCall, raiseAmount, minRaise, maxRaise]);


  return (
    <div className="flex flex-col gap-2">
      {/* Info bar: Stack + Pot + Blinds */}
      <div className="flex items-center justify-center gap-6 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-white/30 uppercase tracking-wider text-[10px]">Stack</span>
          <span className="text-white font-mono tabular-nums font-semibold">{fmtChips(myStack)}</span>
        </div>
        <div className="w-px h-3 bg-white/10" />
        <div className="flex items-center gap-1.5">
          <span className="text-white/30 uppercase tracking-wider text-[10px]">Pot</span>
          <span className="text-yellow-400 font-mono tabular-nums font-semibold">{fmtChips(pot)}</span>
        </div>
        <div className="w-px h-3 bg-white/10" />
        <div className="flex items-center gap-1.5">
          <span className="text-white/30 uppercase tracking-wider text-[10px]">Blinds</span>
          <span className="text-white/60 font-mono tabular-nums">{fmtChips(bigBlind / 2n)}/{fmtChips(bigBlind)}</span>
        </div>
        {odds !== null && (
          <>
            <div className="w-px h-3 bg-white/10" />
            <div
              className="flex items-center gap-1.5"
              title={`Calling ${callAmount} into a ${pot + callAmount} pot. You need ${formatPotOdds(odds)}% equity to break even.`}
            >
              <span className="text-white/30 uppercase tracking-wider text-[10px]">Pot odds</span>
              <span className="text-white/80 font-mono tabular-nums font-semibold">{formatPotOdds(odds)}%</span>
            </div>
          </>
        )}
      </div>

      {/* Action buttons row */}
      <div className="flex items-center justify-center gap-2">
        {/* Main actions */}
        {options.includes('fold') && (
          <button
            onClick={onFold}
            disabled={disabled}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold uppercase tracking-wide transition-all disabled:opacity-40
              border border-red-500/40 text-red-400 bg-red-950/30 hover:bg-red-900/40 active:scale-95"
          >
            Fold
          </button>
        )}
        {options.includes('check') && (
          <button
            onClick={onCheck}
            disabled={disabled}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold uppercase tracking-wide transition-all disabled:opacity-40
              border border-emerald-500/40 text-emerald-400 bg-emerald-950/30 hover:bg-emerald-900/40 active:scale-95"
          >
            Check
          </button>
        )}
        {options.includes('call') && (
          <button
            onClick={onCall}
            disabled={disabled}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold uppercase tracking-wide transition-all disabled:opacity-40
              border border-blue-500/40 text-blue-400 bg-blue-950/30 hover:bg-blue-900/40 active:scale-95"
          >
            Call <span className="font-mono tabular-nums ml-1">{fmtChips(callAmount)}</span>
          </button>
        )}

        {/* Raise section */}
        {canRaise && (
          <>
            <div className="w-px h-8 bg-white/10 mx-1" />

            {/* Presets */}
            {presets.map((p) => {
              const isActive = raiseAmount === p.amount;
              return (
                <button
                  key={p.label}
                  onClick={() => handlePreset(p.amount)}
                  disabled={disabled}
                  className={`px-3 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wide transition-all disabled:opacity-40 active:scale-95
                    ${isActive
                      ? 'border border-amber-400/70 text-amber-300 bg-amber-500/20'
                      : 'border border-white/10 text-white/50 bg-white/[0.03] hover:bg-white/[0.06] hover:text-white/70'
                    }`}
                >
                  {p.label}
                </button>
              );
            })}

            {/* Slider */}
            <input
              type="range"
              min={sliderMin}
              max={sliderMax}
              step={Number(bigBlind)}
              value={sliderVal}
              onChange={handleSlider}
              disabled={disabled}
              className="w-24 h-1.5 rounded-full appearance-none cursor-pointer disabled:opacity-40 accent-amber-500
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber-400 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-amber-600 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-pointer
                [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/10"
            />

            {/* Raise button */}
            <button
              onClick={handleRaise}
              disabled={disabled}
              className="px-5 py-2.5 rounded-xl text-sm font-bold uppercase tracking-wide transition-all disabled:opacity-40 active:scale-[0.98]
                bg-gradient-to-r from-amber-600 to-amber-500 text-black hover:from-amber-500 hover:to-amber-400 shadow-lg shadow-amber-900/30"
            >
              Raise <span className="font-mono tabular-nums">{fmtChips(raiseAmount)}</span>
            </button>
          </>
        )}
      </div>

      {/* Keyboard legend.

          A shortcut nobody knows about is not a feature. This sits under the buttons it
          describes, greys out with them, and lists only the keys that do something in the
          current spot rather than the full set. */}
      {!disabled && (
        <div className="flex items-center justify-center gap-3 text-[10px] text-white/25">
          {options.includes('fold') && <Key k="F" label="fold" />}
          {options.includes('check') && <Key k="C" label="check" />}
          {options.includes('call') && <Key k="C" label="call" />}
          {canRaise && <Key k="R" label="raise" />}
          {canRaise && presets.length > 0 && (
            <Key k={presets.length > 1 ? `1-${presets.length}` : '1'} label="preset" />
          )}
        </div>
      )}
    </div>
  );
}

/** One key cap in the legend. */
function Key({ k, label }: { k: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <kbd className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-white/60">
        {k}
      </kbd>
      <span className="uppercase tracking-wider">{label}</span>
    </span>
  );
}
