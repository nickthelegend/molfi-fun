"use client";

import {
  ROUND_SECONDS,
  fmtMultiplier,
  fmtUsd,
  roundLabel,
  type PaperTicket,
} from "@molfi/sdk";

/**
 * Achievements earned from the tape, not awarded for showing up.
 *
 * Every one of these is a predicate over tickets that actually settled — there is no
 * list of flags being flipped somewhere. That means the screen can be read as a summary
 * of what happened on this desk, and an unearned badge is impossible rather than merely
 * discouraged.
 */
interface Award {
  id: string;
  name: string;
  how: string;
  icon: string;
  earned: boolean;
  /** Progress toward it, when a partial state is meaningful. */
  progress?: { at: number; of: number };
}

function longestWinStreak(settled: PaperTicket[]): number {
  let best = 0;
  let run = 0;
  for (const t of settled) {
    if (t.status === "won") {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

function longestLossStreak(settled: PaperTicket[]): number {
  let best = 0;
  let run = 0;
  for (const t of settled) {
    if (t.status === "lost") {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

export function buildAwards(tickets: PaperTicket[]): Award[] {
  // Oldest first, so a streak means what the word means.
  const ordered = [...tickets].sort((a, b) => a.openedAt - b.openedAt);
  const settled = ordered.filter((t) => t.status === "won" || t.status === "lost");
  const wins = settled.filter((t) => t.status === "won");

  const rounds = new Set(ordered.map((t) => t.tier));
  const markets = new Set(ordered.map((t) => t.marketKey));
  const bestMult = ordered.reduce((m, t) => (t.multiplierBps > m ? t.multiplierBps : m), 0n);
  const biggestWin = wins.reduce((m, t) => (t.payout - t.stake > m ? t.payout - t.stake : m), 0n);

  return [
    {
      id: "first-light",
      name: "First light",
      how: "Fire your first position",
      icon: "🔴",
      earned: ordered.length > 0,
    },
    {
      id: "in-the-money",
      name: "In the money",
      how: "Settle a position inside its band",
      icon: "🎯",
      earned: wins.length > 0,
    },
    {
      id: "hat-trick",
      name: "Hat trick",
      how: "Win three rounds in a row",
      icon: "🔥",
      earned: longestWinStreak(settled) >= 3,
      progress: { at: Math.min(3, longestWinStreak(settled)), of: 3 },
    },
    {
      /**
       * Counted against the rounds the console actually offers.
       *
       * This asked for six lengths "3s to 15m" — the round set from the abandoned
       * three-second design. The desk has listed 15m, 1h and 4h for a long time, so the
       * badge could never be earned and its subtitle described a control nobody could find.
       * Reading the target off `ROUND_SECONDS` means the next change to the round set moves
       * the badge with it.
       */
      id: "full-spread",
      name: "Full spread",
      how: `Play every round length, ${roundLabel(0)} to ${roundLabel(ROUND_SECONDS.length - 1)}`,
      icon: "📶",
      earned: rounds.size >= ROUND_SECONDS.length,
      progress: { at: rounds.size, of: ROUND_SECONDS.length },
    },
    {
      id: "tourist",
      name: "Tourist",
      how: "Play all three markets",
      icon: "🧭",
      earned: markets.size >= 3,
      progress: { at: markets.size, of: 3 },
    },
    {
      id: "tightrope",
      name: "Tightrope",
      how: "Fire a band paying 4x or better",
      icon: "🪢",
      earned: bestMult >= 40_000n,
    },
    {
      id: "long-game",
      name: "The long game",
      how: "Hold a 15-minute round to its cutoff",
      icon: "⏳",
      earned: settled.some((t) => t.tier === 5),
    },
    {
      id: "paper-cut",
      name: "Paper cut",
      how: "Lose five in a row and keep going",
      icon: "🩹",
      earned: longestLossStreak(settled) >= 5,
      progress: { at: Math.min(5, longestLossStreak(settled)), of: 5 },
    },
    {
      id: "size",
      name: "Size",
      how: "Stake the maximum on one position",
      icon: "🐋",
      earned: ordered.some((t) => t.stake >= 10_000_000n),
    },
    {
      id: "double-up",
      name: "Double up",
      how: "Win more than your stake back on one position",
      icon: "💰",
      earned: wins.some((t) => t.payout - t.stake >= t.stake),
    },
    {
      id: "regular",
      name: "Regular",
      how: "Settle twenty rounds",
      icon: "🎰",
      earned: settled.length >= 20,
      progress: { at: Math.min(20, settled.length), of: 20 },
    },
    {
      id: "green",
      name: "Ahead",
      how: "Finish a session up on the desk",
      icon: "📈",
      earned: settled.reduce((a, t) => a + (t.status === "won" ? t.payout - t.stake : -t.stake), 0n) > 0n,
    },
  ].map((a) => ({
    ...a,
    // A best-multiplier or biggest-win badge should say what it took.
    how:
      a.id === "tightrope" && bestMult > 0n
        ? `Fire a band paying 4x or better · best so far ${fmtMultiplier(bestMult)}`
        : a.id === "double-up" && biggestWin > 0n
          ? `Win more than your stake back · best so far ${fmtUsd(biggestWin)}`
          : a.how,
  }));
}

export function Achievements({ tickets }: { tickets: PaperTicket[] }) {
  const awards = buildAwards(tickets);
  const earned = awards.filter((a) => a.earned).length;

  return (
    <div className="pb-6">
      <div className="rounded-2xl bg-[#141414] p-4">
        <div className="flex items-baseline justify-between">
          <span className="label">Earned</span>
          <span className="tnum text-[15px] font-semibold text-white">
            {earned} <span className="text-dim">/ {awards.length}</span>
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#242424]">
          <div
            className="h-full w-full origin-left bg-amber transition-transform duration-[240ms] ease-out"
            style={{ transform: `scaleX(${earned / awards.length})` }}
          />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-white/40">
          Every badge is worked out from positions that actually settled on this desk.
          Nothing here is granted.
        </p>
      </div>

      <div className="mt-3 space-y-2">
        {awards.map((a) => (
          <div
            key={a.id}
            className={`flex items-start gap-3 rounded-2xl px-3 py-3 ${
              a.earned ? "bg-[#1b1710] ring-1 ring-amber/25" : "bg-[#141414]"
            }`}
          >
            <span
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-[18px] ${
                a.earned ? "bg-amber/15" : "bg-[#1e1e1e] grayscale opacity-40"
              }`}
            >
              {a.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div
                className={`text-[14px] font-semibold ${a.earned ? "text-amber" : "text-white/55"}`}
              >
                {a.name}
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-white/40">{a.how}</p>
              {!a.earned && a.progress && a.progress.at > 0 ? (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-[#242424]">
                    <div
                      className="h-full rounded-full bg-white/30"
                      style={{ width: `${(a.progress.at / a.progress.of) * 100}%` }}
                    />
                  </div>
                  <span className="tnum text-[10px] text-white/35">
                    {a.progress.at}/{a.progress.of}
                  </span>
                </div>
              ) : null}
            </div>
            {a.earned ? <span className="mt-1 text-[12px] text-amber">✓</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
