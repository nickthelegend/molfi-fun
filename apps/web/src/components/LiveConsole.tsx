"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MARKETS,
  ROUND_SECONDS,
  fmtCountdown,
  fmtMultiplier,
  fmtPrice,
  HOUSE_EDGE_BPS,
  fmtStrk,
  maxStakeFor,
  parseStrk,
  payoutFor,
  roundLabel,
} from "@molfi/sdk";
import { useLiveDesk, type LiveMarket } from "@/lib/useLiveDesk";
import { errorText } from "@/lib/pool";
import type { Route } from "@/lib/wallet";
import { useBand } from "@/lib/useBand";
import { usePrefs } from "@/lib/usePrefs";
import { useSound } from "@/lib/useSound";
import { ADDRESSES, activeNetwork, explorerTx, shortAddress } from "@/lib/chain";
import { DeviceFrame } from "./device/DeviceFrame";
import { RangeChart } from "./device/RangeChart";
import { BandControl } from "./device/BandControl";
import { StatusBar } from "./device/StatusBar";
import { Knob } from "./device/Knob";
import { BlueKey, DeckKey, FireKey, KeyFrame, MarketChip } from "./device/Controls";

/**
 * A thrown error, as a line the console can show.
 *
 * The screen is narrow and upper-cased, so it gets the first sentence and nothing else —
 * but the first sentence has to be the reason. `errorText` already digs the Cairo refusal or
 * the RPC message out of whatever envelope it arrived in; this only trims and shapes it.
 */
function errorFlash(e: unknown): string {
  return errorText(e).split("\n")[0].slice(0, 72).toUpperCase();
}

/** Stakes the deck offers, in whole STRK. */
const STAKE_STEPS = [1, 2, 5, 10, 25, 50].map((n) => parseStrk(n));

/**
 * The sizes this market can actually sell, given what it can cover.
 *
 * `open_position` reserves the whole payout at open and refuses anything the bankroll plus
 * the stake cannot already back. The rail did not know that: it offered 1 to 50 STRK into
 * markets holding a 0.05 STRK bankroll, so *every* detent reverted with
 * `MARKET_CANNOT_COVER_PAYOUT` — after the wallet had been opened and the user had signed.
 *
 * So the ladder is the standard rail trimmed to what fits, and when nothing fits, six
 * detents scaled to the desk itself. A small desk is a real constraint and the honest thing
 * is to let it be traded at its real size, not to offer sizes it will refuse.
 */
/**
 * The multiplier, explained in the terms it was actually computed from.
 *
 * The pricing kernel is the most defensible thing in this project and the screen showed only
 * its output — a number a reader has to take on faith, next to a claim that nothing here
 * should be taken on faith. This is the whole derivation: how wide the band is in sigmas of
 * the round's own calibrated move, how often a move that size stayed inside it, and the edge
 * taken off the fair price. One over the probability, less the edge, is the multiplier.
 */
function whyThisBand(
  band: { lowHalf1e4: bigint; highHalf1e4: bigint } | null,
  sigma1e4: bigint,
  prob1e6: bigint,
  round: string,
  symbol: string,
): string | null {
  if (!band || sigma1e4 <= 0n || prob1e6 <= 0n) return null;
  const z = (h: bigint) => (Number(h) / Number(sigma1e4)).toFixed(2);
  const reach =
    band.lowHalf1e4 === band.highHalf1e4
      ? `±${z(band.lowHalf1e4)}σ`
      : `−${z(band.lowHalf1e4)}σ / +${z(band.highHalf1e4)}σ`;
  const pct = (Number(prob1e6) / 10_000).toFixed(1);
  const edge = (Number(HOUSE_EDGE_BPS) / 100).toFixed(0);
  return `${reach} OF A ${round.toUpperCase()} ${symbol} MOVE · ${pct}% OF THEM LANDED INSIDE · LESS ${edge}% EDGE`;
}

