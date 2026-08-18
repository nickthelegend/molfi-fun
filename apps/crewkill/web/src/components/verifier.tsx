"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { auditMatch, roleDraw, drawIsImpostor, type MatchView } from "@crewkill/protocol";
import { API_URL } from "@/lib/api";

/**
 * The permissionless verifier.
 *
 * CrewKill's whole argument is that you do not have to trust whoever ran the match. Up to
 * now that argument had no surface: the audit ran inside a player's own session, on their
 * own live match, and a stranger had no way to check a finished one. An unfalsifiable claim
 * and an unchecked one look identical from outside.
 *
 * So this takes any settled match number and replays it. Every figure below is recomputed
 * here, in the reader's browser, from data the contract published - the final seed and the
 * role secrets, both of which were committed before anyone could know them. The server is
 * asked for the published inputs and for nothing else; it does not get to supply an answer.
 *
 * A disagreement between the two columns would mean the contract paid out something the
 * published inputs do not support. That is the failure this exists to be able to find, and
 * the reason the numbers are shown side by side rather than reduced to a tick.
 */
export function Verifier({ initialMatchId }: { initialMatchId?: string }) {
  const [input, setInput] = useState(initialMatchId ?? "");
  const [match, setMatch] = useState<MatchView | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    const trimmed = id.trim();
    if (!/^\d+$/.test(trimmed)) {
      setState("error");
      setError("A match number is digits only.");
      setMatch(null);
      return;
    }
    setState("loading");
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/matches/${trimmed}`, { cache: "no-store" });
      if (res.status === 404) {
        setState("error");
        setError(`No match numbered ${trimmed} on this deployment.`);
        setMatch(null);
        return;
      }
      if (!res.ok) throw new Error(`keeper returned ${res.status}`);
      const body = (await res.json()) as MatchView;
      setMatch(body);
      setState("idle");
    } catch (err) {
      setState("error");
      // The reason matters. "Could not reach the keeper" and "that match does not exist" send
      // a reader to completely different next steps.
      setError(err instanceof Error ? err.message : "Could not reach the keeper.");
      setMatch(null);
    }
  }, []);

  useEffect(() => {
    if (initialMatchId) void load(initialMatchId);
  }, [initialMatchId, load]);

  const result = useMemo(() => (match ? auditMatch(match) : null), [match]);

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load(input);
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <label htmlFor="matchId" className="tele">
          Match number
        </label>
        <input
          id="matchId"
          value={input}
          onChange={(e) => setInput(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="604"
          className="w-28 border border-[var(--color-line)] bg-transparent px-2 py-1.5 font-mono text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-cyan)]"
        />
        <button
          type="submit"
          disabled={state === "loading" || !/^\d+$/.test(input)}
          className="switch switch-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {state === "loading" ? "Replaying" : "Replay it"}
        </button>
      </form>

      {state === "error" && error && (
        <p className="mt-4 text-[13px]" style={{ color: "var(--color-alarm)" }}>
          {error}
        </p>
      )}

      {match && result && !result.applicable && (
        <div className="mt-6 border border-[var(--color-line)] p-4">
          <p className="text-[13px] text-[var(--color-dim)]">
            Match {match.matchId} has not settled yet, so there is nothing to check. The
            secrets that make a match verifiable are published only once play is over - that
            is exactly what keeps them secret while they still decide the outcome.
          </p>
        </div>
      )}

      {match && result?.applicable && (
        <div className="mt-6">
          <div
            className="flex flex-wrap items-center justify-between gap-3 border-b p-3"
            style={{
              borderColor: result.failed === 0 ? "var(--color-signal)" : "var(--color-alarm)",
            }}
          >
            <div>
              <p
                className="macro"
                style={{
                  color: result.failed === 0 ? "var(--color-signal)" : "var(--color-alarm)",
                }}
              >
                {result.failed === 0
                  ? `Match ${match.matchId} checks out`
                  : `Match ${match.matchId} does not check out`}
              </p>
              <p className="tele mt-1">
                {result.passed} of {result.checks.length} recomputed here and agreeing with the
                contract
              </p>
            </div>
            <div className="text-right">
              <p className="tele">Pot</p>
              <p className="numeric text-sm text-[var(--color-ink)]">
                {(Number(match.potAmount) / 1e6).toLocaleString("en-US")} STRK
              </p>
            </div>
          </div>

          <ul className="mt-3 space-y-1">
            {result.checks.map((entry) => (
              <li key={entry.id} className="border border-[var(--color-line)]">
                <button
                  onClick={() => setOpen(open === entry.id ? null : entry.id)}
                  aria-expanded={open === entry.id}
                  className="flex w-full items-center gap-3 p-3 text-left hover:bg-[var(--color-hull)]"
                >
                  <span
                    className="shrink-0 text-sm"
                    style={{ color: entry.ok ? "var(--color-signal)" : "var(--color-alarm)" }}
                  >
                    {entry.ok ? "✓" : "✕"}
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] text-[var(--color-ink)]">
                    {entry.label}
                  </span>
                  <span className="tele shrink-0">{open === entry.id ? "hide" : "show"}</span>
                </button>

                {open === entry.id && (
                  <div className="border-t border-[var(--color-line)] p-3">
                    <p className="mb-3 text-[12px] leading-relaxed text-[var(--color-dim)]">
                      {entry.because}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="border border-[var(--color-line)] p-2">
                        <p className="tele">The contract says</p>
                        <p className="numeric mt-1 text-[13px] break-all text-[var(--color-ink)]">
                          {entry.onChain}
                        </p>
                      </div>
                      <div className="border border-[var(--color-line)] p-2">
                        <p className="tele">Recomputed in this browser</p>
                        <p
                          className="numeric mt-1 text-[13px] break-all"
                          style={{
                            color: entry.ok ? "var(--color-signal)" : "var(--color-alarm)",
                          }}
                        >
                          {entry.recomputed}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <Working match={match} />

          <p className="mt-4 text-[11px] leading-relaxed text-[var(--color-dim)]">
            The keeper was asked for this match&apos;s published inputs and nothing else. Every
            value in the right hand column was derived from them by code running on this page,
            so a server that wanted to report a different outcome would have to change the
            published seed or the role secrets - both of which were committed before anyone
            knew what they would be.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The arithmetic, shown.
 *
 * A tick beside "roles agree" still asks to be believed. This prints the two published
 * values every role is drawn from, the draw that falls out of them, and the threshold the
 * draw is compared against - so the claim stops being "we checked" and becomes a sum anyone
 * can redo with a poseidon implementation and a calculator.
 *
 * Both inputs were committed before either was known: the seed before the lobby opened, the
 * role secret when the seat was bought. Neither side could steer the result, and that is the
 * whole provably-fair claim in one table.
 */
function Working({ match }: { match: MatchView }) {
  const [open, setOpen] = useState(false);

  const seed = match.finalSeed ? BigInt(match.finalSeed) : null;
  const revealed = match.seats.filter((seat) => seat.roleSecret);
  if (!seed || revealed.length === 0) return null;

  // Basis points out of 10,000. A draw below the threshold is an impostor.
  const threshold = match.impostorBps;

  return (
    <div className="mt-4 border border-[var(--color-line)]">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between p-3 text-left hover:bg-[var(--color-hull)]"
      >
        <span className="text-[13px] text-[var(--color-ink)]">Show the working</span>
        <span className="tele">{open ? "hide" : "show"}</span>
      </button>

      {open && (
        <div className="border-t border-[var(--color-line)] p-3">
          <p className="mb-3 text-[12px] leading-relaxed text-[var(--color-dim)]">
            Each role is <code className="text-[var(--color-cyan)]">poseidon(final_seed, role_secret)</code>{" "}
            compared against {threshold} of 10,000. The seed was fixed before the lobby opened
            and each secret before that seat played, so neither side could aim at a result.
          </p>

          <div className="mb-3 border border-[var(--color-line)] p-2">
            <p className="tele">final seed</p>
            <p className="numeric mt-1 text-[11px] break-all text-[var(--color-ink)]">
              {match.finalSeed}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left">
                  <th className="tele pb-1 pr-2 font-normal">seat</th>
                  <th className="tele pb-1 pr-2 font-normal">role secret</th>
                  <th className="tele pb-1 pr-2 font-normal">draw mod 10000</th>
                  <th className="tele pb-1 font-normal">role</th>
                </tr>
              </thead>
              <tbody className="numeric">
                {revealed.map((seat) => {
                  const secret = BigInt(seat.roleSecret as string);
                  const draw = roleDraw(seed, secret);
                  const bucket = Number(draw % 10000n);
                  const impostor = drawIsImpostor(draw, threshold);
                  return (
                    <tr key={seat.index} className="border-t border-[var(--color-line)]">
                      <td className="py-1.5 pr-2 text-[var(--color-dim)]">#{seat.index}</td>
                      <td className="py-1.5 pr-2 text-[var(--color-dim)]">
                        {(seat.roleSecret as string).slice(0, 12)}…
                      </td>
                      <td className="py-1.5 pr-2 text-[var(--color-ink)]">
                        {bucket} {impostor ? "<" : "\u2265"} {threshold}
                      </td>
                      <td
                        className="py-1.5"
                        style={{
                          color: impostor ? "var(--color-alarm)" : "var(--color-cyan)",
                        }}
                      >
                        {impostor ? "impostor" : "crew"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-[var(--color-dim)]">
            Recomputed here from the two published values. Nothing in this table was read back
            from the server.
          </p>
        </div>
      )}
    </div>
  );
}
