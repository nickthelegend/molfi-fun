"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MARKETS,
  ROUND_BLOCKS,
  fmtMultiplier,
  fmtPrice,
  fmtUsd,
  payoutFor,
  roundLabel,
} from "@molfi/sdk";
import { useLiveDesk } from "@/lib/useLiveDesk";
import { useBand } from "@/lib/useBand";
import { ADDRESSES, LIVE_CONFIGURED, activeChain } from "@/lib/chain";
import { DeviceFrame } from "./device/DeviceFrame";
import { RangeChart } from "./device/RangeChart";
import { HouseBattery } from "./device/HouseBattery";
import { BlueKey, CoinKey, CoinStack, DeckKey, FireKey } from "./device/Controls";

const STAKE_STEPS = [1_000_000n, 1_500_000n, 2_000_000n, 3_000_000n, 5_000_000n, 10_000_000n];
const COIN_TONE: Record<string, string> = { BTC: "#f7931a", ETH: "#8098ee", MON: "#836ef9" };

/**
 * The same console, wired to the chain. Block height, oracle print, quote, house
 * utilisation and the player's tickets are all read from the deployed contracts —
 * nothing here is simulated. Firing and settling are real transactions, and a dead RPC
 * says so rather than quietly falling back to invented numbers.
 */
export function LiveConsole({ onBackToDemo }: { onBackToDemo: () => void }) {
  const router = useRouter();
  const [marketKey, setMarketKey] = useState("BTC");
  const [tier, setTier] = useState(2);
  const [stakeStep, setStakeStep] = useState(2);
  const [sound, setSound] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const market = useMemo(() => MARKETS.find((m) => m.key === marketKey) ?? MARKETS[0], [marketKey]);
  const live = useLiveDesk(market, tier);
  const { state } = live;
  // Pass the real spot, including zero before the first read lands. Substituting a
  // placeholder price to avoid a divide-by-zero produces a legal-looking but nonsense
  // band window, and the band then sticks at maximum width once the real price arrives.
  const band = useBand(market, tier, state.spot);
  const stake = STAKE_STEPS[stakeStep - 1];

  const say = useCallback((m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(null), 2600);
  }, []);

  /**
   * Anyone can poke an expired ticket, so the console shows the whole queue.
   *
   * The market's own due tickets, whoever opened them — settlement is permissionless
   * and a desk that only ever settles its own quietly implies it is not.
   */
  const due = state.dueTickets;

  /** The newest ticket this account owns, for the shareable permalink. */
  const latestTicket =
    state.tickets.length > 0
      ? state.tickets.reduce((a, b) => (b.id > a.id ? b : a)).id.toString()
      : null;

  // Anyone can poke an expired ticket; the console pokes its own.
  const dueId = state.tickets.find(
    (t) => t.status === 0 && Number(state.block) >= t.expiryBlock,
  )?.id;

  /**
   * Poke each expired ticket once, not once per render.
   *
   * `live` is a fresh object every render, so an effect that depends on it re-runs
   * constantly — and each run enqueued another settle for the same ticket. With one
   * transaction at a time that backlog is unbounded, and anything the player then asks
   * for waits behind it. Remember which ids have been attempted and let a real failure
   * be surfaced once rather than retried forever; the keeper is the thing whose job it
   * is to keep trying.
   */
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    if (dueId === undefined || state.pending) return;
    const key = String(dueId);
    if (attempted.current.has(key)) return;
    attempted.current.add(key);
    void live.settle(dueId).catch((e) => say(String((e as Error).message).slice(0, 60)));
  }, [dueId, state.pending, live, say]);

  const doFire = useCallback(async () => {
    if (!state.account) {
      await live.connect();
      return;
    }
    if (!band.band) return;
    try {
      // Send the band's shape, not its endpoints — the contract centres it on the
      // print at execution, so a price that moves in the meantime cannot invalidate it.
      const hash = await live.fire(band.band.lowHalf1e4, band.band.highHalf1e4, stake);
      say(`FIRED ${hash.slice(0, 10)}…`);
    } catch (e) {
      say(String((e as Error).message).split("\n")[0].slice(0, 60));
    }
  }, [state.account, live, band.band, stake, say]);

  /**
   * The same keys as the demo desk.
   *
   * They existed only on paper, which made live mode quietly worse to use than the
   * practice mode — and on a three-second round, reaching for the mouse is the
   * difference between the band you painted and the band you got. `a`/Enter fires,
   * `[` and `]` walk the band, exactly as they do next door.
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

  if (!LIVE_CONFIGURED) {
    return (
      <div className="tiled grid min-h-dvh place-items-center px-4">
        <div className="w-full max-w-[420px] rounded-[26px] bg-card p-6 text-center">
          <h2 className="text-[22px] font-extrabold">No deployment configured</h2>
          <p className="mt-3 text-[14px] leading-relaxed text-white/55">
            Live mode needs contract addresses. Deploy and set NEXT_PUBLIC_RANGE_MARKET
            and NEXT_PUBLIC_AUSD — or keep playing the demo, which runs identical pricing.
          </p>
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

  const coins = Math.round(Number(state.balance) / 25_000_000);

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
                Live · {market.symbol} · {activeChain.name}
              </div>
              <div className="tnum mt-1 text-[30px] font-bold leading-none text-white">
                {state.spot > 0n ? fmtPrice(state.spot, market.dp) : "—"}
              </div>
            </div>
            <div className="text-right">
              <div className="label">Available</div>
              <div className="tnum mt-1 text-[15px] font-semibold text-white">
                {fmtUsd(state.balance)}
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
                openBands={state.tickets
                  .filter((t) => t.status === 0)
                  .map((t) => ({ low: t.low, high: t.high }))}
                onDragEdge={band.setEdge}
              />
            ) : (
              <div className="grid h-full place-items-center">
                <span className="label">
                  {state.error ? "chain unreachable" : "reading the chain"}
                </span>
              </div>
            )}
            {/* Surface chain trouble even once there is history to draw. A desk that
                keeps rendering a stale trace while the node is failing underneath is
                showing a price nobody can act on. */}
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
            <div className="flex items-center gap-3">
              <span className="label tnum">blk {state.block.toString()}</span>
              <HouseBattery utilisationBps={state.utilisationBps} />
            </div>
            <div className="flex gap-1">
              {ROUND_BLOCKS.map((b, i) => (
                <button
                  key={b}
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
                {fmtUsd(stake)} <span className="text-dim">→</span>{" "}
                <span className="text-green">
                  {band.ready ? fmtUsd(payoutFor(stake, band.multiplierBps)) : "—"}
                </span>
              </span>
            </div>
            <div className="tnum glow-amber mt-1 text-[34px] font-bold leading-none text-amber">
              {band.ready ? fmtMultiplier(band.multiplierBps) : "—"}
            </div>
            <p className="mono mt-2 text-[9px] leading-[1.45] tracking-[0.08em] text-dim">
              SETTLEMENT IS A PUBLIC TX.
              <br />
              {market.rounds[tier].seconds}S ROUND ·{" "}
              {state.account ? `${state.account.slice(0, 6)}…` : "NOT CONNECTED"}
            </p>

            {due.length > 0 ? (
              <button
                onClick={() =>
                  void live
                    .settleAllDue(due.map((t) => t.id))
                    .then((h) => say(`SETTLED ${due.length} · ${h.slice(0, 10)}…`))
                    .catch((e) =>
                      say(String((e as Error).message).split("\n")[0].slice(0, 60)),
                    )
                }
                disabled={Boolean(state.pending)}
                title="settleBatch — the contract lets anyone settle an expired ticket, not only its owner"
                className="mono mt-2 w-full rounded-lg bg-white/8 py-1.5 text-[9px] tracking-[0.08em] text-amber disabled:opacity-40"
              >
                SETTLE {due.length} DUE FOR THE MARKET
              </button>
            ) : null}
          </div>
          <FireKey
            onClick={() => void doFire()}
            disabled={Boolean(state.pending) || (Boolean(state.account) && !band.ready)}
          />
        </div>

        <div className="mt-2 flex items-stretch gap-2">
          <BlueKey onClick={onBackToDemo}>DEMO</BlueKey>
          <CoinKey
            symbol={market.symbol}
            tone={COIN_TONE[market.key] ?? "#f7931a"}
            onClick={() => {
              const liveMarkets = MARKETS.filter((m) => m.live);
              const i = liveMarkets.findIndex((m) => m.key === market.key);
              setMarketKey(liveMarkets[(i + 1) % liveMarkets.length].key);
            }}
          />
          <CoinStack count={coins} />
        </div>

        <div className="mt-3 flex items-end justify-between px-1 pb-1">
          <div className="flex gap-3">
            <DeckKey
              label={state.account ? "FIRE" : "CONNECT"}
              onClick={() => void doFire()}
            />
            <DeckKey label="HOME" onClick={() => router.push("/")} />
          </div>
          <div className="tnum rounded-lg bg-black px-3 py-2 text-[15px] font-semibold text-white">
            {fmtUsd(stake, Number(stake) % 1_000_000 === 0 ? 0 : 1)}
          </div>
        </div>
      </DeviceFrame>

      {state.lastTx ? (
        <p className="mono pb-6 text-center text-[10px] text-white/40">
          {state.lastTx.label}{" "}
          {live.explorerTx(state.lastTx.hash) ? (
            <a
              href={live.explorerTx(state.lastTx.hash)!}
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
            * A link to the ticket itself, not to the transaction.
            *
            * The explorer link proves the transaction happened; this one shows what it
            * produced, rendered from the contract for whoever opens it. That is the
            * shareable artifact — a screenshot of a result is a claim, and this is the
            * chain answering for itself.
            */}
          {latestTicket ? (
            <>
              {" · "}
              <a href={`/t/${latestTicket}`} className="text-white/60 underline">
                ticket #{latestTicket}
              </a>
            </>
          ) : null}
        </p>
      ) : (
        <p className="mono pb-6 text-center text-[10px] text-white/25">
          market {ADDRESSES.rangeMarket?.slice(0, 12)}…
        </p>
      )}
    </div>
  );
}
