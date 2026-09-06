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
  outcomeOf,
  parseStrk,
  payoutFor,
  roundLabel,
} from "@molfi/sdk";
import { useLiveDesk, type LiveMarket } from "@/lib/useLiveDesk";
import { errorText } from "@/lib/pool";
import type { Route } from "@/lib/wallet";
import type { Wallet } from "@/components/PrivyGate";
import type { PrivySigner } from "@/lib/privy-signer";
import { useBand } from "@/lib/useBand";
import { useRounds } from "@/lib/useRounds";
import { GameSwitch, type Game } from "./device/GameSwitch";
import { usePrefs } from "@/lib/usePrefs";
import { MenuSheet } from "./menu/MenuSheet";
import { useSound } from "@/lib/useSound";
import { ADDRESSES, activeNetwork, explorerTx, shortAddress } from "@/lib/chain";
import { DeviceFrame } from "./device/DeviceFrame";
import { RangeChart } from "./device/RangeChart";
import { BandControl } from "./device/BandControl";
import { StatusBar } from "./device/StatusBar";
import { Knob } from "./device/Knob";
import { BlueKey, DeckKey, FireKey, KeyFrame, MarketChip } from "./device/Controls";
import { isDirection } from "@/lib/positions";

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

/**
 * The height of the deck's control column, in pixels.
 *
 * A single number both games are laid out against, so switching between them cannot move the
 * keys under the reader's thumb. It is the taller arrangement's natural height — a knob box
 * over a 96px fire key with the frame padding and gap around them.
 */
