"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MARKETS,
  ROUND_SECONDS,
  fmtMultiplier,
  fmtPrice,
  fmtUsd,
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
import { BandControl } from "./device/BandControl";
import { StatusBar } from "./device/StatusBar";
import { Knob } from "./device/Knob";
import { Positions } from "./device/Positions";
import { CountUp } from "./device/CountUp";
import { BlueKey, DeckKey, FireKey, KeyFrame, MarketChip } from "./device/Controls";
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
 * Quick stakes, in the same units as the ladder.
 *
 * These replaced a row of percentage keys. The market floors a position at `minStake` and
 * caps it at `maxStake`, so at any healthy balance every percentage of the balance landed
 * outside that window and all four keys rendered disabled — four controls that looked
 * broken. A fixed ladder of amounts the market always accepts cannot do that.
 */
const QUICK_STAKES = [1_000_000n, 2_500_000n, 5_000_000n, 10_000_000n];

/** The 1-based detent closest to a stake, for parking the knob after a quick stake. */
function nearestStep(v: bigint): number {
  let best = 1;
  for (let i = 0; i < STAKE_STEPS.length; i += 1) {
    const d = STAKE_STEPS[i] > v ? STAKE_STEPS[i] - v : v - STAKE_STEPS[i];
    const bd = STAKE_STEPS[best - 1] > v ? STAKE_STEPS[best - 1] - v : v - STAKE_STEPS[best - 1];
    if (d < bd) best = i + 1;
  }
  return best;
}

/**
 * Coin tones, per `packages/sdk/src/markets.ts`.
 *
 * This map still carried MON from the Monad build and had no STRK entry at all, so the
 * Starknet market rendered in Bitcoin orange — the one market whose colour a Starknet judge
 * would recognise, wearing another chain's.
 */
/**
 * The guided run, one step at a time.
 *
 * `act` runs once on entry and `ms` is how long the line stays up. Every action is a real
 * one — the band solver, the pricing kernel and the paper engine are the same ones a person
 * drives — so a step can fail exactly the way a person's press would, and that is the point.
 */
interface GuideStep {
  say: string;
  ms: number;
  act?: (api: { nudge: (d: number) => void; fire: () => void }) => void;
}

const GUIDE: GuideStep[] = [
  {
    say: "THIS PRICE IS REAL — AN EXCHANGE TAPE, REPLAYED SECOND BY SECOND.",
    ms: 3200,
  },
  {
    say: "PICK A BAND. TIGHTER PAYS MORE, BECAUSE IT IS LESS LIKELY.",
    ms: 3600,
    act: ({ nudge }) => nudge(-0.18),
  },
  {
    say: "THE CONTRACT IS NEVER TOLD THE BAND — ONLY HOW FAR IT REACHES.",
    ms: 3800,
  },
  {
    say: "FIRE. THE STAKE IS LOCKED AND THE BAND IS SEALED UNTIL THE CUTOFF.",
    ms: 3000,
    act: ({ fire }) => fire(),
  },
  {
    say: "THE CUTOFF IS A BLOCK TIMESTAMP. THE RING IS DRAINING TOWARDS IT.",
    ms: 4200,
  },
  {
    say: "IT SETTLES AGAINST THE ORACLE'S MEDIAN — AND ANYONE CAN RECOMPUTE IT.",
    ms: 4500,
  },
];

const COIN_TONE: Record<string, string> = {
  BTC: "#f7931a",
  ETH: "#8098ee",
  STRK: "#8b5cf6",
};

