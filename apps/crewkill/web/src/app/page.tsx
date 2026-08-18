"use client";

import {
  BallotKind,
  MatchPhase,
  NO_TARGET,
  actionToken,
  adjacencyOf,
  claimCommitment,
  isImpostor,
  shipMapById,
  killCommitment,
  voteReceipt,
  type MatchView,
  type SeatKeypair,
} from"@crewkill/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from"react";
import {
  Countdown,
  EventLog,
  Panel,
  PhaseBadge,
  SeatCard,
  Stat,
  SubstrateSwitch,
} from"@/components/pieces";
import { ActionPanel, SabotageBanner, TaskProgress, type ActionRequest } from"@/components/ship";
import { BallotBoard } from"@/components/ballots";
import { DetectiveBreakdown, IntegrityAudit, PrivacyLedger } from"@/components/privacy";
import { ChainLog, DeploymentCard } from"@/components/chainlog";
import { ShipView } from"@/components/shipview";
import { CueToggle, useCues } from"@/components/cues";
import { Cutscenes } from"@/components/cutscenes";
import { Primer, PrimerButton } from"@/components/primer";
import { MainMenu, type DeploymentTotals } from"@/components/mainmenu";
import { VotingScreen } from"@/components/votingscreen";
import { AgentCard, CrewProgress, WalkingCrew } from"@/components/roster";
import { ActionType } from"@/lib/ship";
import {
  API_URL,
  fetchConfig,
  fetchLobby,
  fetchMatch,
  fetchMatches,
  fetchTotals,
  subscribe,
  type ChainConfig,
} from"@/lib/api";
import { createSeat, exportSeat, loadSeat, rememberSeatIndex } from"@/lib/seat";
import {
  DevnetPool,
  connectWallet,
  lookupSeatIndex,
  type PoolClient,
} from"@/lib/strk20";

/**
 * Starknet RPC errors arrive as a page of nested JSON with the one useful sentence - the
 * Cairo `assert` message - buried inside. Show that; keep the rest for the console.
 */
function readableError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const cairo = raw.match(/\('([^']{3,60})'\)/);
  if (cairo) return cairo[1];
  const failure = raw.match(/Failure reason:\s*([^\\\n]{3,120})/);
  if (failure) return failure[1].trim();
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}