const DECK_COLUMN_H = 261;

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
export function LiveConsole({
  wallet: privyWallet,
  signer,
}: {
  /** The Privy account, when the visitor came through the gate rather than an extension. */
  wallet?: Wallet;
  signer?: PrivySigner;
}) {
  const router = useRouter();
  const [marketKey, setMarketKey] = useState("BTC");
  const [tier, setTier] = useState(0);
  const [game, setGame] = useState<Game>("range");
  const [picked, setPicked] = useState<"up" | "down">("up");
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
  /**
   * The menu, which the live desk never had.
   *
   * Shield, withdraw, your positions, and the export/import that is the only way to recover
   * a payout all live behind it — and `MenuSheet` has always taken a `live` prop for exactly
   * this, which nothing ever passed. The result was that the pool interaction screens could
   * only be reached from the demo desk, where they correctly report there is no pool.
   */
  const [menuOpen, setMenuOpen] = useState(false);

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

  /**
   * The direction game's rounds. Read here, beside the band, because the deck quotes from
   * whichever of the two the switch is on and both have to be in hand before it can.
   */
  const rounds = useRounds(market.label);


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

  /**
   * A direction ticket's round, by id.
   *
   * `useLiveDesk` deliberately leaves `market` null on a direction position — the ticket
   * belongs to a round on the other contract, and guessing a market for it would attach the
   * wrong settlement price to somebody's trade. The console is where the two meet, because
   * this is the only place that has both the stored positions and the round list.
   */
  const roundOf = useCallback(
    (id: number) => rounds.rounds.find((r) => r.id === id) ?? null,
    [rounds.rounds],
  );

  /**
   * Positions still riding, on either game.
   *
   * This used to be `p.market && !p.market.isSettled`, which cannot ever count a direction
   * ticket: a direction position has no market by construction, so the condition is false for
   * every one of them. A trader who had just opened one watched the desk report `0 RIDING`
   * with their stake on chain and a transaction hash on screen — the one number on the
   * chassis that says "you have something at stake" reading zero while they did.
   */
  const riding = useMemo(
    () =>
      state.positions.filter((p) => {
        /**
         * A ticket the chain says does not exist is not riding, whatever the store thinks.
         *
         * A trade that fails after the wallet has taken it is saved deliberately — it may
         * have landed, and a stake with no local secret is unclaimable — so the store holds
         * attempts as well as trades. That is the right thing to store and the wrong thing to
         * count: three failed presses left three saved tickets on a round that never sold
         * one, and every one of them would show as riding.
         *
         * `false` is the chain's answer and is trusted. `null` is "not read yet", which is
         * not the same claim — an unread position stays counted rather than blinking out of
         * existence every time a read is slow.
         */
        if (p.onChain?.exists === false) return false;
        if (isDirection(p)) {
          const r = roundOf(p.roundId);
          return r ? !r.isSettled : false;
        }
        return p.market ? !p.market.isSettled : false;
      }).length,
    [state.positions, roundOf],
  );

  /**
   * The one quote the deck prints, whichever game is selected.
   *
   * The Pays panel used to read `band` unconditionally. On the direction game that meant the
   * header said "EITHER WAY 1.92x" from the round while the number under it said 1.25x from
   * a band nobody had chosen — two different prices for the same key, on the same screen,
   * three centimetres apart. Whichever a trader believed, one of them was wrong.
   *
   * Both games really do quote the same shape — a multiplier in basis points and whether it
   * is known yet — so this is a swap rather than a second panel. The direction multiplier is
   * the round's own `multiplier_bps`, read from the contract that will pay it out; there is
   * nothing to compute in the browser and nothing that can drift from what settles.
   */
  const quote = useMemo(() => {
    if (game === "direction") {
      const r = rounds.open;
      return {
        ready: r !== null,
        multiplierBps: r ? BigInt(r.multiplierBps) : 0n,
        /** No band is chosen on this game, so nothing here binds on band width. */
        capacityAtQuote: r ? BigInt(r.bankroll) - BigInt(r.reserved) : null,
      };
    }
    return { ready: band.ready, multiplierBps: band.multiplierBps, capacityAtQuote: null };
  }, [game, rounds.open, band.ready, band.multiplierBps]);

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
      /**
       * Privy first, an extension second.
       *
       * A visitor who reached this screen signed in, so molfi already holds a Starknet
       * account for them — asking them to install a browser extension as well would be asking
       * for a second wallet to do what the first one can. An extension is still offered when
       * there is no Privy session, which is how someone who prefers their own keys connects.
       */
      if (privyWallet && signer) {
        await live
          .connectWithPrivy(
            privyWallet.publicKey,
            signer,
            // Only for an account that already exists; a Privy wallet's address is derived.
            privyWallet.deployed ? privyWallet.address : undefined,
          )
          .catch((e) => say(errorFlash(e)));
        return false;
      }
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

  /**
   * Firing a direction ticket, against the round the chain is actually offering.
   *
   * Split from `doFire` rather than branched inside it: almost nothing is shared. There is no
   * band to validate, no route to choose, and the target is a round on the other contract
   * rather than a market on this one — so the checks that matter are different checks.
   */
  const doFireDirection = useCallback(async (side: "up" | "down" = picked) => {
    if (!(await readyToAct())) return;
    const round = rounds.open;
    if (!round) {
      say(rounds.ready ? "NO OPEN ROUND" : "READING ROUNDS…");
      return;
    }
    if (BigInt(round.bankroll) === 0n) {
      // The contract refuses this by name; saying so first costs nobody a signature.
      say("ROUND HAS NO BANKROLL YET");
      return;
    }
    if (stake <= 0n) {
      say("NO SIZE");
      return;
    }
    try {
      const hash = await live.fireDirection(round.id, side, stake);
      play("fire");
      say(`OPENED ${side.toUpperCase()} ${hash.slice(0, 10)}…`);
    } catch (e) {
      play("reject");
      say(errorFlash(e));
    }
  }, [readyToAct, rounds.open, rounds.ready, live, picked, stake, say]);

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
        void (game === "direction" ? doFireDirection() : doFire());
      } else if (e.key === "[") {
        band.nudge(-0.08);
      } else if (e.key === "]") {
        band.nudge(0.08);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doFire, doFireDirection, game, band]);

  if (state.unavailable) {
    return (
      <div className="tiled grid min-h-dvh place-items-center px-4">
        <div className="w-full max-w-[420px] rounded-[26px] bg-card p-6 text-center">
          <h2 className="text-[22px] font-extrabold">Live mode is not up yet</h2>
          <p className="mt-3 text-[14px] leading-relaxed text-white/55">{state.unavailable}</p>
          {/* No "back to demo" — there is no demo to go back to. The honest offer when the
              chain is unreachable is to leave, not to be handed play money instead. */}
          <a
            href="/"
            className="mt-5 block w-full rounded-full bg-amber-2 py-3.5 text-[14px] font-extrabold text-black"
          >
            BACK
          </a>
        </div>
      </div>
    );
  }

  // The coin stack reads the shielded balance, in whole STRK. Unknown is not zero.
  const coins = state.shielded === null ? 0 : Number(state.shielded / parseStrk(5));

  return (
    <div className="tiled min-h-dvh">
      <DeviceFrame
        glass={
          <div className="screen overflow-hidden rounded-[15px]">
            <StatusBar
              network={`STARKNET ${activeNetwork.name.toUpperCase()}`}
              connected={!state.error && state.spot > 0n}
              riding={riding}
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
                /*
                 * The band is the range game's, so it is drawn only on the range game.
                 *
                 * On the direction game the chart was still painting a dashed band and a
                 * "NEXT 1.25x" label — furniture from the other game, showing a price that
                 * had nothing to do with the ticket the deck was about to sell, on the one
                 * surface a trader reads before committing. There is no band in this game;
                 * the chart now says so by not drawing one.
                 */
                low={game === "range" ? band.low : null}
                high={game === "range" ? band.high : null}
                multiplierBps={game === "range" ? band.multiplierBps : null}
                progress={0}
                /* Range positions only: a direction ticket has no band, and drawing one as a
                   zero-height rectangle at the reference is a line that means nothing. */
                openBands={state.positions
                  .flatMap((p) =>
                    p.market && !p.market.isSettled && !isDirection(p)
                      ? [{ low: p.bandLow, high: p.bandHigh }]
                      : [],
                  )}
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

              {/*
                * A fixed slot, so switching games does not move the deck.
                *
                * The band control is two rows tall and the direction game's price line is one,
                * so the whole console — the payout panel, the keys, the footer — jumped every
                * time the switch was pressed. On a handheld that reads as the device
                * rebuilding itself, and worse, the key you are reaching for is somewhere else
                * by the time your thumb lands. The taller of the two controls sets the height
                * and the shorter one sits inside it.
                */}
              <div className="flex h-[52px] flex-col justify-center">
              {game === "range" ? (
                <BandControl
                  widthPct={widthPct}
                  onNudge={(d) => band.nudge(d)}
                  label={reachLabel}
                  disabled={!band.ready}
                  atMin={atMinBand}
                  atMax={atMaxBand}
                  asymmetric={Boolean(halves && halves[0] !== halves[1])}
                />
              ) : (
                /*
                 * On the glass, the direction game shows its price and nothing else.
                 *
                 * The UP and DOWN keys used to live here, which put the most consequential
                 * choice on the device behind glass — a thing you look at — while the keys
                 * that do less sat on the deck under your thumbs. They are hardware now, in
                 * the slot the band knob occupies on the other game: one physical place that
                 * means "how you are betting", whichever game is loaded.
                 */
                <div className="flex items-center">
                  <span className="mono text-[9px] tracking-[0.12em] text-dim">
                    {/*
                      One price for both sides, which is the point: a different multiplier per
                      side would make the public reserve disclose which way a ticket went.
                    */}
                    {rounds.open
                      ? `EITHER WAY ${fmtMultiplier(BigInt(rounds.open.multiplierBps))} · PICK A SIDE ON THE DECK`
                      : rounds.ready
                        ? "NO OPEN ROUND"
                        : "READING…"}
                  </span>
                </div>
              )}
              </div>

              <div className="mt-2 flex items-center justify-between border-t border-[#161616] pt-2">
                <span className="mono tnum text-[9px] tracking-[0.15em] text-dim">
                  {game === "direction"
                    ? rounds.open
                      ? `CLOSES IN ${fmtCountdown(rounds.open.cutoffAt - now)}`
                      : "NO OPEN ROUND"
                    : target
                      ? `CLOSES IN ${fmtCountdown(target.cutoffAt - now)}`
                      : "NO OPEN MARKET"}
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
              {/*
                * Not shown to somebody who already has a wallet.
                *
                * The condition only asked about browser *extensions*, which was the whole
                * story before Privy. Now a visitor who signed in with an email has a real,
                * funded, deployed Starknet account — and was being told, on the same screen
                * that had just spent their money, that there was no wallet in this browser.
                * True of extensions, and completely wrong as a statement about them.
                */}
              {state.wallets.length === 0 && !state.connection && !privyWallet ? (
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
                {/*
                  * "Band" is the wrong noun on the direction game and the right one on the
                  * range game, and this line is the app's central promise — so it names what
                  * is actually sealed on the game the switch is on. A ticket commits to a
                  * side; the chain is told a hash and a stake and never which side, which is
                  * a different sentence from the one about a band, not a rewording of it.
                  */}
                {!route
                  ? state.directRoute === false
                    ? game === "direction"
                      ? "POOL ONLY HERE · A STRK20 WALLET HIDES YOU, THE SIZE AND THE SIDE."
                      : "POOL ONLY HERE · A STRK20 WALLET HIDES YOU, THE SIZE AND THE BAND."
                    : "CONNECT A WALLET TO SEE WHICH ROUTE YOU GET."
                  : game === "direction"
                    ? route === "direct"
                      ? "YOUR SIDE STAYS HIDDEN."
                      : "YOUR SIDE AND SIZE STAY HIDDEN."
                    : route === "direct"
                      ? "YOUR BAND STAYS HIDDEN."
                      : "YOUR BAND AND SIZE STAY HIDDEN."}
                <br />
                {/* The direction game's rounds are the contract's own, not the tier keys —
                    quoting the tier here would name a length this ticket does not have. */}
                {game === "direction"
                  ? rounds.open
                    ? `${Math.round(rounds.open.roundSeconds / 60)}M ROUND`
                    : "NO OPEN ROUND"
                  : `${roundLabel(tier).toUpperCase()} ROUND`}{" "}
                ·{" "}
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
                    ? game === "direction"
                      ? "VIA THE STRK20 POOL · NOT YOU, NOT THE SIZE, NOT THE SIDE"
                      : "VIA THE STRK20 POOL · NOT YOU, NOT THE SIZE, NOT THE BAND"
                    : game === "direction"
                      ? "DIRECT ROUTE · THE CHAIN SEES THE STAKE, NEVER THE SIDE"
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
                  {/*
                    * "Claimable", not "winning".
                    *
                    * On the direction game a tie refunds the stake, so it is something to
                    * claim without being something that won — and the button is offered for
                    * it, because a refund nobody claims is a refund nobody gets. Calling that
                    * a win would be the desk telling a trader they were right when the round
                    * did not move.
                    */}
                  CLAIM {claimable.length} POSITION{claimable.length > 1 ? "S" : ""}
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
                        {quote.ready ? fmtStrk(payoutFor(stake, quote.multiplierBps), 2) : "—"}
                      </span>
                    </span>
                  </div>
                  <div className="tnum glow-amber mt-1 text-[34px] font-bold leading-none text-amber">
                    {quote.ready ? fmtMultiplier(quote.multiplierBps) : "—"}
                  </div>
                  {/* The desk's own limit, shown only when it actually binds. A market that can
                      cover the whole rail has nothing to say here, and a permanent line reading
                      "capacity: plenty" is furniture. */}
                  {game === "direction" ? (
                    /**
                     * Why this number, on the direction game.
                     *
                     * The band explanation cannot be reused: it is a sentence about how much
                     * of a move a band covers, and there is no band here. What a trader needs
                     * to know instead is that the price is the same on both sides — which is
                     * not a courtesy, it is what stops the public `reserved` figure on the
                     * contract from revealing which way a ticket went.
                     */
                    rounds.open ? (
                      <p className="mono mt-1.5 text-[9px] leading-[1.45] tracking-[0.08em] text-dim">
                        {`SAME PRICE BOTH WAYS · ${(Number(rounds.open.multiplierBps) / 10_000).toFixed(2)}× UP OR DOWN · A TIE REFUNDS · LESS ${
                          Math.round((20_000 - Number(rounds.open.multiplierBps)) / 2 / 100 * 100) / 100
                        }% EDGE`}
                      </p>
                    ) : null
                  ) : band.ready
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

              {/*
                * The game switch, on the deck rather than on the glass.
                *
                * It was sitting inside the screen, above the controls — which made it look
                * like a readout of the market rather than a control of the device, and put
                * the one decision that changes what every other control *does* in the place
                * the eye reads last. It is hardware: it belongs on the deck, at the size of a
                * key, next to the keys it re-labels.
                *
                * It takes the slot the DEMO key had. That key led back to the paper desk from
                * a screen that is already the real one, which is a door out of the product
                * placed inside the product — the menu still has it for anyone who wants it.
                */}
              <KeyFrame>
                <GameSwitch game={game} onChange={setGame} />
              </KeyFrame>
            </div>

            {/*
              * One height for the control column, set once, whichever game is loaded.
              *
              * Range fills it with a knob and a fire key; direction fills it with two action
              * keys. Pinning the *column* rather than each game's contents is what makes them
              * agree — the previous attempt gave each mode its own minimum and they came out
              * 35px apart, so the chassis still resized under the switch. The deck is
              * hardware, and hardware does not change shape when you flip a mode selector.
              */}
            <div className="flex min-w-0 flex-col gap-[9px]" style={{ minHeight: DECK_COLUMN_H }}>
              <div
                className="flex flex-1 flex-col items-center rounded-[18px] p-2"
                style={{
                  background: "var(--color-frame)",
                  boxShadow:
                    "inset 0 2px 6px rgba(0,0,0,.85), inset 0 0 0 1px rgba(255,255,255,.05), 0 1px 0 rgba(255,255,255,.07)",
                }}
              >
                {/*
                  * One slot, two controls, because the two games need different things here.
                  *
                  * The range game has a size ladder to dial through. The direction game has
                  * no ladder to turn — it has a side to pick — and a knob left there in that
                  * mode is a control that looks live and does nothing to the bet you are
                  * about to place. So the slot carries whichever control the loaded game
                  * actually uses, and the keys sit directly above FIRE where the decision
                  * they make is the last one before it.
                  */}
                {game === "direction" ? (
                  /**
                   * On this game UP and DOWN *are* the action, so there is no separate key.
                   *
                   * There used to be a red diamond beside them and it was doing nothing the
                   * two keys did not already say. The sequence was: choose a side, then press
                   * an unrelated shape to mean "yes, that side" — two presses for one decision,
                   * and a colour that reads as danger sitting on the confirm step of a bet.
                   * Pressing UP takes the up side. That is the whole interaction.
                   *
                   * They are still two keys rather than one toggle because the choice and the
                   * commitment are the same act here; a toggle would make you aim twice.
                   */
                  <div className="flex h-full w-full flex-col gap-[9px] px-[2px] py-[2px]">
                    {(["up", "down"] as const).map((d) => (
                      <button
                        key={d}
                        onClick={() => {
                          setPicked(d);
                          void doFireDirection(d);
                        }}
                        disabled={
                          Boolean(state.pending) ||
                          (Boolean(state.connection) && !rounds.open)
                        }
                        aria-label={
                          state.connection
                            ? `Take the ${d} side for ${fmtStake(stake)} STRK`
                            : "Connect a wallet"
                        }
                        className={`key flex-1 rounded-[14px] text-[15px] font-extrabold tracking-tight transition-colors disabled:opacity-45 ${
                          d === "up" ? "bg-green text-black" : "bg-red text-white"
                        }`}
                      >
                        {d === "up" ? "▲ UP" : "▼ DOWN"}
                      </button>
                    ))}
                  </div>
                ) : (
                  <Knob
                    value={Math.min(stakeStep, Math.max(ladder.length, 1))}
                    max={Math.max(ladder.length, 1)}
                    onChange={setStakeStep}
                  />
                )}
              </div>

              {/*
                * The fire key belongs to the range game only.
                *
                * On the range game there is a band to shape and then a separate moment where
                * you commit to it, so a distinct key is the commitment. On the direction game
                * the side *is* the commitment — UP and DOWN above already send the trade — and
                * leaving the key here would mean one screen with two different things that
                * both look like "go".
                */}
              {game === "range" ? (
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
                    disabled={Boolean(state.pending) || (Boolean(state.connection) && (!band.ready || !target))}
                    armed={state.positions.some((p) => p.market && !p.market.isSettled)}
                  />
                </div>
              ) : null}
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
              <DeckKey label="MENU" onClick={() => setMenuOpen(true)} />
              <DeckKey label="HOME" onClick={() => router.push("/")} />
              {/* Mute, as one key among the others rather than a rail across the chassis. */}
              <DeckKey
                label={prefs.sound ? "SOUND" : "MUTED"}
                onClick={() => setPref("sound", !prefs.sound)}
              />
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

      {menuOpen ? (
        <MenuSheet
          onClose={() => setMenuOpen(false)}
          live={{
            connection: state.connection,
            wallets: state.wallets,
            shielded: state.shielded,
            positions: state.positions,
            pending: state.pending,
            connect: live.connect,
            disconnect: live.disconnect,
            shield: live.shield,
            unshield: live.unshield,
            claim: live.claim,
          }}
        />
      ) : null}

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
          {game === "direction" ? (
            /*
             * Named, not linked. `/m/:id` recomputes a **range** market, and pointing a
             * direction ticket at it would send someone to a page about a different trade
             * on a different contract that happens to share a number — worse than no link,
             * because it looks like verification. The round is named so it can be looked up
             * on the up/down contract; the explorer link above is the proof that stands.
             */
            rounds.open ? (
              <>
                {" · "}
                <span className="text-white/60">direction round #{rounds.open.id}</span>
              </>
            ) : null
          ) : target ? (
            <>
              {" · "}
              <a href={`/m/${target.id}`} className="text-white/60 underline">
                verify market #{target.id}
              </a>
            </>
          ) : null}
        </p>
      ) : (
        /* The contract this game's trades actually land in. The two games are two separate
           deployments, and printing the range market's address underneath a direction ticket
           pointed anyone checking the trade at a contract that never saw it. */
        (() => {
          const contract = game === "direction" ? ADDRESSES.upDownMarket : ADDRESSES.market;
          return (
            <p className="mono pb-6 text-center text-[10px] text-white/25">
              {game === "direction" ? "up/down" : "market"}{" "}
              {contract ? shortAddress(contract, 10, 4) : "not deployed"}
            </p>
          );
        })()
      )}
    </div>
  );
}
