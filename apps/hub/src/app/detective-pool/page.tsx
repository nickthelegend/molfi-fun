import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/chrome";

export const metadata: Metadata = {
  title: "The detective pool — molfi.fun",
  description:
    "A slice of every CrewKill pot pays whoever named a real impostor, weighted toward earlier rounds, whether or not their side won.",
};

/**
 * The one rule that makes the game work, with the arithmetic shown.
 *
 * Social deduction paid out purely on winning has a well-known failure: on a losing crew,
 * the correct play late in a match is to stop trying. The detective pool exists to remove
 * that, and it only convinces anyone if the numbers are on the page rather than described.
 *
 * The worked example below is computed here from the same weighting the contract uses -
 * rounds remaining plus one, per correct vote - so it cannot drift from the real rule.
 */
const ROUNDS = 4;
const POT = 6_000_000; // felt units, six decimals
const DETECTIVE_BPS = 1200;

/** Rounds remaining plus one. Naming an impostor in round 1 is worth four times round 4. */
function weightFor(round: number): number {
  return ROUNDS - round + 1;
}

const VOTERS: Array<{ name: string; correctRounds: number[]; side: "crew" | "impostor" }> = [
  { name: "Seat 0", correctRounds: [1, 2], side: "crew" },
  { name: "Seat 3", correctRounds: [4], side: "crew" },
  { name: "Seat 5", correctRounds: [2], side: "impostor" },
];

export default function DetectivePool() {
  const detectivePot = Math.round((POT * DETECTIVE_BPS) / 10_000);
  const rows = VOTERS.map((v) => ({
    ...v,
    weight: v.correctRounds.reduce((sum, r) => sum + weightFor(r), 0),
  }));
  const totalWeight = rows.reduce((sum, r) => sum + r.weight, 0);

  return (
    <>
      <SiteHeader current="/detective-pool" />

      <main id="main" className="mx-auto max-w-5xl px-6 pt-16 pb-24">
        <p className="text-sm font-medium text-[var(--text-dim)]">Payout design</p>
        <h1 className="mt-3 max-w-[700px] text-4xl font-semibold tracking-tight sm:text-5xl">
          Being right pays,
          <br />
          even when you lose
        </h1>

        <p className="mt-6 max-w-[660px] text-lg text-[var(--text-dim)]">
          Pay a deduction game purely on winning and it breaks in a specific way: once the
          crew is clearly losing, the correct play is to stop trying. Nothing you do changes
          your payout, so the last rounds go quiet and the game stops being a game.
        </p>

        <p className="mt-4 max-w-[660px] text-[var(--text-dim)]">
          So {DETECTIVE_BPS / 100}% of every pot is set aside for whoever actually named an
          impostor, weighted toward earlier rounds, and paid whether or not their side won.
          Reading the table early is worth more than confirming it late, which is exactly the
          behaviour the game wants to buy.
        </p>

        {/* ── Worked example ─────────────────────────────────────────────────────── */}
        <h2 className="mt-16 text-2xl font-semibold tracking-tight">A worked example</h2>
        <p className="mt-3 max-w-[620px] text-[var(--text-dim)]">
          A four-round match with a {(POT / 1e6).toLocaleString("en-US")} STRK pot. The weights
          below are the contract&apos;s own rule, computed on this page: rounds remaining plus
          one, per correct vote.
        </p>

        <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4 border-y border-[var(--line)] py-5">
          <Stat label="Pot" value={`${(POT / 1e6).toLocaleString("en-US")} STRK`} />
          <Stat label="Detective share" value={`${DETECTIVE_BPS / 100}%`} />
          <Stat
            label="Detective pool"
            value={`${(detectivePot / 1e6).toLocaleString("en-US")} STRK`}
            accent
          />
        </div>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left">
                <th className="pb-2 pr-4 font-medium text-[var(--text-mute)]">Voter</th>
                <th className="pb-2 pr-4 font-medium text-[var(--text-mute)]">Named an impostor in</th>
                <th className="pb-2 pr-4 font-medium text-[var(--text-mute)]">Weight</th>
                <th className="pb-2 pr-4 font-medium text-[var(--text-mute)]">Side</th>
                <th className="pb-2 font-medium text-[var(--text-mute)]">Paid</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {rows.map((r) => (
                <tr key={r.name} className="border-b border-[var(--line)]">
                  <td className="py-2.5 pr-4 text-[var(--text)]">{r.name}</td>
                  <td className="py-2.5 pr-4 text-[var(--text-dim)]">
                    {r.correctRounds
                      .map((round) => `round ${round} (+${weightFor(round)})`)
                      .join(", ")}
                  </td>
                  <td className="py-2.5 pr-4 text-[var(--text)]">{r.weight}</td>
                  <td className="py-2.5 pr-4 text-[var(--text-dim)]">{r.side}</td>
                  <td className="py-2.5 text-[var(--accent)]">
                    {((detectivePot * r.weight) / totalWeight / 1e6).toFixed(2)} STRK
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-5 max-w-[660px] text-sm text-[var(--text-mute)]">
          Seat 5 is an impostor who voted for their own partner in round 2. They are paid for
          it. The pool asks one question — did you name a real impostor, and how early — and
          it does not care whose side you were on. That is what stops it becoming a second
          win bonus.
        </p>

        <p className="mt-4 max-w-[660px] text-sm text-[var(--text-mute)]">
          Seat 0 named impostors in rounds 1 and 2, for a weight of {rows[0].weight}. Seat 3
          named one in the final round and gets {rows[1].weight}. Same number of correct
          reads, {(rows[0].weight / rows[1].weight).toFixed(0)}× the pay, because the early
          read was the one that could still change the match.
        </p>
      </main>

      <SiteFooter />
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-xs tracking-wide text-[var(--text-mute)] uppercase">{label}</p>
      <p
        className="mt-1.5 font-mono text-xl"
        style={{ color: accent ? "var(--accent)" : "var(--text)" }}
      >
        {value}
      </p>
    </div>
  );
}