export default function Home() {
  const [config, setConfig] = useState<ChainConfig | null>(null);
  const [match, setMatch] = useState<MatchView | null>(null);
  const [pool, setPool] = useState<PoolClient | null>(null);
  const [seat, setSeat] = useState<SeatKeypair | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  /** A joinable lobby that is not the match currently on screen. */
  const [openLobby, setOpenLobby] = useState<MatchView | null>(null);
  const [allMatches, setAllMatches] = useState<Array<{ matchId: number; phase: number; seatsFilled: number }>>([]);
  // Whole-deployment aggregates, kept apart from the recent page above. Null until the
  // first read lands, so a loading counter shows a dash rather than a plausible zero.
  const [totals, setTotals] = useState<DeploymentTotals | null>(null);
  /** When this browser shielded its stake - the input to the deposit/stake timing factor. */
  const [shieldedAt, setShieldedAt] = useState<number | null>(null);
  /** The meeting table. Opens on each voting phase; dismissible to watch the ship. */
  const [tableOpen, setTableOpen] = useState(false);
  /** The log and chain feed. Collapsible, so the ship can be seen whole. */
  const [feedOpen, setFeedOpen] = useState(true);
  const lastVotingRound = useRef<number | null>(null);
  /**
   * One-shot guards for the two actions that cannot be repeated on-chain.
   *
   * `busy` covers the in-flight window, but there is a second gap afterwards: the write has
   * landed and the mirror has not caught up, so the button is still on screen. Pressing it
   * then reverts with `already revealed` / `already claimed` - a real 400 the player did
   * nothing wrong to earn.
   */
  const [sent, setSent] = useState<{ reveal: number | null; claim: number | null }>({
    reveal: null,
    claim: null,
  });
  const pollingRef = useRef(false);
  const matchIdRef = useRef<number | null>(null);

  // ── boot ──────────────────────────────────────────────────────────────────────────

  /**
   * Loads the chain config, retrying until it succeeds.
   *
   * The whole screen is gated on this one response, so a single failed attempt at boot used
   * to strand the tab on an error page until someone pressed reload. A keeper restart is a
   * routine event; the client heals itself instead.
   */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const load = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const loaded = await fetchConfig();
        if (cancelled) return;
        setConfig(loaded);
        setError(null);

        const lobby = await fetchLobby();
        if (cancelled || !lobby) return;
        setMatch(lobby);
        matchIdRef.current = lobby.matchId;
        setSeat(loadSeat(lobby.matchId));
      } catch {
        if (cancelled) return;
        setError(`Cannot reach the keeper at ${API_URL}. Retrying…`);
        attempt += 1;
        timer = setTimeout(() => void load(), Math.min(10_000, 1000 * attempt));
      }
    };
    void load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  /**
   * The keeper runs several matches at once and broadcasts whichever one just moved. Pin the
   * view to one match instead of following the noise: the one you have a stake in, or
   * otherwise the lobby that is currently open.
   */
  useEffect(() => {
    return subscribe(
      (incoming) => {
        if (matchIdRef.current !== null && incoming.matchId !== matchIdRef.current) return;
        matchIdRef.current = incoming.matchId;
        setMatch(incoming);
      },
      (connected) => setLive(connected),
    );
  }, []);

  /**
   * Keeps an eye on the open lobby.
   *
   * Two jobs: move on automatically once the match on screen is over and you have no stake
   * in it, and otherwise just remember that a lobby exists so a spectator who arrived
   * mid-match has a way in. Without this, arriving during a three-minute match means staring
   * at a disabled button until it ends.
   */
  useEffect(() => {
    const check = async (): Promise<void> => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        // Keeps the landing metrics honest: they count real matches, not a guess.
        void fetchMatches().then(setAllMatches).catch(() => {});
        void fetchTotals().then(setTotals).catch(() => {});
        const lobby = await fetchLobby();
        const current = matchIdRef.current;
        const staked = current !== null && loadSeat(current) !== null;
        const finished =
          match !== null &&
          (match.phase === MatchPhase.Settled || match.phase === MatchPhase.Aborted);
        // A stake pins the view only while the match is still live. Once it has settled the
        // player has seen their result, and holding them on a finished match with no way
        // forward is a dead end, not a feature.
        const pinned = staked && !finished;

        if (lobby && current !== null && lobby.matchId === current) {
          setOpenLobby(null);
          return;
        }
        if (lobby && (current === null || (!staked && finished))) {
          matchIdRef.current = lobby.matchId;
          setMatch(lobby);
          setOpenLobby(null);
          return;
        }
        // Settled-and-staked: keep the result on screen, but always offer the way out.
        setOpenLobby(pinned ? null : lobby);
      } catch {
        // The keeper is briefly unreachable; the next tick tries again.
      } finally {
        pollingRef.current = false;
      }
    };
    void check();
    const id = setInterval(() => void check(), 4000);
    return () => clearInterval(id);
  }, [match?.phase, match?.matchId]);

  const jumpToLobby = useCallback(() => {
    if (!openLobby) return;
    matchIdRef.current = openLobby.matchId;
    setMatch(openLobby);
    setSeat(loadSeat(openLobby.matchId));
    setOpenLobby(null);
  }, [openLobby]);

  // ── derived ───────────────────────────────────────────────────────────────────────

  /**
   * Your role, computed here and only here. The keeper cannot do this - it needs the role
   * secret, which never leaves this browser.
   */
  const yourRole = useMemo(() => {
    if (!match?.finalSeed || !seat) return null;
    return isImpostor(BigInt(match.finalSeed), BigInt(seat.roleSecret), match.impostorBps)
      ?"impostor"
      :"crew";
  }, [match?.finalSeed, match?.impostorBps, seat?.roleSecret]);

  const yourSeat = seat?.seatIndex ?? null;
  const votesFor = useCallback(
    (index: number) => {
      const round = match?.tallies.find((t) => t.round === match.round);
      return round?.targets.find((t) => t.seat === index)?.votes ?? 0;
    },
    [match],
  );

  /**
   * Audible phase changes.
   *
   * Keyed on the round as well as the phase, so entering "night" in round 3 is a different
   * event from entering it in round 2 and each one gets its own cue.
   */
  const phaseKey = match
    ? match.phase === MatchPhase.Settled
      ? "settled"
      : match.roundPhase
        ? `${match.roundPhase}:${match.round}`
        : null
    : null;
  const cues = useCues(phaseKey);

  const run = useCallback(
    async (label: string, action: () => Promise<string>) => {
      setBusy(label);
      setError(null);
      try {
        const hash = await action();
        setLastTx(hash);
        if (matchIdRef.current) {
          const refreshed = await fetchMatch(matchIdRef.current).catch(() => null);
          if (refreshed) setMatch(refreshed);
        }
      } catch (cause) {
        setError(readableError(cause));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  // ── actions ───────────────────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (!config) return;
    setError(null);
    try {
      if (config.realPool) {
        setPool(await connectWallet(config));
      } else {
        // Devnet has no privacy wallet. Borrow a predeployed key and sign for real.
        const response = await fetch(`${config.rpcUrl}`, {
          method:"POST",
          headers: {"content-type":"application/json" },
          body: JSON.stringify({
            jsonrpc:"2.0",
            id: 1,
            method:"devnet_getPredeployedAccounts",
            params: {},
          }),
        });
        const body = (await response.json()) as {
          result: Array<{ address: string; private_key: string }>;
        };
        // The last account, so the keeper's agents (which lease from the front) never clash.
        const account = body.result[body.result.length - 1];
        setPool(new DevnetPool(config, account.address, account.private_key));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [config]);

  /**
   * Shields the stake, and nothing else.
   *
   * STRK20's own compliance page is blunt that a deposit is public - it names the depositor,
   * the token and the amount in plaintext - and that opening a channel and moving funds"in
   * tight succession" links the two. Shielding as a separate, earlier act is the only thing
   * that actually breaks that link, so it is a separate button rather than the first half of
   * a combined one.
   */
  const shieldOnly = useCallback(async () => {
    if (!pool || !match) return;
    await run("Shielding your stake", async () => {
      const hash = await pool.shield(BigInt(match.stakeAmount));
      setShieldedAt(Date.now());
      return hash;
    });
  }, [pool, match, run]);

  /**
   * Buys the seat from already-shielded funds.
   *
   * If the stake has not been shielded yet this still does it, because a player who ignores
   * the advice should not be blocked from playing - they just get a worse privacy score, and
   * the panel tells them why.
   */
  const takeSeat = useCallback(async () => {
    if (!pool || !match || !config) return;
    // Mint and persist the seat material *before* any value moves. If the stake lands and
    // the secrets did not, the money is unreachable.
    const material = createSeat(match.matchId);
    setSeat(material);
    await run("Buying a seat", async () => {
      const stake = BigInt(match.stakeAmount);
      if (shieldedAt === null) {
        await pool.shield(stake);
        setShieldedAt(Date.now());
      }
      const hash = await pool.joinSeat(match.matchId, BigInt(material.seatCommitment), stake);
      const index = await lookupSeatIndex(config, match.matchId, BigInt(material.seatCommitment));
      if (index !== null) {
        rememberSeatIndex(match.matchId, index);
        setSeat(loadSeat(match.matchId));
      }
      return hash;
    });
  }, [pool, match, config, run, shieldedAt]);

  const castVote = useCallback(
    async (target: number) => {
      if (!pool || !match || !seat) return;
      await run(target === NO_TARGET ?"Skipping" :"Voting", () =>
        pool.castBallot({
          matchId: match.matchId,
          commitment: voteReceipt(BigInt(seat.roleSecret), match.round, target),
          kind: BallotKind.Vote,
          round: match.round,
          targetSeat: target,
        }),
      );
    },
    [pool, match, seat, run],
  );

  /**
   * Gameplay actions go to the keeper, not the chain: they are free, they happen several
   * times a round, and none of them can move money. The capability token proves the seat is
   * ours without revealing either secret.
   */
  const sendAction = useCallback(
    async (action: ActionRequest) => {
      if (!match || !seat || seat.seatIndex === null) return;
      setError(null);
      try {
        const response = await fetch(`${API_URL}/api/matches/${match.matchId}/action`, {
          method:"POST",
          headers: {"content-type":"application/json" },
          body: JSON.stringify({
            seatIndex: seat.seatIndex,
            token: `0x${actionToken(BigInt(seat.roleSecret), BigInt(seat.claimSecret)).toString(16)}`,
            ...action,
          }),
        });
        if (!response.ok) {
          throw new Error(((await response.json()) as { error?: string }).error ??"rejected");
        }
        // An elimination also has to land on-chain as a private ballot, or settlement will
        // treat it as a bluff and take the stake.
        if (action.type === ActionType.Kill && action.target !== undefined && pool) {
          await run("Eliminating", () =>
            pool.castBallot({
              matchId: match.matchId,
              commitment: killCommitment(BigInt(seat.roleSecret), match.round, action.target!),
              kind: BallotKind.Kill,
              round: match.round,
              targetSeat: action.target!,
            }),
          );
        }
      } catch (cause) {
        setError(readableError(cause));
      }
    },
    [match, seat, pool, run],
  );

  const reveal = useCallback(async () => {
    if (!match || !seat || sent.reveal === match.matchId) return;
    setSent((prev) => ({ ...prev, reveal: match.matchId }));
    await run("Revealing", async () => {
      // Relayed by the keeper on purpose. `reveal_seat` is permissionless - knowledge of the
      // role secret is the only authorisation - so sending it from your own wallet would
      // work, and would also stamp your address next to the seat forever. The relay keeps
      // the seat unlinked; the secret it carries is about to be public anyway.
      const response = await fetch(`${API_URL}/api/reveal`, {
        method:"POST",
        headers: {"content-type":"application/json" },
        body: JSON.stringify({
          matchId: match.matchId,
          roleSecret: seat.roleSecret,
          claimCommitment: `0x${claimCommitment(BigInt(seat.claimSecret)).toString(16)}`,
        }),
      });
      if (!response.ok) throw new Error((await response.json()).error ??"reveal failed");
      return ((await response.json()) as { txHash: string }).txHash;
    });
  }, [match, seat, run, sent.reveal]);

  const claim = useCallback(async () => {
    if (!pool || !match || !seat || sent.claim === match.matchId) return;
    setSent((prev) => ({ ...prev, claim: match.matchId }));
    await run("Claiming", () => pool.claim(match.matchId, BigInt(seat.claimSecret)));
  }, [pool, match, seat, run, sent.claim]);

  // ── render ────────────────────────────────────────────────────────────────────────

  if (!config || !match) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="macro macro-lg">CrewKill</h1>
        <p className="text-sm text-[var(--color-dim)]">
          {error ??
            (config
              ?"No lobby is open right now. The next one opens as soon as the current match starts."
              :"Contacting the keeper…")}
        </p>
      </main>
    );
  }

  // Which ship this match is on was chosen by `final_seed`, not by us.
  const ship = shipMapById(match.mapId);
  const inLobby = match.phase === MatchPhase.Lobby;
  const playing = match.phase === MatchPhase.Playing;
  const canVote = playing && match.roundPhase ==="voting" && seat !== null && yourSeat !== null;
  const seatRow = yourSeat !== null ? match.seats[yourSeat] : null;

  // ── lobby: no ship yet, so keep it a simple card ───────────────────────────────────
  if (inLobby) {
    return (
      <main className="min-h-screen">
        <Primer />
        <div className="mx-auto max-w-3xl px-5 pt-5">
          <Header
            cues={cues}
            match={match}
            live={live}
            pool={pool}
            config={config}
            onConnect={() => void connect()}
            wordmark={false}
          />
          {error && <ErrorBar message={error} />}
        </div>

        <MainMenu
          lobby={match}
          matches={allMatches}
          totals={totals}
          connected={live}
          onPlay={() => {
            document.getElementById("seat")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
        <Panel title="The ship" className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: match.seatCount }).map((_unused, i) => {
              const seatHere = match.seats[i];
              return seatHere ? (
                <AgentCard key={i} seat={seatHere} isYou={i === yourSeat} />
              ) : (
                <div
                  key={i}
                  className="border border-dashed border-[var(--color-line)] p-3 text-[12px] text-[var(--color-dim)]"
                >
                  empty - an agent takes this at kickoff
                </div>
              );
            })}
          </div>
        </Panel>
        <Panel title="Your seat" className="mt-4" id="seat">
          {!seat ? (
            <div className="space-y-3">
              <p className="text-[13px] text-[var(--color-dim)]">
                Buying a seat shields your stake and sends it through the pool, so the game
                contract records a commitment and never an address.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  onClick={() => void shieldOnly()}
                  disabled={!pool || busy !== null || shieldedAt !== null}
                  className="border border-[var(--color-signal)]/50 py-2 text-sm text-[var(--color-signal)] hover:bg-[var(--color-signal)]/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {shieldedAt !== null ?"Shielded" :"01 Shield stake"}
                </button>
                <button
                  onClick={() => void takeSeat()}
                  disabled={!pool || busy !== null}
                  className="bg-[var(--color-cyan)]/15 py-2 text-sm text-[var(--color-cyan)] ring-1 ring-[var(--color-cyan)]/40 hover:bg-[var(--color-cyan)]/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ??"02 Take seat"}
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-[var(--color-dim)]">
                {shieldedAt === null
                  ?"Shielding first, and leaving a gap before you stake, is what stops the two being linked by timing. You can skip straight to taking a seat - it just costs you anonymity."
                  :"Shielded. Leave it a moment before taking a seat: a deposit and a stake in quick succession still correlate."}
              </p>
            </div>
          ) : (
            <SeatSummary seat={seat} yourSeat={yourSeat} yourRole={yourRole} />
          )}
        </Panel>
        <Panel title="Pot" weight="rail" className="mt-4">
          <PotStats match={match} />
        </Panel>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <PrivacyLedger match={match} seat={seat} shieldedAt={shieldedAt} />
          <div className="space-y-4">
            <DeploymentCard config={config} />
            <ChainLog match={match} config={config} />
          </div>
        </div>
        </MainMenu>
      </main>
    );
  }

  // ── in play: the ship IS the screen ───────────────────────────────────────────────
  //
  // The map used to sit in a box inside a document, with the page scrolling underneath and
  // dead space below the fold. A game should own the viewport: the ship fills it, and
  // everything that reads the ship floats on top. The HUD container ignores pointer events
  // so the map stays draggable through the gaps; each panel opts back in.
  return (
    <>
      <Primer />
      <Cutscenes match={match} />

      {tableOpen && seat !== null && (
        <VotingScreen
          match={match}
          yourSeat={yourSeat}
          busy={busy !== null}
          onVote={(target) => {
            setTableOpen(false);
            void castVote(target);
          }}
          onClose={() => setTableOpen(false)}
        />
      )}

      {/* The ship, edge to edge. */}
      <div className="fixed inset-0 z-0">
        <ShipView
          key={match.matchId}
          map={ship}
          match={match}
          yourSeat={yourSeat}
          onRoomClick={(room) => {
            if (!playing || match.roundPhase !== "night" || yourSeat === null) return;
            if (!seatRow?.alive) return;
            if (!(adjacencyOf(ship)[seatRow.location] ?? []).includes(room)) return;
            void sendAction({ type: ActionType.Move, destination: room });
          }}
        />
      </div>

      <div className="pointer-events-none fixed inset-0 z-30 flex flex-col">
        {/* Top: identity, phase, controls. */}
        <div className="pointer-events-auto bg-[var(--color-hull)]/85 px-4 py-2.5 backdrop-blur">
          <Header
            cues={cues}
            match={match}
            live={live}
            pool={pool}
            config={config}
            onConnect={() => void connect()}
            compact
          />
        </div>

        {error && (
          <div className="pointer-events-auto px-4 pt-2">
            <ErrorBar message={error} />
          </div>
        )}
        {match.sabotage > 0 && (
          <div className="pointer-events-auto px-4 pt-2">
            <SabotageBanner match={match} />
          </div>
        )}

        <div className="flex min-h-0 flex-1 items-start justify-end gap-3 p-3">
          {/* Right: everything that reads the ship. Scrolls on its own so the map never
              has to give up room for it. */}
          <aside className="pointer-events-auto flex max-h-full w-[21rem] shrink-0 flex-col gap-2 overflow-y-auto bg-[var(--color-hull)]/85 p-3 backdrop-blur">
            <Panel title="Your seat" weight="rail">
              {!seat ? (
                <p className="text-[13px] text-[var(--color-dim)]">
                  You are spectating. The next lobby is your way in.
                </p>
              ) : (
                <div className="space-y-3">
                  <SeatSummary seat={seat} yourSeat={yourSeat} yourRole={yourRole} />
                  {playing && match.roundPhase === "night" && yourSeat !== null && (
                    <div className="border-t border-[var(--color-line)] pt-3">
                      <ActionPanel
                        match={match}
                        yourSeat={yourSeat}
                        role={yourRole}
                        busy={busy !== null}
                        onAction={(action) => void sendAction(action)}
                      />
                    </div>
                  )}
                  {match.phase === MatchPhase.Revealing &&
                    !seatRow?.revealedRole &&
                    sent.reveal !== match.matchId && (
                      <button
                        onClick={() => void reveal()}
                        disabled={busy !== null}
                        className="switch w-full"
                      >
                        {busy ?? "Publish role secret"}
                      </button>
                    )}
                  {match.phase === MatchPhase.Settled &&
                    seatRow?.payout &&
                    seatRow.payout !== "0" &&
                    !seatRow.claimed &&
                    sent.claim !== match.matchId && (
                      <button
                        onClick={() => void claim()}
                        disabled={busy !== null}
                        className="switch switch-armed w-full"
                      >
                        {busy ?? `Claim ${seatRow.payout}`}
                      </button>
                    )}
                </div>
              )}
            </Panel>

            {playing && match.roundPhase === "voting" && seat !== null && !tableOpen && (
              <Panel title="Vote" weight="rail">
                <p className="mb-2 text-[12px] text-[var(--color-dim)]">
                  {seatRow?.alive
                    ? "The crew is at the table."
                    : "The crew is at the table. You are dead, so you can watch but not vote."}
                </p>
                <button onClick={() => setTableOpen(true)} className="switch switch-primary w-full">
                  {seatRow?.alive ? "Take your seat" : "Watch the vote"}
                </button>
              </Panel>
            )}

            <Panel title="Ballots" weight="rail">
              <BallotBoard match={match} />
            </Panel>

            <Panel title="Pot" weight="rail">
              <PotStats match={match} />
            </Panel>

            {match.phase === MatchPhase.Settled && <DetectiveBreakdown match={match} />}
          </aside>
        </div>

        {/* Bottom: the narrative and the chain, side by side, collapsible so the ship can
            be seen whole when it matters. */}
        <div className="pointer-events-auto">
          <button
            onClick={() => setFeedOpen(!feedOpen)}
            className="switch ml-3 mb-1"
            aria-expanded={feedOpen}
          >
            {feedOpen ? "Hide feed" : "Show feed"}
          </button>
          {feedOpen && (
            <div className="max-h-[26vh] overflow-y-auto bg-[var(--color-hull)]/85 p-3 backdrop-blur">
              <Panel title="Log" weight="rail">
                <EventLog match={match} />
              </Panel>
            </div>
          )}
        </div>
      </div>
    </>
  );
}


