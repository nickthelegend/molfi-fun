"use client";

import { MatchPhase, type MatchView } from"@crewkill/protocol";
import Link from"next/link";
import { useCallback, useEffect, useState } from"react";
import { Panel, Stat, SubstrateSwitch } from"@/components/pieces";
import { IntegrityAudit } from"@/components/privacy";
import { ChainLog } from"@/components/chainlog";
import {
  fetchConfig,
  fetchDisclosure,
  fetchMatch,
  fetchMatches,
  type ChainConfig,
  type Disclosure,
} from"@/lib/api";

/**
 * Every match this deployment has played.
 *
 * The point is not nostalgia - it is evidence that the state is real. A demo can fake one
 * live match; it cannot fake a hundred settled ones with their transactions still on-chain
 * and their outcomes still recomputable. Opening any row runs the same independent audit the
 * live page runs, so a judge can check a match nobody was watching at the time.
 */

interface Row {
  matchId: number;
  phase: number;
  seatsFilled: number;
  seatCount: number;
  potAmount: string;
}

export default function HistoryPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [config, setConfig] = useState<ChainConfig | null>(null);
  const [selected, setSelected] = useState<MatchView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, cfg] = await Promise.all([fetchMatches(), fetchConfig()]);
      setRows(list);
      setConfig(cfg);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message :"could not reach the keeper");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  if (error) {
    return (
      <main className="mx-auto max-w-4xl px-5 py-10">
        <Header />
        <Panel title="History" className="mt-4">
          <p className="text-[13px] text-[var(--color-alarm)]">{error}</p>
          <p className="mt-2 text-[12px] text-[var(--color-dim)]">
            The keeper is not answering. History is read from its mirror of the chain, so it
            comes back on its own once the keeper does.
          </p>
        </Panel>
      </main>
    );
  }

  if (rows === null) {
    return (
      <main className="mx-auto max-w-4xl px-5 py-10">
        <Header />
        <Panel title="History" className="mt-4">
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-9 animate-pulse  bg-[var(--color-line)]/50" />
            ))}
          </div>
        </Panel>
      </main>
    );
  }

  if (rows.length === 0) {
    return (
      <main className="mx-auto max-w-4xl px-5 py-10">
        <Header />
        <Panel title="History" className="mt-4">
          <p className="text-[13px] text-[var(--color-dim)]">
            No matches on {config?.network ??"this network"} yet. The first one appears the
            moment a lobby opens on-chain.
          </p>
        </Panel>
      </main>
    );
  }

  const settled = rows.filter((row) => row.phase === MatchPhase.Settled);
  const totalStaked = rows.reduce((sum, row) => sum + BigInt(row.potAmount), 0n);

  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <Header />

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Panel>
          <Stat label="Matches played" value={String(rows.length)} />
        </Panel>
        <Panel>
          <Stat label="Settled on-chain" value={String(settled.length)} />
        </Panel>
        <Panel>
          <Stat label="Total staked" value={totalStaked.toString()} tone="text-[var(--color-amber)]" />
        </Panel>
      </div>

      <Panel title="Every match" className="mt-4">
        <ol className="divide-y divide-[var(--color-line)]">
          {rows.map((row) => (
            <li key={row.matchId}>
              <button
                onClick={async () => {
                  setSelected(null);
                  setSelected(await fetchMatch(row.matchId));
                }}
                className="flex w-full items-center gap-3 py-2 text-left text-[13px] hover:text-[var(--color-cyan)]"
              >
                <span className="w-14 shrink-0 tabular-nums text-[var(--color-dim)]">
                  #{row.matchId}
                </span>
                <span className="w-24 shrink-0">
                  <PhaseTag phase={row.phase} />
                </span>
                <span className="flex-1 text-[var(--color-dim)]">
                  {row.seatsFilled}/{row.seatCount} seats
                </span>
                <span className="shrink-0 tabular-nums text-[var(--color-amber)]">
                  {row.potAmount}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </Panel>

      {selected && config && (
        <>
          <MatchDetail match={selected} onClose={() => setSelected(null)} />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <IntegrityAudit match={selected} />
            <ChainLog match={selected} config={config} />
          </div>
        </>
      )}
    </main>
  );
}

function Header() {
  return (
    <header className="flex items-baseline justify-between gap-4">
      <div>
        <h1 className="macro macro-lg">Archive</h1>
        <p className="text-xs text-[var(--color-dim)]">
          Every match this deployment has played, still checkable.
        </p>
      </div>
      {/* The Archive is a surface in its own right, so it carries the same controls as the
          console. Without these, someone who lands here from a link is stuck on whichever
          substrate their system picked. */}
      <div className="flex items-center gap-2">
        <SubstrateSwitch />
        <Link href="/verify" className="switch no-underline">
          Verify a match
        </Link>
        <Link href="/" className="switch no-underline">
          Back to the ship
        </Link>
      </div>
    </header>
  );
}

/**
 * Opens the ballots of a finished match.
 *
 * A vote lives on-chain only as poseidon(VOTE_TAG, role_secret, round, target). While the
 * match runs that is unlinkable - you cannot compute it without a secret nobody has
 * published. Once seats reveal to claim their payouts, the same hashes become checkable, so
 * this recomputes every candidate receipt and asks the contract which ones exist.
 *
 * That is the whole compliance model in one button: private while it matters, auditable
 * afterwards, with no escrowed key and no trusted party.
 */
function BallotDisclosure({ matchId }: { matchId: number }) {
  const [state, setState] = useState<"idle" |"loading" |"done" |"error">("idle");
  const [data, setData] = useState<Disclosure | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (state ==="idle") {
    return (
      <div className="mt-3 border-t border-[var(--color-line)] pt-3">
        <button
          onClick={async () => {
            setState("loading");
            try {
              setData(await fetchDisclosure(matchId));
              setState("done");
            } catch (cause) {
              setMessage(cause instanceof Error ? cause.message :"disclosure failed");
              setState("error");
            }
          }}
          className="border border-[var(--color-cyan)]/50 px-3 py-1.5 text-[12px] text-[var(--color-cyan)] hover:bg-[var(--color-cyan)]/10"
        >
          Open the ballots
        </button>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-dim)]">
          Recovers who voted for whom by recomputing each seat&apos;s vote receipts from its
          published secret and checking them against the contract. Impossible while the match
          was running.
        </p>
      </div>
    );
  }

  if (state ==="loading") {
    return (
      <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-[12px] text-[var(--color-dim)]">
        Checking candidate receipts on-chain…
      </p>
    );
  }

  if (state ==="error") {
    return (
      <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-[12px] text-[var(--color-alarm)]">
        {message}
      </p>
    );
  }

  if (!data?.applicable) {
    return (
      <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-[12px] text-[var(--color-dim)]">
        {data?.reason}
      </p>
    );
  }

  return (
    <div className="mt-3 border-t border-[var(--color-line)] pt-3">
      <p className="mb-2 text-[11px] text-[var(--color-dim)]">
        Recovered from {data.chainReads} on-chain reads. Nothing here came from the
        keeper&apos;s own records.
      </p>
      <div className="space-y-1 text-[12px]">
        {data.seats.map((seat) => (
          <div key={seat.index} className="flex items-start gap-2">
            <span className="w-24 shrink-0 truncate">{seat.persona}</span>
            <span
              className="w-16 shrink-0 text-[11px]"
              style={{
                color:
                  seat.revealedRole ==="impostor"
                    ?"var(--color-alarm)"
                    : seat.revealedRole ==="crew"
                      ?"var(--color-cyan)"
                      :"var(--color-dim)",
              }}
            >
              {seat.revealedRole ??"sealed"}
            </span>
            <span className="min-w-0 flex-1 text-[var(--color-dim)]">
              {seat.ballots && seat.ballots.length > 0
                ? seat.ballots
                    .map((b) => `r${b.round} → ${b.target === null ?"skip" : `seat ${b.target}`}`)
                    .join("")
                : (seat.note ??"no ballots")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PhaseTag({ phase }: { phase: number }) {
  const [label, tone] =
    phase === MatchPhase.Settled
      ? ["settled","var(--color-signal)"]
      : phase === MatchPhase.Aborted
        ? ["aborted","var(--color-dim)"]
        : phase === MatchPhase.Playing
          ? ["playing","var(--color-cyan)"]
          : phase === MatchPhase.Revealing
            ? ["revealing","var(--color-amber)"]
            : ["lobby","var(--color-dim)"];
  return (
    <span className="text-[11px]" style={{ color: tone }}>
      {label}
    </span>
  );
}

/** The outcome of one past match, with the same audit the live page offers. */
function MatchDetail({ match, onClose }: { match: MatchView; onClose: () => void }) {
  const impostors = match.seats.filter((seat) => seat.revealedRole ==="impostor");

  return (
    <Panel
      title={`Match #${match.matchId}`}
      right={
        <div className="flex items-center gap-3">
          {/* A settled match is checkable by anyone, so the archive says so where somebody
              is already looking at the result rather than burying it on another page. */}
          {match.phase === MatchPhase.Settled && (
            <Link
              href={`/verify/${match.matchId}`}
              className="text-[11px] text-[var(--color-cyan)] underline"
            >
              verify this yourself
            </Link>
          )}
          <button onClick={onClose} className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-ink)]">
            close
          </button>
        </div>
      }
      className="mt-4"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Ship" value={match.mapName} />
        <Stat label="Rounds played" value={String(match.round)} />
        <Stat
          label="Outcome"
          value={
            match.phase === MatchPhase.Settled ? (match.crewWon ?"crew won" :"impostors won") :"-"
          }
          tone={match.crewWon ?"text-[var(--color-cyan)]" :"text-[var(--color-alarm)]"}
        />
        <Stat label="Impostors" value={String(match.impostorCount ?? 0)} />
      </div>

      {impostors.length > 0 && (
        <p className="mt-3 text-[12px] text-[var(--color-dim)]">
          Revealed impostor{impostors.length === 1 ? "" : "s"}:{" "}
          {impostors.map((seat) => `${seat.emoji} ${seat.persona}`).join(",")}
        </p>
      )}

      <BallotDisclosure matchId={match.matchId} />

      <div className="mt-3 space-y-1 text-[12px]">
        {match.seats.map((seat) => (
          <div key={seat.index} className="flex items-center gap-2">
            <span className="w-6 shrink-0 text-[var(--color-dim)]">#{seat.index}</span>
            <span className="flex-1 truncate">
              {seat.emoji} {seat.persona}
            </span>
            <span
              className="w-16 shrink-0 text-[11px]"
              style={{
                color:
                  seat.revealedRole ==="impostor"
                    ?"var(--color-alarm)"
                    : seat.revealedRole ==="crew"
                      ?"var(--color-cyan)"
                      :"var(--color-dim)",
              }}
            >
              {seat.revealedRole ??"sealed"}
            </span>
            <span className="w-20 shrink-0 text-right tabular-nums text-[var(--color-amber)]">
              {seat.payout && seat.payout !=="0" ? seat.payout :"-"}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
