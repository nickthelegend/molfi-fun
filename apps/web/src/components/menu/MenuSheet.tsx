"use client";

import { useState } from "react";
import { fmtUsd, type PaperTicket } from "@molfi/sdk";
import { Row, Sheet, Tile } from "./Sheet";
import type { Connection, StarknetWallet } from "@/lib/wallet";
import type { LivePosition } from "@/lib/useLiveDesk";
import { Leaderboard } from "./Leaderboard";
import { AddFunds } from "./AddFunds";
import { History } from "./History";
import { HowToBody } from "./HowToSheet";
import { Oracle } from "./Oracle";
import { Settings } from "./Settings";
import { Customize } from "./Customize";
import { Account } from "./Account";
import { Achievements } from "./Achievements";
import { Pool } from "./Pool";

/** What the menu needs from the live desk. Absent on the demo desk, which owns no chain. */
export interface LiveMenu {
  connection: Connection | null;
  wallets: StarknetWallet[];
  shielded: bigint | null;
  positions: LivePosition[];
  pending: string | null;
  connect: (wallet: StarknetWallet) => Promise<unknown>;
  disconnect: () => void;
  shield: (amount: bigint) => Promise<string>;
  unshield: (amount: bigint, to: string) => Promise<string>;
  claim: (p: LivePosition) => Promise<string>;
}

type View =
  | "menu"
  | "leaderboard"
  | "funds"
  | "history"
  | "howto"
  | "about"
  | "oracle"
  | "settings"
  | "customize"
  | "account"
  | "awards"
  | "pool";

