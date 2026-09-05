"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MARKETS,
  ROUND_SECONDS,
  fmtMultiplier,
  fmtPrice,
  fmtUsd,
  DEFAULT_CONFIG,
  payoutFor,
  roundLabel,
  secondsLabel,
} from "@molfi/sdk";
import { usePaperDesk } from "@/lib/usePaperDesk";
import { useBand } from "@/lib/useBand";
import { usePrefs, useApplyTheme, usePrefersReducedMotion } from "@/lib/usePrefs";
import { useSound } from "@/lib/useSound";
import { DeviceFrame } from "./device/DeviceFrame";
import { RangeChart } from "./device/RangeChart";
import { BlueKey, CoinKey, CoinStack, DeckKey, FireKey } from "./device/Controls";
import { OracleStrip } from "./device/OracleStrip";
import { HouseBattery } from "./device/HouseBattery";
import { CutoffRing } from "./device/CutoffRing";
import { Odometer } from "@/components/device/Odometer";
import { BootSequence } from "@/components/device/BootSequence";
import { MenuSheet } from "./menu/MenuSheet";
import { HowToSheet } from "./menu/HowToSheet";
import { LiveConsole } from "./LiveConsole";
import { LIVE_CONFIGURED } from "@/lib/chain";

/** Stake ladder, in 6-decimal asset units. The contract accepts $1 to $10. */
const STAKE_STEPS = [1_000_000n, 1_500_000n, 2_000_000n, 3_000_000n, 5_000_000n, 10_000_000n];

/**
 * Stake as a share of what you actually hold, alongside the fixed rail.
 *
 * The rail is a hardware control with six detents and it should stay one — but a fixed
 * ladder means the same $1.50 whether the desk is at $250 or $12, and at $12 the sixth
 * detent is more than half the balance with nothing on screen saying so. The percentage
 * keys answer "how much of what I have" directly, which is the question the player is
 * actually asking, and they are clamped to the same floor the market enforces.
 */
const PERCENT_PRESETS = [5, 10, 25, 50] as const;

const COIN_TONE: Record<string, string> = {
  BTC: "#f7931a",
  ETH: "#8098ee",
  MON: "#836ef9",
};