function Header({
  cues,
  match,
  live,
  pool,
  config,
  onConnect,
  compact = false,
  wordmark = true,
}: {
  match: MatchView;
  live: boolean;
  pool: PoolClient | null;
  config: ChainConfig;
  onConnect: () => void;
  compact?: boolean;
  /** The landing screen shows the logo image, so the text wordmark would repeat it. */
  wordmark?: boolean;
  /** Passed down rather than hooked here, because the state belongs to the page. */
  cues?: { enabled: boolean; toggle: () => void };
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        {wordmark && (
          <>
            <h1 className={`macro ${compact ?"macro-sm" :"macro-lg"}`}>
              CrewKill
              <span className="numeric ml-[0.3em] text-[var(--color-dim)]">
                #{match.matchId}
              </span>
            </h1>
            {!compact && (
              <p className="text-xs text-[var(--color-dim)]">
                Staked social deduction, settled on-chain through the STRK20 privacy pool.
              </p>
            )}
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PhaseBadge match={match} />
        <Countdown until={match.phaseEndsAt} />
        {!live && (
          <span className="border border-[var(--color-amber)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--color-amber)]">
            reconnecting
          </span>
        )}
        <PrimerButton />
        <a href="/history" className="switch no-underline">
          Archive
        </a>
        <SubstrateSwitch />
        {cues && <CueToggle enabled={cues.enabled} onToggle={cues.toggle} />}
        {pool ? (
          <span className="border border-[var(--color-line)] px-2 py-1 text-[11px] text-[var(--color-dim)]">
            {config.network} / {pool.address.slice(0, 6)}…{pool.address.slice(-4)}
          </span>
        ) : (
          <button
            onClick={onConnect}
            className="switch switch-primary"
          >
            {config.realPool ?"Connect privacy wallet" :"Use devnet key"}
          </button>
        )}
      </div>
    </header>
  );
}

function ErrorBar({ message }: { message: string }) {
  return (
    <div className="mt-2  border border-[var(--color-alarm)]/40 bg-[var(--color-alarm)]/10 px-4 py-2 text-sm text-[var(--color-alarm)]">
      {message}
    </div>
  );
}

function SeatSummary({
  seat,
  yourSeat,
  yourRole,
}: {
  seat: SeatKeypair;
  yourSeat: number | null;
  yourRole:"crew" |"impostor" | null;
}) {
  return (
    <div className="space-y-3 text-[13px]">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Seat" value={yourSeat === null ?"pending" : `#${yourSeat}`} />
        <Stat
          label="Role"
          value={yourRole ??"sealed"}
          tone={
            yourRole ==="impostor"
              ?"text-[var(--color-alarm)]"
              : yourRole ==="crew"
                ?"text-[var(--color-cyan)]"
                :"text-[var(--color-dim)]"
          }
        />
      </div>
      <p className="text-[12px] text-[var(--color-dim)]">
        Your role is computed in this browser from a secret the keeper has never seen. Keep the
        backup - it is the only thing that can claim a payout.
      </p>
      <details>
        <summary className="cursor-pointer text-[12px] text-[var(--color-dim)] hover:text-[var(--color-ink)]">
          seat backup
        </summary>
        <textarea
          readOnly
          value={exportSeat(seat)}
          onFocus={(event) => event.currentTarget.select()}
          className="mt-2 h-24 w-full  border border-[var(--color-line)] bg-[var(--color-hull)] p-2 text-[11px]"
        />
        <SeatBackupActions seat={seat} />
      </details>
    </div>
  );
}

/**
 * Getting the seat secret somewhere safe.
 *
 * This is the only thing that can claim a payout. If it is lost the money is unreachable -
 * not by us, not by anyone. A read-only textarea you have to select by hand is a poor way to
 * treat that, so this offers a copy and a real file, and says plainly what it is for.
 */
function SeatBackupActions({ seat }: { seat: SeatKeypair }) {
  const [copied, setCopied] = useState(false);

  const download = () => {
    const blob = new Blob([exportSeat(seat)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `crewkill-seat-${seat.matchId}.json`;
    link.click();
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className="mt-2">
      <div className="flex gap-2">
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(exportSeat(seat));
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // Clipboard can be refused; the textarea above is still selectable.
              setCopied(false);
            }
          }}
          className="switch flex-1"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button onClick={download} className="switch flex-1">
          Download
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-dim)]">
        This is the only thing that can claim your payout. It is held in this browser and
        nowhere else, so clearing site data without a copy loses the money permanently.
      </p>
    </div>
  );
}

function PotStats({ match }: { match: MatchView }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Stake / seat" value={match.stakeAmount} />
        <Stat label="Pot" value={match.potAmount} tone="text-[var(--color-amber)]" />
        <Stat label="Detective pool" value={`${match.detectiveBps / 100}%`} />
        <Stat label="Impostor draw" value={`${match.impostorBps / 100}%`} />
      </div>
      <div className="mt-4">
        <CrewProgress match={match} />
      </div>
    </>
  );
}
