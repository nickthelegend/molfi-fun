"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MARKETS,
  ROUND_SECONDS,
  fmtCountdown,
  fmtMultiplier,
  fmtPrice,
  fmtStrk,
  parseStrk,
  payoutFor,
  roundLabel,
} from "@molfi/sdk";
import { useLiveDesk, type LiveMarket } from "@/lib/useLiveDesk";
import { useBand } from "@/lib/useBand";
import { ADDRESSES, activeNetwork, explorerTx, shortAddress } from "@/lib/chain";
import { DeviceFrame } from "./device/DeviceFrame";
import { RangeChart } from "./device/RangeChart";
import { BlueKey, CoinKey, CoinStack, DeckKey, FireKey } from "./device/Controls";

/** Stakes the deck offers, in whole STRK. */
const STAKE_STEPS = [1, 2, 5, 10, 25, 50].map((n) => parseStrk(n));
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
  const [sound, setSound] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

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
  const stake = STAKE_STEPS[stakeStep - 1];

  const say = useCallback((m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(null), 2600);
  }, []);

  const now = Math.floor(Date.now() / 1000);

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

  const claimable = state.positions.filter((p) => p.won === true && !p.claimedTxHash);

  const doFire = useCallback(async () => {
    if (!state.connection) {
      const wallet = state.wallets[0];
      if (!wallet) {
        say("NO PRIVACY WALLET FOUND");
        return;
      }
      await live.connect(wallet).catch((e) => say(String((e as Error).message).slice(0, 60)));
      return;
    }
    if (state.blocked) {
      say(state.blocked.slice(0, 60).toUpperCase());
      return;
    }
    if (!band.band || !target) return;
    try {
      const hash = await live.fire(target.id, band.low, band.high, stake);
      say(`OPENED ${hash.slice(0, 10)}…`);
    } catch (e) {
      say(String((e as Error).message).split("\n")[0].slice(0, 60));
    }
  }, [state.connection, state.wallets, state.blocked, live, band.band, band.low, band.high, target, stake, say]);

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
        stakeStep={stakeStep}
        maxStake={STAKE_STEPS.length}
        onStakeStep={setStakeStep}
        soundOn={sound}
        onToggleSound={() => setSound((s) => !s)}
        running
        onToggleRunning={() => {}}
      >
        <div className="screen rounded-xl px-4 pb-2 pt-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="label">
                Live · {market.symbol} · Starknet {activeNetwork.name}
              </div>
              <div className="tnum mt-1 text-[30px] font-bold leading-none text-white">
                {state.spot > 0n ? fmtPrice(state.spot, market.dp) : "—"}
              </div>
            </div>
            <div className="text-right">
              <div className="label">Shielded</div>
              <div className="tnum mt-1 text-[15px] font-semibold text-white">
                {/* Unknown is shown as unknown. Rendering an unreadable balance as
                    "0.000 STRK" is a lie with a decimal point in it. */}
                {state.shielded === null ? "—" : `${fmtStrk(state.shielded, 2)}`}
              </div>
            </div>
          </div>

          <div className="relative mt-3 h-[228px]">
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

          <div className="mt-1 flex items-center justify-between border-t border-[#161616] pt-2">
            <span className="label tnum">
              {target ? `closes in ${fmtCountdown(target.cutoffAt - now)}` : "no open market"}
            </span>
            <div className="flex gap-1">
              {ROUND_SECONDS.map((seconds, i) => (
                <button
                  key={seconds}
                  onClick={() => setTier(i)}
                  className={`mono rounded px-1.5 py-0.5 text-[10px] ${
                    i === tier ? "bg-amber text-black" : "text-dim hover:text-white"
                  }`}
                >
                  {roundLabel(i)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-2 flex gap-2">
          <div className="screen flex-1 rounded-xl px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="label">Pays</span>
              <span className="tnum text-[13px] text-white">
                {fmtStrk(stake, 0)} <span className="text-dim">→</span>{" "}
                <span className="text-green">
                  {band.ready ? fmtStrk(payoutFor(stake, band.multiplierBps), 2) : "—"}
                </span>
              </span>
            </div>
            <div className="tnum glow-amber mt-1 text-[34px] font-bold leading-none text-amber">
              {band.ready ? fmtMultiplier(band.multiplierBps) : "—"}
            </div>
            <p className="mono mt-2 text-[9px] leading-[1.45] tracking-[0.08em] text-dim">
              YOUR BAND AND SIZE STAY HIDDEN.
              <br />
              {roundLabel(tier).toUpperCase()} ROUND ·{" "}
              {state.connection ? shortAddress(state.connection.address, 6, 4) : "NOT CONNECTED"}
            </p>

            {/* Settlement is permissionless: the contract lets anyone poke an expired
                market, and a desk that only ever settles its own quietly implies otherwise. */}
            {state.dueMarkets.length > 0 ? (
              <button
                onClick={() =>
                  void live
                    .settle(state.dueMarkets[0].id)
                    .then((h) => say(`SETTLED · ${h.slice(0, 10)}…`))
                    .catch((e) => say(String((e as Error).message).split("\n")[0].slice(0, 60)))
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
                  void live
                    .claim(claimable[0])
                    .then((h) => say(`CLAIMED · ${h.slice(0, 10)}…`))
                    .catch((e) => say(String((e as Error).message).split("\n")[0].slice(0, 60)))
                }
                disabled={Boolean(state.pending)}
                className="mono mt-2 w-full rounded-lg bg-green/15 py-1.5 text-[9px] tracking-[0.08em] text-green disabled:opacity-40"
              >
                CLAIM {claimable.length} WINNING POSITION{claimable.length > 1 ? "S" : ""}
              </button>
            ) : null}
          </div>
          <FireKey
            onClick={() => void doFire()}
            disabled={
              Boolean(state.pending) ||
              (Boolean(state.connection) && (!band.ready || !target))
            }
          />
        </div>

        <div className="mt-2 flex items-stretch gap-2">
          <BlueKey onClick={onBackToDemo}>DEMO</BlueKey>
          <CoinKey
            symbol={market.symbol}
            tone={COIN_TONE[market.key] ?? "#f7931a"}
            onClick={() => {
              const i = MARKETS.findIndex((m) => m.key === market.key);
              setMarketKey(MARKETS[(i + 1) % MARKETS.length].key);
            }}
          />
          <CoinStack count={coins} />
        </div>

        <div className="mt-3 flex items-end justify-between px-1 pb-1">
          <div className="flex gap-3">
            <DeckKey
              label={state.connection ? "OPEN" : "CONNECT"}
              onClick={() => void doFire()}
            />
            <DeckKey label="HOME" onClick={() => router.push("/")} />
          </div>
          <div className="tnum rounded-lg bg-black px-3 py-2 text-[15px] font-semibold text-white">
            {fmtStrk(stake, 0)}
          </div>
        </div>
      </DeviceFrame>

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