export function PlayScreen() {
  const router = useRouter();
  const { prefs, set: setPref, loaded: prefsLoaded } = usePrefs();
  const osReduced = usePrefersReducedMotion();
  const reducedMotion = prefs.reducedMotion || osReduced;

  useApplyTheme(prefs.theme);

  const desk = usePaperDesk(prefs.market);
  const { state, setMarketKey, setTier, setRunning, fire, reset } = desk;
  const band = useBand(state.market, state.tier, state.spot);
  const play = useSound(prefs.sound);

  const [stakeStep, setStakeStep] = useState(2); // $1.5
  const [sheet, setSheet] = useState<null | "menu" | "howto">(null);
  const [live, setLive] = useState(false);
  const [flash, setFlash] = useState<null | { kind: "won" | "lost"; text: string }>(null);
  /**
   * Whether the screen is mid-refusal shake.
   *
   * Not a remount key: restarting the animation by re-keying the screen would tear down
   * and rebuild the chart and the cutoff ring on every rejected press, which is a lot of
   * churn to play a 260ms wobble. Clearing on animationend and re-arming on the next
   * frame restarts it without touching anything below.
   */
  /** The shape of the last band that the market actually accepted. */
  const [lastBand, setLastBand] = useState<{ lowHalf1e4: bigint; highHalf1e4: bigint } | null>(
    null,
  );

  /**
   * A band arriving from a shared ticket.
   *
   * Read once, applied once, and only after the market has a price — the band solver
   * has no legal window to clamp against until then, and applying a shape into a null
   * window would silently produce the default one instead. `applied` makes it a
   * one-shot: re-clamping every render would fight the player the moment they touched
   * the rules.
   */
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || !band.ready) return;
    const q = new URLSearchParams(window.location.search);
    const lo = q.get("lowBps");
    const hi = q.get("highBps");
    const mkt = q.get("market");
    if (mkt && mkt !== state.market.key && MARKETS.some((m) => m.key === mkt)) {
      setMarketKey(mkt);
      return; // re-run once the new market has a price of its own
    }
    if (!lo || !hi || !/^\d+$/.test(lo) || !/^\d+$/.test(hi)) {
      applied.current = true;
      return;
    }
    applied.current = true;
    band.setShape({ lowHalf1e4: BigInt(lo), highHalf1e4: BigInt(hi) });
    setFlash({ kind: "won", text: "BAND LOADED" });
    setTimeout(() => setFlash(null), 1600);
  }, [band, state.market.key, setMarketKey]);
  /**
   * Attract mode: fire on a cadence so the loop is visible with nobody touching it.
   *
   * A console on a table at a hackathon is looked at far more than it is picked up, and
   * a still screen says nothing about what the thing does. This fires real paper
   * tickets through the same engine and the same pricing as a person would — it is the
   * product running, not a recording of it — and it stops the moment anyone interacts.
   */
  const [attract, setAttract] = useState(false);
  const [shaking, setShaking] = useState(false);
  const shake = useCallback(() => {
    setShaking(false);
    requestAnimationFrame(() => setShaking(true));
  }, []);

  /**
   * Open on the market and round the player last chose.
   *
   * This waits for `prefsLoaded`: stored preferences arrive a tick after mount, so
   * applying them on first render would only ever re-apply the defaults and then stop.
   */
  const [appliedDefaults, setAppliedDefaults] = useState(false);
  useEffect(() => {
    if (appliedDefaults || !prefsLoaded) return;
    if (prefs.market !== state.market.key) setMarketKey(prefs.market);
    if (prefs.tier !== state.tier) setTier(prefs.tier);
    setAppliedDefaults(true);
  }, [
    appliedDefaults,
    prefsLoaded,
    prefs.market,
    prefs.tier,
    state.market.key,
    state.tier,
    setMarketKey,
    setTier,
  ]);

  /**
   * Click once when sound is switched on.
   *
   * Doing this inside the toggle handler is silent: the sound engine is built from the
   * value at render time, so the click fires against the state that was there a moment
   * ago. Waiting for the render that has it on is what makes the confirmation audible.
   */
  const wasSilent = useRef(true);
  useEffect(() => {
    if (prefs.sound && wasSilent.current) play("key");
    wasSilent.current = !prefs.sound;
  }, [prefs.sound, play]);

  /**
   * A percentage press wins until the rail is touched.
   *
   * Two controls setting one number needs an order. The rail is the physical one, so
   * moving it always takes over — nothing is more confusing than a key that appears to
   * do nothing because an invisible override is still in force.
   */
  const [pctStake, setPctStake] = useState<bigint | null>(null);
  const stake = pctStake ?? STAKE_STEPS[stakeStep - 1];
  const payout = payoutFor(stake, band.multiplierBps);
  const round = state.market.rounds[state.tier];

  /**
   * The open ticket that settles soonest.
   *
   * Insertion order is not cutoff order: fire a fifteen-minute round and then a
   * three-second one and the newer ticket is the urgent one, while the list still
   * begins with the older. The ring and the burn overlay both want the deadline that
   * arrives first.
   */
  const nearest = useMemo(() => {
    if (state.openTickets.length === 0) return null;
    return state.openTickets.reduce((a, b) => (b.expiresAt < a.expiresAt ? b : a));
  }, [state.openTickets]);

  // Progress of the nearest open ticket toward its cutoff, for the burn overlay.
  const progress = useMemo(() => {
    const t = nearest;
    if (!t) return 0;
    const total = Math.max(1, t.expiresAt - t.openedAt);
    return Math.max(0, Math.min(1, (state.now - t.openedAt) / total));
  }, [nearest, state.now]);

  // Announce settlements on the screen the way the console would.
  /** The settlement ring on the chart, cleared once its animation has run. */
  const [settleFlash, setSettleFlash] = useState<
    { price: bigint; won: boolean; at: number } | null
  >(null);

  useEffect(() => {
    const t = state.lastSettled;
    if (!t || t.status === "open") return;
    if (t.settledPrice !== null && !reducedMotion) {
      setSettleFlash({ price: t.settledPrice, won: t.status === "won", at: Date.now() });
      // Long enough for the 620ms expansion, then gone so it cannot re-draw later.
      setTimeout(() => setSettleFlash(null), 700);
    }
    setFlash({
      kind: t.status === "won" ? "won" : "lost",
      text: t.status === "won" ? `+${fmtUsd(t.payout - t.stake)}` : `−${fmtUsd(t.stake)}`,
    });
    // A bigger win rings brighter — the sound reports the size, not just the outcome.
    play(
      t.status === "won" ? "win" : "loss",
      t.status === "won" ? Math.min(1, Number(t.payout - t.stake) / Number(t.stake) / 4) : 0.5,
    );
    const id = setTimeout(() => setFlash(null), 1400);
    return () => clearTimeout(id);
  }, [state.lastSettled, reducedMotion]);

  const doFire = useCallback(() => {
    const r = fire(band.low, band.high, stake);
    if (r.ok) {
      play("fire");
      if (band.band) setLastBand({ ...band.band });
    }
    if (!r.ok) {
      play("reject");
      const e = r.error;
      shake();
      setFlash({
        kind: "lost",
        text:
          e.kind === "band-too-wide"
            ? "BAND TOO WIDE"
            : e.kind === "band-too-tight"
              ? "BAND TOO TIGHT"
              : e.kind === "balance"
                ? "NO FUNDS"
                : e.kind === "over-utilised"
                  ? "HOUSE FULL"
                  : "CAN'T FIRE",
      });
      setTimeout(() => setFlash(null), 1400);
    }
  }, [fire, band.low, band.high, stake, play, shake]);

  useEffect(() => {
    if (!attract) return;
    const id = setInterval(() => {
      // Vary the band a little so consecutive rounds do not look like a loop of one.
      band.nudge((Math.random() - 0.5) * 0.3);
      doFire();
    }, 4000);
    return () => clearInterval(id);
  }, [attract, band, doFire]);

  /** Any real input takes the console back. */
  useEffect(() => {
    if (!attract) return;
    const stop = () => setAttract(false);
    window.addEventListener("pointerdown", stop);
    window.addEventListener("keydown", stop);
    return () => {
      window.removeEventListener("pointerdown", stop);
      window.removeEventListener("keydown", stop);
    };
  }, [attract]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) return;
      if (e.key === "a" || e.key === "A" || e.key === "Enter") {
        e.preventDefault();
        doFire();
      } else if (e.key === "[") {
        band.nudge(-0.08);
        play("key");
      } else if (e.key === "]") {
        band.nudge(0.08);
        play("key");
      }
      else if (e.key === "m" || e.key === "M") setSheet("menu");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doFire, band, play]);

  /**
   * Session P&L and the current streak, both counted from settled tickets.
   *
   * Not stored anywhere and not incremented on events: derived from the tape every
   * render, so they cannot drift out of agreement with the history screen the way a
   * running total does the first time a settlement is missed or replayed. The streak is
   * the current run, which is the only one worth putting on the deck — the best-ever run
   * is a trophy and lives on the achievements screen.
   *
   * Deliberately NOT memoised on `state.tickets`. The paper engine mutates that array
   * in place and re-renders through a counter, so its identity never changes and a memo
   * keyed on it computes once, at zero tickets, and never again. It is a short loop over
   * one session's tickets; correctness is worth more here than the memo was.
   */
  const session = ((): { pnl: bigint; streak: number; kind: "won" | "lost" | null; n: number } => {
    const settled = state.tickets
      .filter((t) => t.status === "won" || t.status === "lost")
      .sort((a, b) => a.openedAt - b.openedAt);

    let pnl = 0n;
    for (const t of settled) pnl += t.status === "won" ? t.payout - t.stake : -t.stake;

    let streak = 0;
    let kind: "won" | "lost" | null = null;
    for (let i = settled.length - 1; i >= 0; i--) {
      const st = settled[i].status as "won" | "lost";
      if (kind === null) kind = st;
      else if (st !== kind) break;
      streak += 1;
    }
    return { pnl, streak, kind, n: settled.length };
  })();

  const coins = Math.round(Number(state.balance) / 25_000_000); // one coin per $25

  // The console opens on paper: a first round in under fifteen seconds, no wallet and
  // nothing to fund. Live is one key away and runs identical pricing.
  if (live) return <LiveConsole onBackToDemo={() => setLive(false)} />;

  return (
    <div className="tiled min-h-dvh">
      <DeviceFrame
        stakeStep={stakeStep}
        maxStake={STAKE_STEPS.length}
        onStakeStep={(n) => {
          setPctStake(null); // the physical control always takes over
          setStakeStep(n);
        }}
        soundOn={prefs.sound}
        onToggleSound={() => setPref("sound", !prefs.sound)}
        running={state.running}
        onToggleRunning={() => setRunning(!state.running)}
      >
        {/* ------------------------------------------------------- main screen */}
        <div
          className={`screen rounded-xl px-4 pb-2 pt-3 ${shaking ? "shake" : ""}`}
          onAnimationEnd={() => setShaking(false)}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="label">Range · {state.market.symbol}</div>
              <div className="tnum mt-1 text-[30px] font-bold leading-none text-white">
                {state.ready ? (
                  <Odometer
                    value={fmtPrice(state.spot, state.market.dp)}
                    reducedMotion={reducedMotion}
                  />
                ) : (
                  "—"
                )}
              </div>
            </div>
            {/* The nearest open ticket's time to cutoff, if there is one. */}
            {nearest ? (
              <div className="flex items-center gap-2">
                <CutoffRing
                  openedAt={nearest.openedAt}
                  expiresAt={nearest.expiresAt}
                  now={state.now}
                />
                {state.openTickets.length > 1 ? (
                  <span className="tnum text-[10px] text-dim">
                    +{state.openTickets.length - 1}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="text-right">
              <div className="label">Available</div>
              <div className="tnum mt-1 text-[15px] font-semibold text-white">
                {fmtUsd(state.balance)}
              </div>
              {session.n > 0 ? (
                <div className="mono mt-1 flex items-center justify-end gap-2 text-[9px] tracking-[0.08em]">
                  <span className={session.pnl >= 0n ? "text-green" : "text-red"}>
                    {session.pnl >= 0n ? "+" : "−"}
                    {fmtUsd(session.pnl < 0n ? -session.pnl : session.pnl)}
                  </span>
                  {session.streak > 1 ? (
                    <span className={session.kind === "won" ? "text-green" : "text-red"}>
                      {session.streak}
                      {session.kind === "won" ? "W" : "L"}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="relative mt-3 h-[228px]">
            {!state.ready ? (
              state.priceError ? (
                <div className="grid h-full place-items-center px-6 text-center">
                  <span className="label leading-relaxed">
                    no {state.market.symbol} price: {state.priceError}
                  </span>
                </div>
              ) : (
                <BootSequence symbol={state.market.symbol} />
              )
            ) : (
            <RangeChart
              market={state.market}
              history={state.history}
              spot={state.spot}
              low={band.low}
              high={band.high}
              multiplierBps={band.multiplierBps}
              progress={reducedMotion ? 0 : progress}
              settleFlash={settleFlash}
              openBands={state.openTickets.map((t) => ({
                low: t.low,
                high: t.high,
                won: state.spot >= t.low && state.spot <= t.high,
              }))}
              onDragEdge={band.setEdge}
            />
            )}

            {flash ? (
              <div
                className={`pop pointer-events-none absolute inset-0 grid place-items-center text-[34px] font-bold ${
                  flash.kind === "won" ? "text-green glow-green" : "text-red"
                }`}
              >
                {flash.text}
              </div>
            ) : null}
          </div>

          {/* round selector, on the glass */}
          <div className="mt-1 flex items-center justify-between border-t border-[#161616] pt-2">
            <HouseBattery utilisationBps={state.utilisationBps} />
            <div className="flex gap-1">
              {ROUND_SECONDS.map((seconds, i) => (
                <button
                  key={seconds}
                  onClick={() => {
                    setTier(i);
                    setPref("tier", i);
                    play("key");
                  }}
                  className={`mono rounded px-1.5 py-0.5 text-[10px] tracking-wide ${
                    i === state.tier ? "bg-amber text-black" : "text-dim hover:text-white"
                  }`}
                >
                  {roundLabel(i)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* The oracle, on the deck. Every market settles against it, so it is never hidden. */}
        <OracleStrip
          oracle={state.oracle}
          error={state.oracleError}
          mark={state.spot}
          onOpen={() => setSheet("menu")}
        />

        {/* --------------------------------------------- pays panel + fire key */}
        <div className="mt-2 flex gap-2">
          <div className="screen flex-1 rounded-xl px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="label">Pays</span>
              <span className="tnum text-[13px] text-white">
                {fmtUsd(stake)} <span className="text-dim">→</span>{" "}
                <span className="text-green">{fmtUsd(payout)}</span>
              </span>
            </div>

            <div className="tnum glow-amber mt-1 text-[34px] font-bold leading-none text-amber">
              {state.ready ? fmtMultiplier(band.multiplierBps) : "—"}
            </div>

            {/* No win-probability on the deck. The number the model prices from is
                deliberately conservative — sigma is shaded so the vault stays solvent
                through a volatility regime change — so it is not a truthful forecast to
                put in front of a player. The multiplier is the actual contract; the
                model and its bias are explained in How it works. */}
            {/* Stake as a share of the balance, and the last band again. */}
            <div className="mt-2 flex items-center gap-1">
              {PERCENT_PRESETS.map((pct) => {
                const want = (state.balance * BigInt(pct)) / 100n;
                /**
                 * A preset the market would refuse is not offered.
                 *
                 * The market caps a ticket at $10 and floors it at $1, so on a healthy
                 * balance most percentages land outside that — and a key that sets a
                 * stake the desk then rejects with "CAN'T FIRE" is worse than a key that
                 * is visibly unavailable. Disabled with the cap named, rather than
                 * silently clamped to a number the label does not describe.
                 */
                const legal = want >= DEFAULT_CONFIG.minStake && want <= DEFAULT_CONFIG.maxStake;
                const on = legal && pctStake === want;
                return (
                  <button
                    key={pct}
                    disabled={!legal}
                    title={
                      legal
                        ? `${pct}% of your balance`
                        : `${pct}% is ${fmtUsd(want)} — outside the ${fmtUsd(DEFAULT_CONFIG.minStake)}–${fmtUsd(DEFAULT_CONFIG.maxStake)} the market takes`
                    }
                    onClick={() => {
                      setPctStake(want);
                      play("key");
                    }}
                    className={`mono flex-1 rounded py-1 text-[9px] tracking-[0.08em] disabled:opacity-25 ${
                      on ? "bg-amber text-black" : "bg-white/8 text-dim"
                    }`}
                  >
                    {pct}%
                  </button>
                );
              })}
              <button
                disabled={!lastBand}
                onClick={() => {
                  if (!lastBand) return;
                  band.setShape(lastBand);
                  play("key");
                }}
                title="repeat the last band you fired"
                className="mono flex-[1.4] rounded bg-white/8 py-1 text-[9px] tracking-[0.08em] text-dim disabled:opacity-30"
              >
                AGAIN
              </button>
            </div>

            <p className="mono mt-2 text-[9px] leading-[1.45] tracking-[0.08em] text-dim">
              TOP UP AS OFTEN AS YOU LIKE.
              <br />
              THEY ALL SETTLE AT THE
              <br />
              CUTOFF · {secondsLabel(round.seconds).toUpperCase()} ROUND
            </p>
          </div>

          <FireKey onClick={doFire} disabled={!state.ready} armed={state.openTickets.length > 0} />
        </div>

        {/* ------------------------------------------------------- lower deck */}
        <div className="mt-2 flex items-stretch gap-2">
          <BlueKey onClick={() => (LIVE_CONFIGURED ? setLive(true) : setSheet("howto"))}>
            {LIVE_CONFIGURED ? "GO LIVE" : "HOW TO"}
          </BlueKey>
          <CoinKey
            symbol={state.market.symbol}
            tone={COIN_TONE[state.market.key] ?? "#f7931a"}
            onClick={() => {
              const i = MARKETS.findIndex((m) => m.key === state.market.key);
              const next = MARKETS[(i + 1) % MARKETS.length].key;
              setMarketKey(next);
              setPref("market", next);
              play("key");
            }}
          />
          <CoinStack count={coins} />
        </div>

        <div className="mt-3 flex items-end justify-between px-1 pb-1">
          <div className="flex gap-3">
            <DeckKey label="MENU" onClick={() => setSheet("menu")} />
            <DeckKey label="HOME" onClick={() => router.push("/")} />
          </div>
          <div className="tnum rounded-lg bg-black px-3 py-2 text-[15px] font-semibold text-white">
            {fmtUsd(stake, Number(stake) % 1_000_000 === 0 ? 0 : 1)}
          </div>
        </div>
      </DeviceFrame>

      {sheet === "menu" ? (
        <MenuSheet
          onClose={() => setSheet(null)}
          balance={state.balance}
          tickets={state.tickets}
          pnl={state.pnl}
          onReset={reset}
          onAttract={() => setAttract(true)}
        />
      ) : null}
      {sheet === "howto" ? <HowToSheet onClose={() => setSheet(null)} round={round} /> : null}
    </div>
  );
}