export function MenuSheet({
  onClose,
  balance,
  tickets,
  pnl,
  onReset,
  onAttract,
  live,
}: {
  onClose: () => void;
  balance: bigint;
  tickets: PaperTicket[];
  pnl: bigint;
  onReset: () => void;
  /** Start attract mode: the desk plays itself until someone touches it. */
  onAttract?: () => void;
  /**
   * The chain, when there is one to talk to.
   *
   * Optional because the demo desk is a complete product on its own and must not require
   * a wallet, a node, or a deployment to open its own menu.
   */
  live?: LiveMenu;
}) {
  const [view, setView] = useState<View>("menu");
  const back = () => setView("menu");

  if (view === "leaderboard")
    return (
      <Sheet onClose={onClose} onBack={back} title="Leaderboard">
        <Leaderboard pnl={pnl} played={tickets.length > 0} />
      </Sheet>
    );

  if (view === "funds")
    return (
      <Sheet onClose={onClose} onBack={back} title="Add funds">
        <AddFunds address={live?.connection?.address ?? null} />
      </Sheet>
    );

  if (view === "history")
    return (
      <Sheet onClose={onClose} onBack={back} title="History">
        <History tickets={tickets} />
      </Sheet>
    );

  if (view === "oracle")
    return (
      <Sheet onClose={onClose} onBack={back} title="The oracle">
        <Oracle />
      </Sheet>
    );

  if (view === "settings")
    return (
      <Sheet onClose={onClose} onBack={back} title="Settings">
        <Settings />
      </Sheet>
    );

  if (view === "customize")
    return (
      <Sheet onClose={onClose} onBack={back} title="Customize">
        <Customize />
      </Sheet>
    );

  if (view === "account")
    return (
      <Sheet onClose={onClose} onBack={back} title="Account">
        <Account
          connection={live?.connection ?? null}
          wallets={live?.wallets ?? []}
          shielded={live?.shielded ?? null}
          onConnect={live?.connect ?? (async () => undefined)}
          onDisconnect={live?.disconnect ?? (() => undefined)}
        />
      </Sheet>
    );

  if (view === "pool")
    return (
      <Sheet onClose={onClose} onBack={back} title="The pool">
        {live ? (
          <Pool
            shielded={live.shielded}
            positions={live.positions}
            pending={live.pending}
            address={live.connection?.address ?? null}
            onShield={live.shield}
            onUnshield={live.unshield}
            onClaim={live.claim}
          />
        ) : (
          <p className="text-[14px] leading-relaxed text-white/55">
            You are on the demo desk. The balance here is paper, so there is no pool to
            shield into and nothing to withdraw. Switch to live to use real STRK.
          </p>
        )}
      </Sheet>
    );

  if (view === "awards")
    return (
      <Sheet onClose={onClose} onBack={back} title="Achievements">
        <Achievements tickets={tickets} />
      </Sheet>
    );

  if (view === "howto")
    return (
      <Sheet onClose={onClose} onBack={back} title="How it works">
        <HowToBody />
      </Sheet>
    );

  if (view === "about")
    return (
      <Sheet onClose={onClose} onBack={back} title="About molfi">
        <div className="space-y-4 text-[14px] leading-relaxed text-white/70">
          <p>
            molfi is a range console on Starknet. You pick a band around the price. If the
            price prints inside your band at the cutoff, you get paid the multiplier.
          </p>
          <p>
            Nobody can see which band you picked, or how much you staked, until you claim.
            The contract stores a <span className="text-white">hash</span> of your position
            and the pool never tells it who called — so on a public chain your order stops
            being a signal before it is a trade.
          </p>
          <p>
            The cutoff is a <span className="text-white">time</span>, not a block. What
            limits a round here is how often the oracle republishes, and Pragma publishes
            every few minutes — so the shortest round molfi can settle honestly is fifteen
            minutes, not three seconds.
          </p>
          <p>
            Stakes are STRK. Settlement is a public transaction anyone can verify, and
            anyone can settle an expired market — not just whoever opened a position in it.
          </p>
          <p className="text-white/45">
            Built for the STRK20 Private Sprint, on the Starknet privacy pool.
          </p>
        </div>
      </Sheet>
    );

  const played = tickets.length;

  return (
    <Sheet onClose={onClose} title="Menu">
      {/* ------------------------------------------------------------ profile */}
      <div className="flex items-center gap-3 rounded-2xl bg-[#161616] p-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-purple text-[17px] font-bold">
          X
        </span>
        <div className="min-w-0 flex-1">
          {/* No account system on the demo desk, so it says so rather than inventing a
              handle. The live console shows the connected address instead. */}
          <div className="truncate text-[15px] font-semibold">Demo desk</div>
          <p className="truncate text-[13px] text-white/45">
            {played === 0
              ? "No plays yet. Make your first play."
              : `${played} ${played === 1 ? "play" : "plays"} · ${pnl >= 0n ? "+" : "−"}${fmtUsd(pnl < 0n ? -pnl : pnl)}`}
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg bg-amber px-4 py-2 text-[12px] font-bold tracking-wide text-black"
        >
          PLAY
        </button>
      </div>

      {/* ------------------------------------------------------------- banner */}
      <div className="mt-3 flex items-center gap-3 rounded-xl bg-amber px-4 py-3">
        <span className="text-[22px]">🕶️</span>
        <p className="mono text-[10px] font-semibold leading-[1.5] tracking-[0.04em] text-black">
          YOUR BAND AND YOUR SIZE ARE A{" "}
          <span className="bg-black px-1 text-amber">COMMITMENT</span>, NEVER AN ADDRESS.
        </p>
      </div>

      {/* ------------------------------------------------------------ balance */}
      <div className="mt-3 rounded-2xl bg-[#161616] p-4">
        <div className="flex items-center justify-between">
          <span className="label">My balance</span>
          <button
            onClick={() => setView("history")}
            aria-label="history"
            className="grid h-7 w-7 place-items-center rounded-full bg-[#242424] text-[13px]"
          >
            ⟲
          </button>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-blue text-[13px] font-bold">
            A
          </span>
          <span className="tnum flex-1 text-[30px] font-bold leading-none">
            {fmtUsd(balance)}
          </span>
          <button
            onClick={() => setView("funds")}
            className="rounded-lg bg-amber px-3 py-2 text-[12px] font-bold text-black"
          >
            ↓ DEPOSIT
          </button>
          <button
            onClick={() => setView("pool")}
            aria-label="withdraw"
            title="The pool"
            className="grid h-9 w-9 place-items-center rounded-lg bg-[#242424] transition-colors hover:bg-[#2e2e2e]"
          >
            ↑
          </button>
        </div>
      </div>

      {/* -------------------------------------------------------------- tiles */}
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Tile icon="🕘" label="History" onClick={() => setView("history")} />
        <Tile icon="🏆" label="Leaderboard" onClick={() => setView("leaderboard")} />
        <Tile icon="📡" label="Oracle" onClick={() => setView("oracle")} />
        <Tile icon="🎨" label="Customize" onClick={() => setView("customize")} />
        <Tile icon="⚙️" label="Settings" onClick={() => setView("settings")} />
        <Tile icon="🔑" label="Account" onClick={() => setView("account")} />
      </div>

      <div className="mt-3 space-y-2">
        <Row icon="🏅" label="All Achievements" onClick={() => setView("awards")} />
        {onAttract ? (
          <Row
            icon="▶️"
            label="Watch it play itself"
            onClick={() => {
              onAttract();
              onClose();
            }}
          />
        ) : null}
        <Row icon="🛡️" label="The pool · shield, withdraw, your positions" onClick={() => setView("pool")} />
        <Row icon="🧭" label="How it works" onClick={() => setView("howto")} />
        <Row icon="ℹ️" label="About molfi" onClick={() => setView("about")} />
      </div>

      <button
        onClick={onReset}
        className="mt-5 w-full rounded-xl bg-red py-3.5 text-[14px] font-bold tracking-wide"
      >
        ⎋ RESET DEMO DESK
      </button>

      <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-5">
        <a
          href="https://strk20-by-example.org"
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-2 rounded-full bg-[#161616] px-4 py-2.5 text-[13px] font-semibold"
        >
          STRK20 docs
        </a>
        <div className="text-right">
          <div className="label">Powered by</div>
          <div className="mt-0.5 flex items-center justify-end gap-1.5">
            <span className="h-3 w-5 rounded-sm bg-purple" />
            <span className="text-[15px] font-bold">Starknet</span>
          </div>
        </div>
      </div>

      <p className="mt-4 text-center text-[12px] leading-relaxed text-white/45">
        <span className="font-semibold text-white/70">molfi has no token.</span> Any coin
        claiming to be molfi is a scam.
      </p>
    </Sheet>
  );
}