/**
 * A stake, at a precision that can show it.
 *
 * The rail used to be whole STRK only, so the readout was whole STRK too. On a desk whose
 * whole bankroll is 0.05 STRK that printed every size as "0", which reads as a broken screen
 * rather than as a small one.
 */
const fmtStake = (v: bigint) => fmtStrk(v, v > 0n && v < parseStrk(1) ? 3 : 0);

function stakeLadder(capacity: bigint | null): bigint[] {
  if (capacity === null) return STAKE_STEPS;
  if (capacity <= 0n) return [];
  const fits = STAKE_STEPS.filter((s) => s <= capacity);
  if (fits.length > 0) return fits;
  const scaled = [16n, 8n, 4n, 3n, 2n, 1n].map((d) => capacity / d).filter((v) => v > 0n);
  return [...new Set(scaled)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
const COIN_TONE: Record<string, string> = {
  BTC: "#f7931a",
  ETH: "#8098ee",
  STRK: "#ec796b",
};

/**
 * The same console, wired to the chain.
 *
 * Everything is read from the deployed contract or from the user's own wallet — the market
 * list, the settled prices, the shielded balance. Nothing is simulated, and a dead node says
 * so rather than falling back to invented numbers.
 *
 * One thing works differently here than in any public market, and it is the point of the
 * product: the chain cannot tell this console what positions the user owns, because it does
 * not know. Positions come from the browser's own store of secrets, and the chain is asked
 * only to confirm what it holds under a commitment the browser derived.
 */
export function LiveConsole({ onBackToDemo }: { onBackToDemo: () => void }) {
  const router = useRouter();
  const [marketKey, setMarketKey] = useState("BTC");
  const [tier, setTier] = useState(0);
  const [stakeStep, setStakeStep] = useState(3);
  const { prefs, set: setPref } = usePrefs();
  /**
   * The live desk was silent.
   *
   * The paper desk rings on every outcome and the real one — the desk where the money is
   * actually at stake, and where a transaction can take twenty seconds to land — said
   * nothing at all. Same voices, same rail, so switching between them does not switch the
   * console's behaviour.
   */
  const play = useSound(prefs.sound, prefs.volume);
  const [flash, setFlash] = useState<string | null>(null);
  /**
   * The route the next position takes, or null to take the most private one available.
   *
   * Null rather than a default of "pool", because which routes exist is not known until a
   * wallet is connected and a stored preference for one the wallet cannot take would silently
   * refuse every trade.
   */
  const [routePref, setRoutePref] = useState<Route | null>(null);

  const market = useMemo(
    () => MARKETS.find((m) => m.key === marketKey) ?? MARKETS[0],
    [marketKey],
  );
  const live = useLiveDesk(market, tier);
  const { state } = live;
  // Pass the real spot, including zero before the first read lands. Substituting a
  // placeholder to avoid a divide-by-zero produces a legal-looking but nonsense band
  // window, and the band then sticks at maximum width once the real price arrives.
  const band = useBand(market, tier, state.spot);


  const say = useCallback((m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(null), 2600);
  }, []);

  /**
   * The chain's clock, interpolated forward from the last read.
   *
   * Cutoffs are block timestamps. Using the browser's clock made the settle-due key stay
   * hidden on a chain running ahead — the contract would have accepted the settlement the
   * whole time. Falls back to local time only before the first read lands, when there is
   * nothing better to use.
   */
  const now = state.chainNow
    ? state.chainNow + Math.floor((Date.now() - state.chainNowReadAt) / 1000)
    : Math.floor(Date.now() / 1000);

  /**
   * The on-chain market a band would actually open into: this pair, still open, and the
   * cutoff nearest the selected round length.
   */
  const target: LiveMarket | null = useMemo(() => {
    const open = state.markets.filter(
      (m) => m.pair === market.label && !m.isSettled && m.cutoffAt > now,
    );
    if (open.length === 0) return null;
    const want = ROUND_SECONDS[tier] ?? ROUND_SECONDS[0];
    return open.reduce((best, m) =>
      Math.abs(m.cutoffAt - now - want) < Math.abs(best.cutoffAt - now - want) ? m : best,
    );
  }, [state.markets, market.label, tier, now]);

  /**
   * What the target market can still cover at the quoted multiplier, and the sizes that fit.
   *
   * Null while there is no market or no quote yet — unknown is not zero, and a rail that
   * collapses to nothing every time a price read is in flight is worse than one that waits.
   */
  const capacity = useMemo(
    () => (target && band.ready ? maxStakeFor(target, band.multiplierBps) : null),
    [target, band.ready, band.multiplierBps],
  );
  const ladder = useMemo(() => stakeLadder(capacity), [capacity]);

  /** Where the band sits inside the window the market will sell, and its reach in words. */
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
  const stake = ladder[Math.min(stakeStep, ladder.length) - 1] ?? 0n;

  const claimable = state.positions.filter((p) => p.won === true && !p.claimedTxHash);

  const routes = live.routes;
  const route: Route | null =
    routes.length === 0 ? null : routePref && routes.includes(routePref) ? routePref : routes[0];

  /**
   * Make sure there is a wallet to act with, connecting if there is one to connect.
   *
   * Every key that sends a transaction needs this, and only the fire key had it. Settling
   * and claiming went straight to the desk, which threw `connect a wallet first` — an
   * internal string, lowercase, written for whoever was debugging — and flashed it at the
   * user as though it were an explanation. Now all three keys behave the same way: offer to
   * connect, say plainly when there is nothing to connect to, and never leak a developer's
   * sentence onto the screen.
   */
  const readyToAct = useCallback(async (): Promise<boolean> => {
    if (!state.connection) {
      const wallet = state.wallets[0];
      if (!wallet) {
        say("NO STARKNET WALLET FOUND");
        return false;
      }
      await live.connect(wallet).catch((e) => say(errorFlash(e)));
      // Connecting is its own action. The key does the thing on the next press, once the
      // address is on screen and the trader can see what they are about to act with.
      return false;
    }
    if (state.blocked) {
      say(state.blocked.slice(0, 60).toUpperCase());
      return false;
    }
    return true;
  }, [state.connection, state.wallets, state.blocked, live, say]);

  const doFire = useCallback(async () => {
    if (!(await readyToAct())) return;
    // Never a silent no-op. A key that does nothing and says nothing is indistinguishable
    // from a broken app, and it cost an afternoon of debugging to find out which it was.
    if (!target) {
      say("NO OPEN MARKET FOR THIS ROUND");
      return;
    }
    if (!band.band) {
      say("NO PRICE YET — THE BAND IS NOT SET");
      return;
    }
    // The contract would refuse this anyway; refusing it here costs nobody a signature.
    if (stake <= 0n) {
      say("DESK CANNOT COVER ANY SIZE ON THIS BAND");
      return;
    }
    try {
      const hash = await live.fire(target.id, band.low, band.high, stake, route ?? undefined);
      play("fire");
      say(`OPENED ${hash.slice(0, 10)}…`);
    } catch (e) {
      play("reject");
      say(errorFlash(e));
    }
  }, [readyToAct, live, band.band, band.low, band.high, target, stake, route, say]);

  /**
   * The same keys as the demo desk.
   *
   * They existed only on paper, which made live mode quietly worse to use than the practice
   * mode. `a`/Enter opens, `[` and `]` walk the band, exactly as they do next door.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Never steal a keystroke someone is typing into a field.
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;

      if (e.key === "a" || e.key === "A" || e.key === "Enter") {
        e.preventDefault();
        void doFire();
      } else if (e.key === "[") {
        band.nudge(-0.08);
      } else if (e.key === "]") {
        band.nudge(0.08);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doFire, band]);

  if (state.unavailable) {
    return (
      <div className="tiled grid min-h-dvh place-items-center px-4">
        <div className="w-full max-w-[420px] rounded-[26px] bg-card p-6 text-center">
          <h2 className="text-[22px] font-extrabold">Live mode is not up yet</h2>
          <p className="mt-3 text-[14px] leading-relaxed text-white/55">{state.unavailable}</p>
          <button
            onClick={onBackToDemo}
            className="mt-5 w-full rounded-full bg-amber-2 py-3.5 text-[14px] font-extrabold text-black"
          >
            BACK TO DEMO
          </button>
        </div>
      </div>
    );
  }

  // The coin stack reads the shielded balance, in whole STRK. Unknown is not zero.
  const coins = state.shielded === null ? 0 : Number(state.shielded / parseStrk(5));

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
          <div className="screen overflow-hidden rounded-[15px]">
            <StatusBar
              network={`STARKNET ${activeNetwork.name.toUpperCase()}`}
              connected={!state.error && state.spot > 0n}
              riding={state.positions.filter((p) => p.market && !p.market.isSettled).length}
            />

            {/* One fixed height, the same one the paper desk uses: switching between them
                must not resize the device in the reader's hand. */}
            {/*
              * One fixed height, and the region under the price is the one that flexes.
              *
              * The glass cannot grow — a handheld that changes size when a notice appears is
              * not a handheld — so something has to give when the live desk has more to say
              * than usual: no wallet, a settlement due, a claim waiting. The price stays
              * pinned and everything below it scrolls, which is the rule the positions
              * screen already follows.
              */}
            <div className="flex h-[421px] flex-col px-[11px] pb-[9px] pt-[11px]">
              <div className="flex flex-none items-start justify-between gap-2.5">
                <div>
                  <MarketChip
                    symbol={market.symbol}
                    tone={COIN_TONE[market.key] ?? "#f7931a"}
                    onClick={() => {
                      const i = MARKETS.findIndex((m) => m.key === market.key);
                      setMarketKey(MARKETS[(i + 1) % MARKETS.length].key);
                    }}
                  />
                  <div className="tnum mt-1 font-display text-[34px] font-bold leading-none text-white">
                    {state.spot > 0n ? fmtPrice(state.spot, market.dp) : "—"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="mono text-[9.5px] tracking-[0.15em] text-dim">SHIELDED</div>
                  <div className="tnum mt-1 text-[15px] font-semibold text-white">
                    {/* Unknown is shown as unknown. Rendering an unreadable balance as
                        "0.000 STRK" is a lie with a decimal point in it. */}
                    {state.shielded === null ? "—" : `${fmtStrk(state.shielded, 2)}`}
                  </div>
                </div>
              </div>

              <div className="mt-[9px] min-h-0 flex-1 overflow-y-auto">
          <div className="relative h-[206px]">
            {state.history.length > 1 && state.spot > 0n ? (
              <RangeChart
                market={market}
                history={state.history}
                spot={state.spot}
                low={band.low}
                high={band.high}
                multiplierBps={band.multiplierBps}
                progress={0}
                openBands={state.positions
                  .filter((p) => p.market && !p.market.isSettled)
                  .map((p) => ({ low: p.bandLow, high: p.bandHigh }))}
                onDragEdge={band.setEdge}
              />
            ) : (
              <div className="grid h-full place-items-center">
                <span className="label">
                  {state.error ? "chain unreachable" : "reading the chain"}
                </span>
              </div>
            )}
            {/* Surface chain trouble even once there is history to draw. A desk that keeps
                rendering a stale trace while the node fails underneath is showing a price
                nobody can act on. */}
            {state.error ? (
              <div className="mono pointer-events-none absolute inset-x-0 top-1 truncate px-2 text-center text-[9px] text-red">
                {state.error.slice(0, 90)}
              </div>
            ) : null}

            {flash ? (
              <div className="pop mono pointer-events-none absolute inset-x-0 bottom-2 text-center text-[11px] text-amber">
                {flash}
              </div>
            ) : null}
          </div>

              <BandControl
                widthPct={widthPct}
                onNudge={(d) => band.nudge(d)}
                label={reachLabel}
                disabled={!band.ready}
                atMin={atMinBand}
                atMax={atMaxBand}
                asymmetric={Boolean(halves && halves[0] !== halves[1])}
              />

              <div className="mt-2 flex items-center justify-between border-t border-[#161616] pt-2">
                <span className="mono tnum text-[9px] tracking-[0.15em] text-dim">
                  {target ? `CLOSES IN ${fmtCountdown(target.cutoffAt - now)}` : "NO OPEN MARKET"}
                </span>
                <div className="flex gap-1">
                  {ROUND_SECONDS.map((seconds, i) => (
                    <button
                      key={seconds}
                      onClick={() => setTier(i)}
                      className={`mono rounded-md px-[9px] py-1 text-[10px] tracking-[0.06em] ${
                        i === tier ? "bg-amber text-black" : "text-dim hover:text-white"
                      }`}
                    >
                      {roundLabel(i)}
                    </button>
                  ))}
                </div>
              </div>

              {/*
                * No Starknet wallet at all, said once and permanently.
                *
                * Most people who open this will not have one, and the only thing the console
                * did about that was flash "NO STARKNET WALLET FOUND" for two and a half
                * seconds when they pressed a key — an error, in passing, for a situation
                * that is not the reader's mistake. Everything above this line is real chain
                * data and stays readable without a wallet; this says what is missing, what
                * fixes it, and offers the desk that needs nothing.
                */}
              {state.wallets.length === 0 && !state.connection ? (
                <div className="mt-2 rounded-[9px] border border-[#171717] bg-screen-2 px-[9px] py-2">
                  <p className="mono text-[9px] leading-[1.5] tracking-[0.08em] text-dim">
                    <span className="text-amber">NO STARKNET WALLET IN THIS BROWSER.</span>
                    <br />
                    EVERYTHING ABOVE IS READ FROM THE CHAIN AND NEEDS NONE.
                  </p>
                  <div className="mt-2 flex gap-1">
                    <a
                      href="https://www.argent.xyz/argent-x"
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mono flex-1 rounded-md bg-white/8 py-1.5 text-center text-[9px] tracking-[0.08em] text-white/70"
                    >
                      GET ARGENT X
                    </a>
                    <a
                      href="https://braavos.app"
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mono flex-1 rounded-md bg-white/8 py-1.5 text-center text-[9px] tracking-[0.08em] text-white/70"
                    >
                      GET BRAAVOS
                    </a>
                    <button
                      onClick={onBackToDemo}
                      className="mono flex-1 rounded-md bg-amber/15 py-1.5 text-[9px] tracking-[0.08em] text-amber"
                    >
                      DEMO DESK
                    </button>
                  </div>
                </div>
              ) : null}

                  <p className="mono mt-2 text-[9px] leading-[1.45] tracking-[0.08em] text-dim">
                {/*
                  * What is actually hidden depends on the route, and there is no route until
                  * a wallet is connected.
                  *
                  * Saying "your band and size stay hidden" on a direct trade would be a lie
                  * printed on the screen the trade is made from. Saying it with no wallet at
                  * all was a smaller version of the same thing: a promise about a route
                  * nobody had chosen yet, and one a non-STRK20 wallet would not get. With no
                  * connection this states what the deployment offers instead of what "your"
                  * trade will do.
                  */}
                {!route
                  ? state.directRoute === false
                    ? "POOL ONLY HERE · A STRK20 WALLET HIDES YOU, THE SIZE AND THE BAND."
                    : "CONNECT A WALLET TO SEE WHICH ROUTE YOU GET."
                  : route === "direct"
                    ? "YOUR BAND STAYS HIDDEN."
                    : "YOUR BAND AND SIZE STAY HIDDEN."}
                <br />
                {roundLabel(tier).toUpperCase()} ROUND ·{" "}
                {state.connection ? shortAddress(state.connection.address, 6, 4) : "NOT CONNECTED"}
              </p>

              {/* The route picker.
                  *
                  * Shown as two keys rather than a toggle because they are not more and less
                  * of one thing: one hides three facts and the other hides one, and a trader
                  * should be choosing between them knowingly. Only offered when the wallet can
                  * actually take both — a disabled button explaining a capability nobody asked
                  * about is noise on a screen this small. */}
              {routes.length > 1 ? (
                <div className="mt-2 flex gap-1">
                  {(["pool", "direct"] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setRoutePref(r)}
                      title={live.routeNote(r, state.connection)}
                      className={`mono flex-1 rounded px-1.5 py-1 text-[9px] tracking-[0.08em] ${
                        route === r ? "bg-amber text-black" : "bg-white/8 text-dim hover:text-white"
                      }`}
                    >
                      {r === "pool" ? "VIA POOL" : "DIRECT"}
                    </button>
                  ))}
                </div>
              ) : route ? (
                /* Only one route available — say which, and what it means. The pool-only case
                   used to render nothing at all, so a trader on a privacy wallet got no
                   confirmation that the private path was the one being used. That is the
                   single fact this product exists to tell them. */
                <p
                  className="mono mt-2 text-[9px] leading-[1.45] tracking-[0.08em] text-white/30"
                  title={live.routeNote(route, state.connection)}
                >
                  {route === "pool"
                    ? "VIA THE STRK20 POOL · NOT YOU, NOT THE SIZE, NOT THE BAND"
                    : "DIRECT ROUTE · THE CHAIN SEES THE STAKE, NEVER THE BAND"}
                </p>
              ) : null}

              {/* Settlement is permissionless: the contract lets anyone poke an expired
                  market, and a desk that only ever settles its own quietly implies otherwise. */}
              {state.dueMarkets.length > 0 ? (
                <button
                  onClick={() =>
                    void (async () => {
                      if (!(await readyToAct())) return;
                      await live
                        .settle(state.dueMarkets[0].id)
                        .then((h) => {
                          play("key");
                          say(`SETTLED · ${h.slice(0, 10)}…`);
                        })
                        .catch((e) => {
                          play("reject");
                          say(errorFlash(e));
                        });
                    })()
                  }
                  disabled={Boolean(state.pending)}
                  title="Anyone may settle an expired market, not only its participants"
                  className="mono mt-2 w-full rounded-lg bg-white/8 py-1.5 text-[9px] tracking-[0.08em] text-amber disabled:opacity-40"
                >
                  SETTLE {state.dueMarkets[0].pair} · {state.dueMarkets.length} DUE
                </button>
              ) : null}

              {claimable.length > 0 ? (
                <button
                  onClick={() =>
                    void (async () => {
                      if (!(await readyToAct())) return;
                      await live
                        .claim(claimable[0])
                        .then((h) => {
                          // A claim is the only moment on this desk that pays, so it gets
                          // the voice that says so rather than a key click.
                          play("win", 1);
                          say(`CLAIMED · ${h.slice(0, 10)}…`);
                        })
                        .catch((e) => {
                          play("reject");
                          say(errorFlash(e));
                        });
                    })()
                  }
                  disabled={Boolean(state.pending)}
                  className="mono mt-2 w-full rounded-lg bg-green/15 py-1.5 text-[9px] tracking-[0.08em] text-green disabled:opacity-40"
                >
                  CLAIM {claimable.length} WINNING POSITION{claimable.length > 1 ? "S" : ""}
                </button>
              ) : null}
              </div>
            </div>
          </div>
        }
        deck={
          <div className="mt-[9px] grid grid-cols-[1fr_112px] items-stretch gap-[9px]">
            <div className="flex min-w-0 flex-col gap-[9px]">
              {/* Flexes, so the left column always matches the control rail beside it. */}
              <div className="recess flex flex-1 rounded-[18px] p-2">
                <div className="screen flex-1 rounded-xl px-3 pb-3 pt-[11px]">
                  <div className="flex items-baseline justify-between">
                    <span className="label">Pays</span>
                    <span className="tnum text-[13px] text-white">
                      {fmtStake(stake)} <span className="text-dim">→</span>{" "}
                      <span className="text-green">
                        {band.ready ? fmtStrk(payoutFor(stake, band.multiplierBps), 2) : "—"}
                      </span>
                    </span>
                  </div>
                  <div className="tnum glow-amber mt-1 text-[34px] font-bold leading-none text-amber">
                    {band.ready ? fmtMultiplier(band.multiplierBps) : "—"}
                  </div>
                  {/* The desk's own limit, shown only when it actually binds. A market that can
                      cover the whole rail has nothing to say here, and a permanent line reading
                      "capacity: plenty" is furniture. */}
                  {band.ready
                    ? (() => {
                        const why = whyThisBand(
                          band.band,
                          market.rounds[tier].sigma1e4,
                          band.prob1e6,
                          roundLabel(tier),
                          market.symbol,
                        );
                        return why ? (
                          <p className="mono mt-1.5 text-[9px] leading-[1.45] tracking-[0.08em] text-dim">
                            {why}
                          </p>
                        ) : null;
                      })()
                    : null}
                  {capacity !== null && capacity < STAKE_STEPS[STAKE_STEPS.length - 1] ? (
                    <p className="mono mt-1.5 text-[9px] leading-[1.45] tracking-[0.08em] text-amber-2/60">
                      {capacity > 0n
                        ? `DESK COVERS ${fmtStake(capacity)} STRK AT THIS BAND`
                        : "DESK IS FULL — NO SIZE AVAILABLE AT THIS BAND"}
                    </p>
                  ) : null}
                </div>
              </div>

              <KeyFrame className="flex gap-[7px]">
                <BlueKey label="DEMO" onClick={onBackToDemo} />
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
                  value={Math.min(stakeStep, Math.max(ladder.length, 1))}
                  max={Math.max(ladder.length, 1)}
                  onChange={setStakeStep}
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
                  onClick={() => void doFire()}
                  disabled={
                    Boolean(state.pending) ||
                    (Boolean(state.connection) && (!band.ready || !target))
                  }
                  armed={state.positions.some((p) => p.market && !p.market.isSettled)}
                />
              </div>
            </div>
          </div>
        }
        footer={
          <div className="mt-[11px] flex items-stretch gap-2.5 px-[3px] pb-[3px]">
            <div className="flex gap-3">
              <DeckKey
                label={state.connection ? "OPEN" : "CONNECT"}
                onClick={() => void doFire()}
              />
              <DeckKey label="HOME" onClick={() => router.push("/")} />
            </div>
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
                  {fmtStake(stake)}
                </div>
              </div>
              <div className="mono tnum flex-none text-right text-[9.5px] leading-[1.6] text-dim">
                <div>▲ {ladder[stakeStep] ? fmtStake(ladder[stakeStep]) : "—"}</div>
                <div>▼ {ladder[stakeStep - 2] ? fmtStake(ladder[stakeStep - 2]) : "—"}</div>
              </div>
            </div>
          </div>
        }
      />

      {state.lastTx ? (
        <p className="mono pb-6 text-center text-[10px] text-white/40">
          {state.lastTx.label}{" "}
          {explorerTx(state.lastTx.hash) ? (
            <a
              href={explorerTx(state.lastTx.hash)!}
              target="_blank"
              rel="noreferrer noopener"
              className="text-amber underline"
            >
              {state.lastTx.hash.slice(0, 18)}…
            </a>
          ) : (
            <span className="text-amber">{state.lastTx.hash.slice(0, 18)}…</span>
          )}
          {/*
            * A link to the market, not to the transaction.
            *
            * The explorer link proves a transaction happened; this one shows what the
            * market did, recomputed from published data for whoever opens it. That is the
            * shareable artifact — a screenshot of a result is a claim, and this is the
            * chain answering for itself.
            */}
          {target ? (
            <>
              {" · "}
              <a href={`/m/${target.id}`} className="text-white/60 underline">
                verify market #{target.id}
              </a>
            </>
          ) : null}
        </p>
      ) : (
        <p className="mono pb-6 text-center text-[10px] text-white/25">
          market {ADDRESSES.market ? shortAddress(ADDRESSES.market, 10, 4) : "not deployed"}
        </p>
      )}
    </div>
  );
}