export function PlayScreen() {
  const router = useRouter();
  const { prefs, set: setPref, loaded: prefsLoaded } = usePrefs();
  const osReduced = usePrefersReducedMotion();
  const reducedMotion = prefs.reducedMotion || osReduced;

  useApplyTheme(prefs.theme);

  const desk = usePaperDesk(prefs.market);
  const { state, setMarketKey, setTier, setRunning, fire, reset, topUp } = desk;
  const band = useBand(state.market, state.tier, state.spot);
  const play = useSound(prefs.sound, prefs.volume);

  const [stakeStep, setStakeStep] = useState(2); // $1.5
  const [screen, setScreen] = useState<"range" | "positions">("range");
  const [sheet, setSheet] = useState<null | "menu" | "howto">(null);
  const [live, setLive] = useState(false);
  /**
   * The banner over the chart. `amount` is set only for a settlement, and only then does the
   * number count up — a refusal is not an arrival and should not be animated like one.
   */
  const [flash, setFlash] = useState<
    null | { kind: "won" | "lost"; text: string; amount?: bigint }
  >(null);
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
  /**
   * The guided run: which step is on screen, or null.
   *
   * Attract mode shows that the desk works. This explains *what it is doing while it works*,
   * which is the harder half — a judge has four minutes and the interesting claim (the
   * contract is never told the band) is invisible unless something says so at the moment it
   * happens. It drives the same engine and the same keys a person would; nothing here is a
   * recording.
   */
  const [guideStep, setGuideStep] = useState<number | null>(null);
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

  /**
   * The detents either side of the number on screen — not either side of the knob.
   *
   * A quick stake sets `pctStake` and left `stakeStep` where the knob happened to be, so
   * after tapping $5 the readout printed "$5, ▲ $2, ▼ $1": the neighbours of $1.50, which is
   * not the figure above them. Both hints were wrong at once, and the next notch of the knob
   * really did drop $5 to $2. Reading them off `stake` makes the readout describe the stake
   * it is printed under, whether that came from the knob or from a key.
   */
  const stepAbove = STAKE_STEPS.find((v) => v > stake) ?? null;
  const stepBelow = STAKE_STEPS.filter((v) => v < stake).pop() ?? null;
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
      amount: t.status === "won" ? t.payout - t.stake : t.stake,
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

  /**
   * Step the guided run.
   *
   * The action and the schedule are held in refs so the effect keys only on the step number.
   * Depending on `doFire` and `band` directly would restart the timer on every price tick,
   * and the run would never advance past its first line.
   */
  const guideApi = useRef({ nudge: (_: number) => {}, fire: () => {} });
  guideApi.current = { nudge: (d: number) => band.nudge(d), fire: () => doFire() };

  useEffect(() => {
    if (guideStep === null) return;
    const step = GUIDE[guideStep];
    if (!step) {
      setGuideStep(null);
      return;
    }
    step.act?.(guideApi.current);
    const id = setTimeout(() => setGuideStep((n) => (n === null ? null : n + 1)), step.ms);
    return () => clearTimeout(id);
  }, [guideStep]);

  /** Any real input ends the guided run, the same way it ends attract mode. */
  useEffect(() => {
    if (guideStep === null) return;
    const stop = () => setGuideStep(null);
    window.addEventListener("pointerdown", stop);
    window.addEventListener("keydown", stop);
    return () => {
      window.removeEventListener("pointerdown", stop);
      window.removeEventListener("keydown", stop);
    };
  }, [guideStep]);

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

  /**
   * Where the band sits inside the window the market will actually sell.
   *
   * The fill has to mean something specific or it is a decoration that moves. Zero is the
   * tightest band on offer, one is the widest, and both ends are the contract's, not a
   * design choice — which is why the keys stop rather than the band going somewhere it
   * would be refused.
   */
  const bandSpan = band.limits
    ? Number(band.limits.maxHalfWidth1e4 - band.limits.minHalfWidth1e4)
    : 0;
  /**
   * The fill and the printed reach, both from the whole band rather than half of it.
   *
   * Dragging one edge on the chart makes the band asymmetric, and both of these read only
   * `lowHalf1e4` — so a band reaching 0.18% down and 0.26% up printed "±0.22%" and drew a
   * fill for the down side alone. A single ± figure is a claim of symmetry, and after a drag
   * it was not true.
   */
  const halves = band.band ? [band.band.lowHalf1e4, band.band.highHalf1e4] : null;
  const widthPct =
    halves && bandSpan > 0
      ? Number((halves[0] + halves[1]) / 2n - band.limits!.minHalfWidth1e4) / bandSpan
      : 0;
  const pct = (v: bigint) => (Number(v) / 1_000_000).toFixed(2);
  const reachLabel = !halves
    ? "—"
    : halves[0] === halves[1]
      ? `${pct(halves[0])}%`
      : `${pct(halves[0])} / ${pct(halves[1])}%`;
  const atMinBand = Boolean(
    band.band && band.limits && band.band.lowHalf1e4 <= band.limits.minHalfWidth1e4,
  );
  const atMaxBand = Boolean(
    band.band && band.limits && band.band.lowHalf1e4 >= band.limits.maxHalfWidth1e4,
  );

  const settledTickets = state.tickets.filter((t) => t.status === "won" || t.status === "lost");

  // The console opens on paper: a first round in under fifteen seconds, no wallet and
  // nothing to fund. Live is one key away and runs identical pricing.
  if (live) return <LiveConsole onBackToDemo={() => setLive(false)} />;

  return (
    <div className="tiled min-h-dvh">
      <DeviceFrame
        soundOn={prefs.sound}
        onToggleSound={() => setPref("sound", !prefs.sound)}
        volume={prefs.volume}
        onVolume={(v) => {
          setPref("volume", v);
          if (!prefs.sound && v > 0) setPref("sound", true);
        }}
        glass={
          <div
            className={`screen overflow-hidden rounded-[15px] ${shaking ? "shake" : ""}`}
            onAnimationEnd={() => setShaking(false)}
          >
            {/*
              * Name the feed this price actually came from.
              *
              * This said "PRAGMA TAPE", which is the settlement oracle — a different feed,
              * read from a different chain, shown separately two rows down. The mark on the
              * big readout is a real exchange tape, and attributing it to the wrong source
              * is worse than not attributing it at all.
              */}
            <StatusBar
              network={
                state.markSource
                  ? `PAPER DESK · ${state.markSource.replace(":", " ").toUpperCase()}`
                  : "PAPER DESK"
              }
              connected={state.ready}
              riding={state.openTickets.length}
              attract={attract}
            />

            {/* One fixed height for every screen, or the device changes size on a tab. */}
            <div className="h-[421px]">
              {screen === "positions" ? (
                <Positions
                  open={state.openTickets}
                  settled={settledTickets}
                  now={state.now}
                  demoClock
                  session={{ pnl: session.pnl, n: session.n }}
                />
              ) : (
                <div className="px-[11px] pb-[9px] pt-[11px]">
                  <div className="flex items-start justify-between gap-2.5">
                    <div>
                      <MarketChip
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
                      <div className="tnum mt-1 font-display text-[34px] font-bold leading-none text-white">
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

                    {/* The nearest open position's time to cutoff, if there is one. */}
                    {nearest ? (
                      <div className="flex items-center gap-[7px] pt-1">
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
                      <div className="mono text-[9.5px] tracking-[0.15em] text-dim">AVAILABLE</div>
                      <div className="tnum mt-1 text-[15px] font-semibold text-white">
                        {fmtUsd(state.balance)}
                      </div>
                      {session.n > 0 ? (
                        <div className="mono mt-[3px] flex items-center justify-end gap-2 text-[9px] tracking-[0.08em]">
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

                  <div className="relative mt-[9px] h-[206px]">
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
                        className={`pop pointer-events-none absolute inset-0 grid place-items-center font-display text-[34px] font-bold ${
                          flash.kind === "won" ? "text-green glow-green" : "text-red"
                        }`}
                      >
                        {flash.amount === undefined ? (
                          flash.text
                        ) : (
                          <span>
                            {flash.kind === "won" ? "+" : "−"}
                            <CountUp
                              to={flash.amount}
                              format={(v) => fmtUsd(v)}
                              reducedMotion={reducedMotion}
                            />
                          </span>
                        )}
                      </div>
                    ) : null}

                    {/* Narration sits over the chart rather than under it: the glass is one
                        fixed height for every screen, and a line that pushes the deck down
                        would break that for the sake of a sentence. */}
                    {guideStep !== null && GUIDE[guideStep] ? (
                      <div className="pointer-events-none absolute inset-x-0 bottom-0">
                        <div className="mono pop bg-black/85 px-2.5 py-2 text-center text-[9px] leading-[1.5] tracking-[0.1em] text-amber">
                          {GUIDE[guideStep].say}
                          <span className="mt-1 block text-[8.5px] tracking-[0.14em] text-dim">
                            {guideStep + 1}/{GUIDE.length} · TOUCH ANYTHING TO TAKE OVER
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <BandControl
                    widthPct={widthPct}
                    onNudge={(d) => {
                      band.nudge(d);
                      play("key");
                    }}
                    label={reachLabel}
                    disabled={!band.ready}
                    atMin={atMinBand}
                    atMax={atMaxBand}
                    asymmetric={Boolean(halves && halves[0] !== halves[1])}
                  />

                  <div className="mt-2 flex items-center justify-between border-t border-[#161616] pt-2">
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
                          className={`mono rounded-md px-[9px] py-1 text-[10px] tracking-[0.06em] ${
                            i === state.tier ? "bg-amber text-black" : "text-dim hover:text-white"
                          }`}
                        >
                          {roundLabel(i)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* The oracle every market settles against, never behind a tap. */}
                  <OracleStrip
                    oracle={state.oracle}
                    error={state.oracleError}
                    mark={state.spot}
                  />
                </div>
              )}
            </div>
          </div>
        }
        deck={
          /*
           * One grid, two columns.
           *
           * Stacked rows were each sized by their tallest child, which left a band of empty
           * chassis beside the short one. The right column is a continuous rail whose knob
           * flexes to whatever height the left stack takes, so there is none.
           */
          <div className="mt-[9px] grid grid-cols-[1fr_112px] items-stretch gap-[9px]">
            <div className="flex min-w-0 flex-col gap-[9px]">
              {/* Flexes, so the left column always matches the control rail beside it and
                  the deck cannot contain a band of empty chassis. */}
              <div className="recess flex flex-1 rounded-[18px] p-2">
                <div className="screen flex-1 rounded-xl px-3 pb-3 pt-[11px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="mono text-[9.5px] tracking-[0.15em] text-dim">PAYS</span>
                    <span className="tnum text-[12.5px] text-white">
                      {fmtUsd(stake)} <span className="text-dim">→</span>{" "}
                      <span className="text-green">{fmtUsd(payout)}</span>
                    </span>
                  </div>

                  <div className="tnum glow-amber mt-[5px] font-display text-[38px] font-bold leading-none text-amber">
                    {state.ready ? fmtMultiplier(band.multiplierBps) : "—"}
                  </div>

                  {/* No win-probability on the deck. Sigma is shaded so the vault stays
                      solvent through a regime change, which makes the model deliberately
                      conservative and a probability drawn from it a forecast it is not.
                      The multiplier is the actual contract. */}
                  <div className="mt-2 flex gap-1">
                    {QUICK_STAKES.map((v) => {
                      const affordable = v <= state.balance;
                      const on = stake === v;
                      return (
                        <button
                          key={String(v)}
                          disabled={!affordable}
                          title={
                            affordable
                              ? `stake ${fmtUsd(v)}`
                              : `${fmtUsd(v)} is more than you hold`
                          }
                          onClick={() => {
                            setPctStake(v);
                            // Park the knob at the nearest detent too. Without this its next
                            // notch is measured from wherever it was last left, so one turn
                            // after tapping $5 dropped the stake to $2.
                            setStakeStep(nearestStep(v));
                            play("key");
                          }}
                          className={`mono flex-1 rounded-md py-[5px] text-[9px] tracking-[0.08em] disabled:opacity-30 ${
                            on ? "bg-amber text-black" : "bg-white/8 text-dim"
                          }`}
                        >
                          {fmtUsd(v, Number(v) % 1_000_000 === 0 ? 0 : 2)}
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
                      title="repeat the last band the market accepted"
                      className="mono flex-[1.4] rounded-md bg-white/8 py-[5px] text-[9px] tracking-[0.08em] text-dim disabled:opacity-30"
                    >
                      AGAIN
                    </button>
                  </div>

                  <p className="mono mt-[9px] text-[9px] leading-[1.5] tracking-[0.09em] text-dim">
                    TOP UP AS OFTEN AS YOU LIKE.
                    <br />
                    THEY ALL SETTLE AT THE CUTOFF
                    <br />
                    {secondsLabel(round.seconds).toUpperCase()} ROUND ·{" "}
                    {state.openTickets.length} RIDING
                  </p>
                </div>
              </div>

              {/* Two destinations, one frame. GO LIVE is the most consequential key on
                  the device — it swaps a paper engine for a signed transaction — and it had
                  no home at all once the market switcher moved into the price header. */}
              <KeyFrame className="flex gap-[7px]">
                <BlueKey
                  label={screen === "positions" ? "RANGE" : "POSITIONS"}
                  count={screen === "positions" ? 0 : state.openTickets.length}
                  onClick={() => {
                    setScreen((v) => (v === "range" ? "positions" : "range"));
                    play("key");
                  }}
                />
                <BlueKey
                  label={LIVE_CONFIGURED ? "GO LIVE" : "HOW TO"}
                  onClick={() => (LIVE_CONFIGURED ? setLive(true) : setSheet("howto"))}
                />
              </KeyFrame>
            </div>

            <div className="flex min-w-0 flex-col gap-[9px]">
              <div
                className="flex flex-1 flex-col items-center rounded-[18px] p-2"
                style={{
                  minHeight: 120,
                  background: "var(--color-frame)",
                  boxShadow:
                    "inset 0 2px 6px rgba(0,0,0,.85), inset 0 0 0 1px rgba(255,255,255,.05), 0 1px 0 rgba(255,255,255,.07)",
                }}
              >
                <Knob
                  value={stakeStep}
                  max={STAKE_STEPS.length}
                  valueText={fmtUsd(stake, Number(stake) % 1_000_000 === 0 ? 0 : 2)}
                  onChange={(n) => {
                    setPctStake(null); // the physical control always takes over
                    setStakeStep(n);
                    play("key");
                  }}
                />
              </div>

              <div
                className="flex-none rounded-[18px] p-2"
                style={{
                  background: "var(--color-frame)",
                  boxShadow:
                    "inset 0 2px 6px rgba(0,0,0,.85), inset 0 0 0 1px rgba(255,255,255,.05), 0 1px 0 rgba(255,255,255,.07)",
                }}
              >
                <FireKey
                  onClick={doFire}
                  disabled={!state.ready}
                  armed={state.openTickets.length > 0}
                />
              </div>
            </div>
          </div>
        }
        footer={
          <div className="mt-[11px] flex items-stretch gap-2.5 px-[3px] pb-[3px]">
            <div className="flex gap-3">
              <DeckKey label="MENU" onClick={() => setSheet("menu")} />
              <DeckKey label="HOME" onClick={() => router.push("/")} />
            </div>

            {/* The stake, under the control that sets it. The detents either side are the
                whole ladder made legible without turning anything. */}
            <div
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[14px] px-3 py-2"
              style={{
                background: "#0a0a0b",
                boxShadow: "inset 0 2px 7px rgba(0,0,0,.9), inset 0 0 0 1px rgba(255,255,255,.04)",
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="mono text-[9.5px] tracking-[0.16em] text-dim">STAKE</div>
                <div className="tnum mt-0.5 font-display text-2xl font-bold leading-none text-white">
                  {fmtUsd(stake, Number(stake) % 1_000_000 === 0 ? 0 : 2)}
                </div>
              </div>
              <div className="mono tnum flex-none text-right text-[9.5px] leading-[1.6] text-dim">
                <div>▲ {stepAbove ? fmtUsd(stepAbove, 0) : "—"}</div>
                <div>▼ {stepBelow ? fmtUsd(stepBelow, 0) : "—"}</div>
              </div>
            </div>
          </div>
        }
      />

      {sheet === "menu" ? (
        <MenuSheet
          onClose={() => setSheet(null)}
          balance={state.balance}
          tickets={state.tickets}
          pnl={state.pnl}
          onReset={reset}
          onTopUp={topUp}
          onAttract={() => setAttract(true)}
          onGuide={() => setGuideStep(0)}
        />
      ) : null}
      {sheet === "howto" ? <HowToSheet onClose={() => setSheet(null)} round={round} /> : null}
    </div>
  );
}
