/**
 * The keeper.
 *
 * Starknet has no timers, so something off-chain has to say "the meeting is over now". That
 * is this file's entire job. It also plays the house agents, mirrors chain state into
 * Postgres for the UI, and reveals agent seats when the match ends.
 *
 * What it deliberately cannot do: change a role, read a human's role, alter a tally, or
 * decide who won. Every one of those is computed by `settle` on-chain from public inputs,
 * and this engine reads the answer back rather than producing it.
 */

import {
  BallotKind,
  DEFAULT_MATCH,
  MatchPhase,
  NO_TARGET,
  PHASE_SECONDS,
  assignPersonas,
  claimCommitment,
  isImpostor,
  killCommitment,
  randomFelt,
  seatCommitment,
  seedCommitment,
  voteReceipt,
  type RoundPhase,
} from "@crewkill/protocol";
import type { Account, RpcProvider } from "starknet";
import type { KeeperConfig } from "../config.js";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { makeAccount } from "../chain/client.js";
import type { CrewKillContract, Deployment } from "../chain/crewkill.js";
import { MockPoolSeat, type SeatWallet } from "../chain/pool.js";
import { GameMemory } from "./memory.js";
import {
  EMERGENCY_MEETINGS_PER_SEAT,
  SABOTAGE_CONFIG,
  SabotageType,
  locationName,
} from "./ship.js";
import {
  ActionType,
  strategyFor,
  type AgentAction,
  type StrategyContext,
} from "./strategies.js";
import { World } from "./world.js";
import { shipMapForSeed } from "@crewkill/protocol";

const log = logger.child({ module: "engine" });

/** Action ticks per night. Enough for people to move, work, and get caught. */
const TICKS_PER_ROUND = 3;
/** How far past its deadline a phase may drift before the keeper complains. */
const STALL_THRESHOLD_MS = 60_000;

export interface EngineDeps {
  config: KeeperConfig;
  deployment: Deployment;
  provider: RpcProvider;
  keeperAccount: Account;
  game: CrewKillContract;
  /** Devnet accounts the house agents play from. Empty on networks with a real pool. */
  agentAccounts: Array<{ address: string; private_key: string }>;
  broadcast: (matchId: number) => void;
}

/** Live, per-match state the database does not need to hold between ticks. */
interface RuntimeMatch {
  dbId: number;
  onchainId: number;
  operatorSeed: bigint;
  world: World | null;
  /** True once we have announced that the room is waiting, so it is said once, not every tick. */
  heldOnce?: boolean;
  agents: Map<
    number,
    {
      wallet: SeatWallet;
      memory: GameMemory;
      strategy: ReturnType<typeof strategyFor>;
      strategySecret: bigint;
      claimSecret: bigint;
      isImpostor: boolean;
    }
  >;
  /** Actions humans queued from the browser, consumed once. */
  queuedActions: Map<number, AgentAction>;
  /** A body or an emergency button cuts the night short. */
  meetingPending: boolean;
  /** Which action tick of the current night we are on. */
  tick: number;
  /** Pending agent seat material, keyed by commitment, until the seat index is known. */
  pendingAgents: Array<{
    roleSecret: bigint;
    claimSecret: bigint;
    commitment: bigint;
    wallet: SeatWallet;
  }>;
  /** Who each seat named in the meeting, this round. */
  accusations: Map<number, number>;
  /** Set once per (round, phase) so agent actions are not submitted twice. */
  actedPhases: Set<string>;
  /** In-flight agent transactions for the current phase. The clock waits for these. */
  pending: Promise<unknown> | null;
}

/**
 * Leases agent accounts to matches.
 *
 * Two matches sharing one account means two transactions racing for one nonce, and the
 * loser silently misses its vote — which looks exactly like an agent choosing to abstain.
 * Leasing makes that impossible rather than rare.
 */
class AgentAccountPool {
  private readonly leased = new Map<number, Array<{ address: string; private_key: string }>>();

  constructor(private readonly accounts: Array<{ address: string; private_key: string }>) {}

  available(): number {
    return this.accounts.length - [...this.leased.values()].reduce((n, a) => n + a.length, 0);
  }

  lease(matchId: number, count: number): Array<{ address: string; private_key: string }> | null {
    if (this.available() < count) return null;
    const taken = new Set(
      [...this.leased.values()].flat().map((account) => account.address),
    );
    const free = this.accounts.filter((account) => !taken.has(account.address));
    const slice = free.slice(0, count);
    this.leased.set(matchId, [...(this.leased.get(matchId) ?? []), ...slice]);
    return slice;
  }

  release(matchId: number): void {
    this.leased.delete(matchId);
  }
}

export class Engine {
  private readonly runtime = new Map<number, RuntimeMatch>();
  private readonly agentPool: AgentAccountPool;
  /** A tick can outlast its interval — overlapping ticks would open duplicate lobbies. */
  private ticking = false;

  constructor(private readonly deps: EngineDeps) {
    this.agentPool = new AgentAccountPool(deps.agentAccounts);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────────────

  /** Opens a lobby: one on-chain `create_match`, mirrored into the database. */
  async openMatch(overrides: Partial<typeof DEFAULT_MATCH> & { stakeAmount?: bigint } = {}) {
    const shape = { ...DEFAULT_MATCH, ...overrides };
    const stakeAmount = overrides.stakeAmount ?? defaultStake(this.deps.config);
    const operatorSeed = randomFelt();

    const { matchId, txHash } = await this.deps.game.createMatch({
      stakeAmount,
      seatCount: shape.seatCount,
      rounds: shape.rounds,
      impostorBps: shape.impostorBps,
      detectiveBps: shape.detectiveBps,
      protocolBps: shape.protocolBps,
      seedCommitment: seedCommitment(operatorSeed),
    });

    const deployment = await this.deploymentRow();
    const row = await prisma.match.create({
      data: {
        deploymentId: deployment.id,
        onchainId: BigInt(matchId),
        phase: MatchPhase.Lobby,
        rounds: shape.rounds,
        seatCount: shape.seatCount,
        stakeAmount: stakeAmount.toString(),
        impostorBps: shape.impostorBps,
        detectiveBps: shape.detectiveBps,
        protocolBps: shape.protocolBps,
        seedCommitment: `0x${seedCommitment(operatorSeed).toString(16)}`,
        phaseEndsAt: new Date(Date.now() + PHASE_SECONDS.lobby * 1000),
      },
    });

    this.runtime.set(row.id, {
      dbId: row.id,
      onchainId: matchId,
      operatorSeed,
      world: null,
      agents: new Map(),
      pendingAgents: [],
      queuedActions: new Map(),
      accusations: new Map(),
      meetingPending: false,
      tick: 0,
      actedPhases: new Set(),
      pending: null,
    });

    await this.recordTx(row.id, "create_match", txHash);
    await this.event(row.id, 0, "match_created", `Lobby open - ${shape.seatCount} seats.`);
    log.info({ matchId, txHash }, "match created");
    this.deps.broadcast(row.id);
    return row;
  }

  /** One pass of the clock. Called on a fixed interval from `index.ts`. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const open = await prisma.match.findMany({
        where: { phase: { in: [MatchPhase.Lobby, MatchPhase.Playing, MatchPhase.Revealing] } },
        include: { seats: true },
      });
      for (const row of open) {
        try {
          await this.advance(row.id);
        } catch (error) {
          log.error({ err: error, matchId: row.id }, "tick failed");
        }
      }
      // A settled match is not finished until its payouts are collected. Humans claim on
      // their own schedule, so keep mirroring those seats rather than freezing the view at
      // the moment of settlement.
      const settled = await prisma.match.findMany({
        where: { phase: MatchPhase.Settled, seats: { some: { claimed: false, payout: { not: "0" } } } },
        take: 5,
        orderBy: { id: "desc" },
      });
      for (const row of settled) {
        try {
          await this.refreshSeats(row.id, Number(row.onchainId));
        } catch (error) {
          log.warn({ err: error, matchId: row.id }, "settled-match refresh failed");
        }
      }

      // Keep exactly one lobby open. A second would split what turnout there is.
      // Only open a lobby the house can actually staff, or it will abort the moment the
      // countdown ends and strand whoever did turn up.
      const hasLobby = open.some((row) => row.phase === MatchPhase.Lobby);
      const canStaff = this.agentPool.available() >= DEFAULT_MATCH.seatCount;
      if (this.deps.config.autoMatch && !hasLobby && canStaff) {
        await this.openMatch();
      }
    } finally {
      this.ticking = false;
    }
  }

  private async advance(dbId: number): Promise<void> {
    const row = await prisma.match.findUniqueOrThrow({
      where: { id: dbId },
      include: { seats: { orderBy: { index: "asc" } } },
    });
    const state = this.runtime.get(dbId);
    if (!state) {
      // A restart lost the operator seed for a lobby that never started. Nothing can start
      // it now — abort so stakes go back rather than stranding them.
      if (row.phase === MatchPhase.Lobby && !row.finalSeed) {
        await this.abandon(row.id, Number(row.onchainId));
      }
      return;
    }

    await this.syncFromChain(row.id, state);
    const fresh = await prisma.match.findUniqueOrThrow({
      where: { id: dbId },
      include: { seats: { orderBy: { index: "asc" } } },
    });

    const overdue = fresh.phaseEndsAt
      ? Date.now() - fresh.phaseEndsAt.getTime()
      : 0;
    const expired = overdue > 0;
    if (overdue > STALL_THRESHOLD_MS) {
      // Something downstream is wedged. Say so loudly — a silent stall in a live match reads
      // to a player as the game having eaten their stake.
      log.warn(
        { matchId: fresh.id, phase: fresh.phase, roundPhase: fresh.roundPhase, overdue },
        "phase is badly overdue",
      );
      if (state.pending) state.pending = null;
    }

    switch (fresh.phase) {
      case MatchPhase.Lobby:
        if (expired) {
          // Never start a match nobody joined.
          //
          // The lobby used to fill every empty seat with house agents the moment the clock
          // ran out, so an empty room became six agents playing a full game to an audience
          // of nobody. That is a screensaver, not a game, and it also meant a visitor
          // arriving mid-match could only ever spectate something already in progress.
          //
          // Agents exist to round out a game for a real player, not to play games in their
          // absence. With nobody seated the lobby simply stays open and waits.
          if (fresh.seatsFilled === 0) {
            await this.holdLobby(state);
          } else {
            await this.closeLobby(state, fresh.seatCount, fresh.seatsFilled);
          }
        }
        break;
      case MatchPhase.Playing:
        await this.runRound(state, expired);
        break;
      case MatchPhase.Revealing:
        await this.finishReveal(state, expired);
        break;
      default:
        break;
    }
    this.deps.broadcast(dbId);
  }

  // ── lobby ──────────────────────────────────────────────────────────────────────────

  /**
   * Fills whatever humans left empty and locks the roster. This is the cold-start fix: the
   * match runs on schedule regardless of turnout, so a player who does show up is never
   * left waiting in an empty room for people who are not coming.
   */
  /**
   * Keeps an unjoined lobby open instead of starting it.
   *
   * The deadline is pushed out rather than removed, so the countdown on screen keeps
   * meaning something: it is the wait until agents would fill in, and it restarts each time
   * it lapses with the room still empty.
   */
  private async holdLobby(state: RuntimeMatch): Promise<void> {
    await prisma.match.update({
      where: { id: state.dbId },
      data: { phaseEndsAt: new Date(Date.now() + PHASE_SECONDS.lobby * 1000) },
    });
    if (!state.heldOnce) {
      state.heldOnce = true;
      await this.event(
        state.dbId,
        0,
        "lobby_waiting",
        "Waiting for a player. House agents fill the remaining seats once somebody takes one.",
      );
      log.info({ matchId: state.onchainId }, "lobby held open, nobody seated");
    }
    this.deps.broadcast(state.dbId);
  }

  private async closeLobby(
    state: RuntimeMatch,
    seatCount: number,
    seatsFilled: number,
  ): Promise<void> {
    // Idempotent from here down: a tick that dies mid-way must be safe to repeat, and the
    // chain is the thing that knows how far we actually got.
    let onchain = await this.deps.game.getMatch(state.onchainId);

    if (onchain.phase === MatchPhase.Lobby) {
      const missing = seatCount - seatsFilled;
      if (missing > 0) {
        const leased = this.agentPool.lease(state.dbId, missing);
        if (!leased) {
          log.warn({ missing }, "no free agent accounts to fill the lobby - aborting");
          await this.abandon(state.dbId, state.onchainId);
          return;
        }
        const stake = BigInt(
          (await prisma.match.findUniqueOrThrow({ where: { id: state.dbId } })).stakeAmount,
        );

        // Agents buy their seats exactly the way a human does — shield, then stake through
        // the pool — rather than through the keeper-only `fill_agent_seat` shortcut. That
        // matters for more than symmetry: a seat bought through the pool is the only kind
        // that receives ballot notes, so an agent that skipped the queue could not vote.
        // The house funds the stake, so an agent losing costs the treasury real value.
        await Promise.all(
          Array.from({ length: missing }, async (_unused, i) => {
            const wallet = this.makeWallet(`agent-${i}`, leased[i]);
            const roleSecret = randomFelt();
            const claimSecret = randomFelt();
            const commitment = seatCommitment(roleSecret, claimCommitment(claimSecret));
            await wallet.shield(stake);
            const txHash = await wallet.joinSeat(state.onchainId, commitment, stake);
            state.pendingAgents.push({ roleSecret, claimSecret, commitment, wallet });
            await this.recordTx(state.dbId, "agent_join_seat", txHash);
          }),
        );
        await this.event(
          state.dbId,
          0,
          "agent_seat",
          `${missing} seat${missing === 1 ? "" : "s"} auto-filled by house agents.`,
        );
      }

      const startTx = await this.deps.game.startMatch(state.onchainId, state.operatorSeed);
      await this.recordTx(state.dbId, "start_match", startTx);
      onchain = await this.deps.game.getMatch(state.onchainId);
      log.info({ matchId: state.onchainId, startTx }, "match started");
    }

    // Personas are drawn from `final_seed`, so which face a seat wears is as unbiasable as
    // its role — the operator cannot signal anything through the roster.
    const personas = assignPersonas(onchain.finalSeed, onchain.seatCount);
    await this.materializeSeats(state, onchain.seatCount, personas);

    for (let index = 0; index < onchain.seatCount; index += 1) {
      const seat = await this.deps.game.getSeat(state.onchainId, index);
      const pending = state.pendingAgents.find((p) => p.commitment === seat.seatCommitment);
      if (!pending) continue;
      const impostor = isImpostor(onchain.finalSeed, pending.roleSecret, onchain.impostorBps);
      const memory = new GameMemory(shipMapForSeed(onchain.finalSeed));
      state.agents.set(index, {
        wallet: pending.wallet,
        memory,
        strategy: strategyFor(
          personas[index],
          impostor ? "impostor" : "crew",
          pending.roleSecret,
          memory,
        ),
        strategySecret: pending.roleSecret,
        claimSecret: pending.claimSecret,
        isImpostor: impostor,
      });
      await prisma.seat.update({
        where: { matchId_index: { matchId: state.dbId, index } },
        data: {
          // The chain cannot tell an agent seat from a human one when both are bought
          // through the pool — which is the point. The keeper knows only because it
          // generated these commitments itself.
          isAgent: true,
          agentRoleSecret: `0x${pending.roleSecret.toString(16)}`,
          agentClaimSecret: `0x${pending.claimSecret.toString(16)}`,
        },
      });
    }
    state.pendingAgents = [];
    state.world = new World(onchain.finalSeed, onchain.seatCount, shipMapForSeed(onchain.finalSeed));
    state.tick = 0;

    await prisma.match.update({
      where: { id: state.dbId },
      data: {
        phase: MatchPhase.Playing,
        seatsFilled: onchain.seatsFilled,
        potAmount: onchain.pot.toString(),
        finalSeed: `0x${onchain.finalSeed.toString(16)}`,
        operatorSeed: `0x${state.operatorSeed.toString(16)}`,
        round: 1,
        roundPhase: "night",
        phaseEndsAt: new Date(Date.now() + PHASE_SECONDS.night * 1000),
      },
    });
    await this.mirrorWorld(state);
    await this.event(
      state.dbId,
      0,
      "match_started",
      "Roster locked. Roles drawn - nobody, including us, knows who is who.",
    );
  }

  /** Queues an action a human submitted from the browser for the next tick. */
  queueAction(dbId: number, seatIndex: number, action: AgentAction): boolean {
    const state = this.runtime.get(dbId);
    if (!state?.world?.seat(seatIndex)?.alive) return false;
    state.queuedActions.set(seatIndex, action);
    return true;
  }

  /** Creates or refreshes a row per on-chain seat. Safe to call repeatedly. */
  private async materializeSeats(
    state: RuntimeMatch,
    seatCount: number,
    personas: ReturnType<typeof assignPersonas>,
  ): Promise<void> {
    for (let index = 0; index < seatCount; index += 1) {
      const seat = await this.deps.game.getSeat(state.onchainId, index);
      if (seat.seatCommitment === 0n) continue;
      await prisma.seat.upsert({
        where: { matchId_index: { matchId: state.dbId, index } },
        create: {
          matchId: state.dbId,
          index,
          seatCommitment: `0x${seat.seatCommitment.toString(16)}`,
          persona: personas[index].name,
          emoji: personas[index].emoji,
          isAgent: seat.isAgent,
        },
        update: {
          persona: personas[index].name,
          emoji: personas[index].emoji,
          isAgent: seat.isAgent,
        },
      });
    }
  }

  // ── play ───────────────────────────────────────────────────────────────────────────

  /**
   * One round is a handful of action ticks — everyone moving, working, watching, killing —
   * followed by a meeting and a vote. The ticks are where the evidence comes from; without
   * them a meeting is six agents guessing.
   */
  private async runRound(state: RuntimeMatch, expired: boolean): Promise<void> {
    const row = await prisma.match.findUniqueOrThrow({
      where: { id: state.dbId },
      include: { seats: { orderBy: { index: "asc" } } },
    });
    if (!row.finalSeed || !state.world) return;
    const phase = (row.roundPhase ?? "night") as RoundPhase;

    if (phase === "night") {
      // A critical sabotage nobody fixed is a loss, not a formality.
      if (state.world.sabotageExpired(Date.now())) {
        await this.event(
          state.dbId,
          row.round,
          "body_found",
          `${SABOTAGE_CONFIG[state.world.sabotage!.type].name} ran out of time. The ship is lost.`,
        );
        state.world.clearSabotage();
        await this.endPlay(state, row.round);
        return;
      }

      const key = `${row.round}:tick:${state.tick}`;
      if (!state.actedPhases.has(key) && state.tick < TICKS_PER_ROUND) {
        state.actedPhases.add(key);
        state.pending = this.runActionTick(state, row.round).catch((error) => {
          log.warn({ err: error }, "action tick failed");
        });
        state.tick += 1;
      }
    }

    const meetingKey = `${row.round}:${phase}`;
    if (phase !== "night" && !state.actedPhases.has(meetingKey)) {
      state.actedPhases.add(meetingKey);
      state.pending = this.runMeetingPhase(state, row.round, phase).catch((error) => {
        log.warn({ err: error }, "meeting phase failed");
      });
    }

    // A body found or a meeting called cuts the night short, exactly as it should.
    const interrupted = phase === "night" && state.meetingPending;
    if (!expired && !interrupted && !(phase === "night" && state.tick >= TICKS_PER_ROUND)) {
      return;
    }
    if (state.pending) {
      await state.pending;
      state.pending = null;
    }

    const next = await this.nextPhase(state, row.round, phase);
    if (next) {
      await prisma.match.update({
        where: { id: state.dbId },
        data: {
          round: next.round,
          roundPhase: next.phase,
          phaseEndsAt: new Date(Date.now() + PHASE_SECONDS[next.phase === "meeting" ? "meeting" : next.phase === "voting" ? "voting" : "night"] * 1000),
        },
      });
      if (next.phase === "night") state.tick = 0;
    }
  }

  /**
   * Everyone acts once. Agents ask their strategy; human seats play whatever they queued
   * from the browser, and idle if they queued nothing.
   */
  private async runActionTick(state: RuntimeMatch, round: number): Promise<void> {
    const world = state.world!;
    const row = await prisma.match.findUniqueOrThrow({
      where: { id: state.dbId },
      include: { seats: { orderBy: { index: "asc" } } },
    });
    const name = (seat: number) => row.seats[seat]?.persona ?? `Seat ${seat}`;

    for (const seat of world.alive()) {
      const agent = state.agents.get(seat.index);
      const queued = state.queuedActions.get(seat.index);
      state.queuedActions.delete(seat.index);

      const action = agent
        ? agent.strategy.decideAction(this.contextFor(state, seat.index, round))
        : queued;
      if (!action) continue;

      await this.applyAction(state, seat.index, action, round, name);
      if (state.meetingPending) break;
    }

    // Everyone's memory updates from what they could actually see, not from a global feed.
    for (const [index, agent] of state.agents) {
      const self = world.seat(index);
      if (!self?.alive) continue;
      agent.memory.setRound(round);
      for (const other of world.aliveAt(self.location)) {
        if (other.index !== index) {
          agent.memory.recordMovement(other.index, other.location, other.location, round);
        }
      }
    }
  }

  /** Applies one action to the world, and to the chain when the action costs money. */
  private async applyAction(
    state: RuntimeMatch,
    seatIndex: number,
    action: AgentAction,
    round: number,
    name: (seat: number) => string,
  ): Promise<void> {
    const world = state.world!;
    const agent = state.agents.get(seatIndex);

    switch (action.type) {
      case ActionType.Move: {
        if (action.destination === undefined) return;
        const result = world.move(seatIndex, action.destination);
        if (result.ok) {
          for (const [, other] of state.agents) {
            other.memory.recordMovement(seatIndex, seatIndex, action.destination, round);
          }
        }
        return;
      }

      case ActionType.DoTask: {
        const result = world.doTask(seatIndex);
        if (result.completed) {
          for (const witness of world.witnessesAt(world.seat(seatIndex)!.location, [seatIndex])) {
            state.agents.get(witness)?.memory.recordTaskCompletion(seatIndex);
          }
          await this.event(
            state.dbId,
            round,
            "chat",
            `${name(seatIndex)} finished a task in ${locationName(world.map, world.seat(seatIndex)!.location)}.`,
            seatIndex,
          );
        }
        return;
      }

      case ActionType.FakeTask:
        // Looks identical from the outside. That is the entire point of it.
        return;

      case ActionType.UseCams: {
        world.watchCameras(seatIndex);
        return;
      }

      case ActionType.Vent: {
        if (action.destination === undefined) return;
        const result = world.useVent(seatIndex, action.destination, true);
        if (result.ok) {
          for (const witness of result.witnesses ?? []) {
            state.agents
              .get(witness)
              ?.memory.recordVentSighting(seatIndex, action.destination, round);
          }
          if ((result.witnesses ?? []).length > 0) {
            await this.event(
              state.dbId,
              round,
              "chat",
              `Someone saw ${name(seatIndex)} come out of a vent in ${locationName(state.world!.map, action.destination)}.`,
              seatIndex,
            );
          }
        }
        return;
      }

      case ActionType.Sabotage: {
        if (action.sabotage === undefined) return;
        const started = world.startSabotage(seatIndex, action.sabotage, round, Date.now());
        if (started) {
          const config = SABOTAGE_CONFIG[started.type];
          await prisma.match.update({
            where: { id: state.dbId },
            data: {
              sabotage: started.type,
              sabotageEndsAt: started.expiresAt ? new Date(started.expiresAt) : null,
            },
          });
          await this.event(state.dbId, round, "body_found", `${config.name}. Fix it or die.`);
        }
        return;
      }

      case ActionType.FixSabotage: {
        const result = world.fixSabotage(seatIndex);
        if (result.fixed) {
          await prisma.match.update({
            where: { id: state.dbId },
            data: { sabotage: 0, sabotageEndsAt: null },
          });
          await this.event(
            state.dbId,
            round,
            "chat",
            `${name(seatIndex)} got the ship back online.`,
            seatIndex,
          );
        }
        return;
      }

      case ActionType.Report: {
        const body = world.reportBody(seatIndex);
        if (body) {
          for (const [, other] of state.agents) other.memory.recordReport(seatIndex, round);
          await this.event(
            state.dbId,
            round,
            "body_found",
            `${name(seatIndex)} found ${name(body.victim)} in ${locationName(state.world!.map, body.location)}.`,
            seatIndex,
            body.victim,
          );
          state.meetingPending = true;
        }
        return;
      }

      case ActionType.CallMeeting: {
        const result = world.callEmergencyMeeting(seatIndex);
        if (result.ok) {
          for (const [, other] of state.agents) other.memory.recordMeeting(seatIndex);
          await this.event(
            state.dbId,
            round,
            "meeting_called",
            `${name(seatIndex)} slammed the emergency button.`,
            seatIndex,
          );
          state.meetingPending = true;
        }
        return;
      }

      case ActionType.Kill: {
        if (action.target === undefined) return;
        const result = world.kill(seatIndex, action.target, round);
        if (!result.ok) return;

        // The elimination is recorded on-chain as a private ballot spend, so the killer's
        // seat stays hidden. The world already applied it — the chain is what makes it count
        // at settlement, and an unbacked claim costs the claimant their stake.
        if (agent) {
          try {
            const txHash = await agent.wallet.castBallot({
              matchId: state.onchainId,
              commitment: killCommitment(agent.strategySecret, round, action.target),
              kind: BallotKind.Kill,
              round,
              targetSeat: action.target,
            });
            await this.recordTx(state.dbId, "night_action", txHash);
          } catch (error) {
            log.warn({ err: error, seatIndex }, "night action failed to land on-chain");
          }
        }

        await prisma.seat.update({
          where: { matchId_index: { matchId: state.dbId, index: action.target } },
          data: { alive: false, eliminatedRound: round, eliminatedBy: "kill" },
        });
        for (const witness of result.witnesses ?? []) {
          state.agents
            .get(witness)
            ?.memory.recordKill(action.target, result.location!, round, [seatIndex, witness]);
        }
        if ((result.witnesses ?? []).length > 0) {
          await this.event(
            state.dbId,
            round,
            "body_found",
            `${name(action.target)} went dark in ${locationName(state.world!.map, result.location!)} - and somebody was watching.`,
            action.target,
          );
          state.meetingPending = true;
        }
        return;
      }

      default:
        return;
    }
  }

  /** Meeting chatter, then on-chain ballots. */
  private async runMeetingPhase(
    state: RuntimeMatch,
    round: number,
    phase: RoundPhase,
  ): Promise<void> {
    const world = state.world!;
    const row = await prisma.match.findUniqueOrThrow({
      where: { id: state.dbId },
      include: { seats: { orderBy: { index: "asc" } } },
    });
    const name = (seat: number) => row.seats[seat]?.persona ?? `Seat ${seat}`;

    if (phase === "meeting") {
      world.gatherEveryone();
      for (const [index, agent] of state.agents) {
        if (!world.seat(index)?.alive) continue;
        const vote = agent.strategy.decideVote(this.contextFor(state, index, round));
        if (vote !== null) {
          state.accusations.set(index, vote);
          const suspicion = agent.memory.scoreFor(vote);
          const reason = suspicion?.reasons.at(-1)?.details;
          await this.event(
            state.dbId,
            round,
            "chat",
            reason
              ? `${name(index)}: ${name(vote)} was ${reason}. I'm voting ${name(vote)}.`
              : `${name(index)}: nothing adds up around ${name(vote)}. Voting ${name(vote)}.`,
            index,
            vote,
          );
        } else {
          await this.event(
            state.dbId,
            round,
            "chat",
            `${name(index)}: not enough to go on. I'd rather skip than throw a body away.`,
            index,
          );
        }
      }
      return;
    }

    if (phase === "voting") {
      await Promise.all(
        [...state.agents].map(async ([index, agent]) => {
          if (!world.seat(index)?.alive) return;
          const target = state.accusations.get(index) ?? NO_TARGET;
          try {
            const txHash = await agent.wallet.castBallot({
              matchId: state.onchainId,
              commitment: voteReceipt(agent.strategySecret, round, target),
              kind: BallotKind.Vote,
              round,
              targetSeat: target,
            });
            await this.recordTx(state.dbId, "vote", txHash);
          } catch (error) {
            log.warn({ err: error, index }, "agent vote failed");
          }
        }),
      );
    }
  }

  /** Everything a strategy is allowed to know. */
  private contextFor(state: RuntimeMatch, seatIndex: number, round: number): StrategyContext {
    const world = state.world!;
    const self = world.seat(seatIndex)!;
    const agent = state.agents.get(seatIndex);
    // Impostors know each other only among *agent* seats — the keeper cannot see a human's
    // role, so a human partner is as invisible to an agent as they are to everyone else.
    const knownImpostors = agent?.isImpostor
      ? [...state.agents].filter(([, other]) => other.isImpostor).map(([index]) => index)
      : [];
    const counts = new Map<number, number>();
    for (const target of state.accusations.values()) {
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      map: world.map,
      self: seatIndex,
      tick: state.tick,
      myLocation: self.location,
      round,
      role: agent?.isImpostor ? "impostor" : "crew",
      seats: [...world.seats.values()].map((seat) => ({
        index: seat.index,
        location: seat.location,
        alive: seat.alive,
        tasksCompleted: seat.tasksCompleted,
        inVent: seat.inVent,
      })),
      bodies: world.bodies,
      knownImpostors,
      taskLocations: self.taskLocations,
      tasksCompleted: self.tasksCompleted,
      totalTasks: self.taskLocations.length,
      activeSabotage: world.sabotage?.type ?? SabotageType.None,
      meetingsLeft: EMERGENCY_MEETINGS_PER_SEAT - self.emergencyMeetingsUsed,
      sabotageReady: world.canSabotage(seatIndex, round),
      topChatSuspect: top ? top[0] : null,
    };
  }

  private async nextPhase(
    state: RuntimeMatch,
    round: number,
    phase: RoundPhase,
  ): Promise<{ round: number; phase: RoundPhase } | null> {
    if (phase === "night") {
      state.meetingPending = false;
      await this.mirrorWorld(state);
      await this.event(state.dbId, round, "meeting_called", "Emergency meeting.");
      return { round, phase: "meeting" };
    }
    if (phase === "meeting") return { round, phase: "voting" };
    if (phase === "voting") {
      await this.resolveVote(state, round);
      state.accusations.clear();
      await this.mirrorWorld(state);

      const row = await prisma.match.findUniqueOrThrow({
        where: { id: state.dbId },
        include: { seats: true },
      });
      const world = state.world!;
      const aliveCount = world.alive().length;
      const crewSeats = [...state.agents]
        .filter(([, agent]) => !agent.isImpostor)
        .map(([index]) => index);
      const tasksDone = world.taskProgressRatio(crewSeats) >= 1;
      if (tasksDone) {
        await this.event(state.dbId, round, "vote_result", "Every task is done. The crew wins.");
      }

      const over =
        tasksDone ||
        round >= row.rounds ||
        aliveCount <= 2 ||
        (await this.impostorsAllDown(state));
      if (over) {
        await this.endPlay(state, round);
        return null;
      }
      return { round: round + 1, phase: "night" };
    }
    return null;
  }

  private async resolveVote(state: RuntimeMatch, round: number): Promise<number | null> {
    const row = await prisma.match.findUniqueOrThrow({
      where: { id: state.dbId },
      include: { seats: { orderBy: { index: "asc" } } },
    });
    const world = state.world!;
    let top = -1;
    let topVotes = 0;
    let tied = false;
    for (const seat of row.seats) {
      const votes = await this.deps.game.getTally(state.onchainId, round, seat.index);
      if (votes > topVotes) {
        topVotes = votes;
        top = seat.index;
        tied = false;
      } else if (votes === topVotes && votes > 0) {
        tied = true;
      }
    }
    const skips = await this.deps.game.getTally(state.onchainId, round, NO_TARGET);
    const nobody = tied || topVotes === 0 || topVotes <= skips || top < 0;

    await this.event(
      state.dbId,
      round,
      "vote_result",
      nobody
        ? `The vote splits - nobody is ejected. (${skips} skipped)`
        : `${row.seats[top]?.persona} is ejected with ${topVotes} votes.`,
    );

    // Everyone learns from the outcome — but only the keeper's own agents can be checked
    // against a known role, so that is the only case where hindsight is honest.
    const ejectedAgent = nobody ? null : state.agents.get(top);
    for (const [, agent] of state.agents) {
      agent.memory.recordVote(
        round,
        new Map(state.accusations),
        nobody ? null : top,
        ejectedAgent ? ejectedAgent.isImpostor : null,
      );
    }
    if (nobody) return null;

    world.seat(top)!.alive = false;
    await prisma.seat.update({
      where: { matchId_index: { matchId: state.dbId, index: top } },
      data: { alive: false, eliminatedRound: round, eliminatedBy: "vote" },
    });
    await this.event(state.dbId, round, "ejected", `${row.seats[top]?.persona} floats away.`, top);
    return top;
  }

  /** Copies the live ship into the mirror so the client can draw it. */
  private async mirrorWorld(state: RuntimeMatch): Promise<void> {
    const world = state.world;
    if (!world) return;
    for (const seat of world.seats.values()) {
      await prisma.seat.update({
        where: { matchId_index: { matchId: state.dbId, index: seat.index } },
        data: {
          location: seat.location,
          tasksCompleted: seat.tasksCompleted,
          totalTasks: seat.taskLocations.length,
          inVent: seat.inVent,
          onCameras: seat.onCameras,
          alive: seat.alive,
        },
      });
    }
    await prisma.match.update({
      where: { id: state.dbId },
      data: {
        sabotage: world.sabotage?.type ?? 0,
        sabotageEndsAt: world.sabotage?.expiresAt ? new Date(world.sabotage.expiresAt) : null,
      },
    });
  }

  /**
   * Whether every impostor is already out. Only answerable for agent seats, whose secrets
   * the keeper holds — a human impostor stays unknown until the reveal, which is the point.
   * A match that drew no impostors at all still runs its full length, because ending early
   * would announce the one thing the draw is meant to keep uncertain.
   */
  private async impostorsAllDown(state: RuntimeMatch): Promise<boolean> {
    const row = await prisma.match.findUniqueOrThrow({
      where: { id: state.dbId },
      include: { seats: true },
    });
    if (row.seats.some((seat) => seat.alive && !seat.isAgent)) return false;

    let hadImpostor = false;
    for (const [index, agent] of state.agents) {
      if (!agent.isImpostor) continue;
      hadImpostor = true;
      if (state.world?.seat(index)?.alive) return false;
    }
    return hadImpostor;
  }

  // ── reveal and settlement ──────────────────────────────────────────────────────────

  private async endPlay(state: RuntimeMatch, roundsPlayed: number): Promise<void> {
    const txHash = await this.deps.game.endPlay(state.onchainId, roundsPlayed);
    await this.recordTx(state.dbId, "end_play", txHash);
    await prisma.match.update({
      where: { id: state.dbId },
      data: {
        phase: MatchPhase.Revealing,
        roundPhase: null,
        roundsPlayed,
        phaseEndsAt: new Date(Date.now() + PHASE_SECONDS.reveal * 1000),
      },
    });
    await this.event(
      state.dbId,
      roundsPlayed,
      "play_ended",
      "Play over. Seats have the reveal window to publish their role secrets.",
    );

    // Agent seats reveal immediately; the keeper holds their secrets and has no reason to
    // wait. Human seats reveal from the browser, which is the only place their secrets are.
    for (const [, agent] of state.agents) {
      try {
        const hash = await this.deps.game.revealSeat(
          state.onchainId,
          agent.strategySecret,
          claimCommitment(agent.claimSecret),
        );
        await this.recordTx(state.dbId, "reveal_seat", hash);
      } catch (error) {
        log.warn({ err: error }, "agent reveal failed");
      }
    }
  }

  private async finishReveal(state: RuntimeMatch, expired: boolean): Promise<void> {
    if (!expired) return;
    const txHash = await this.deps.game.settleMatch(state.onchainId);
    await this.recordTx(state.dbId, "settle", txHash);
    const onchain = await this.deps.game.getMatch(state.onchainId);
    await prisma.match.update({
      where: { id: state.dbId },
      data: {
        phase: MatchPhase.Settled,
        crewWon: onchain.crewWon,
        impostorCount: onchain.impostorCount,
        detectiveWeightTotal: onchain.detectiveWeightTotal,
        potAmount: onchain.pot.toString(),
        phaseEndsAt: null,
      },
    });
    await this.syncSeats(state);
    await this.event(
      state.dbId,
      onchain.roundsPlayed,
      "settled",
      onchain.crewWon
        ? `Crew wins. ${onchain.impostorCount} impostor${onchain.impostorCount === 1 ? "" : "s"} in the end.`
        : `Impostors win. ${onchain.impostorCount} of them.`,
    );

    // Agents collect their own winnings so the treasury recycles.
    for (const [index, agent] of state.agents) {
      const seat = await this.deps.game.getSeat(state.onchainId, index);
      if (seat.payout > 0n && !seat.claimed) {
        try {
          const hash = await agent.wallet.claim(state.onchainId, agent.claimSecret);
          await this.recordTx(state.dbId, "claim", hash);
        } catch (error) {
          log.warn({ err: error, index }, "agent claim failed");
        }
      }
    }
    await this.syncSeats(state);
    this.agentPool.release(state.dbId);
    this.runtime.delete(state.dbId);
  }

  private async abandon(dbId: number, onchainId: number): Promise<void> {
    try {
      const txHash = await this.deps.game.abortMatch(onchainId);
      await this.recordTx(dbId, "abort_match", txHash);
    } catch (error) {
      log.warn({ err: error }, "abort failed");
    }
    await prisma.match.update({
      where: { id: dbId },
      data: { phase: MatchPhase.Aborted, phaseEndsAt: null, roundPhase: null },
    });
    await this.event(dbId, 0, "settled", "Match abandoned - every stake is refundable in full.");
    this.agentPool.release(dbId);
    this.runtime.delete(dbId);
  }

  // ── mirroring ──────────────────────────────────────────────────────────────────────

  /** Folds contract state into the database. The chain is always the winner of a conflict. */
  private async syncFromChain(dbId: number, state: RuntimeMatch): Promise<void> {
    const onchain = await this.deps.game.getMatch(state.onchainId);
    const row = await prisma.match.findUniqueOrThrow({
      where: { id: dbId },
      include: { seats: true },
    });

    if (onchain.seatsFilled !== row.seatsFilled) {
      const personas = assignPersonas(
        onchain.finalSeed === 0n ? BigInt(row.seedCommitment) : onchain.finalSeed,
        onchain.seatCount,
      );
      for (let index = row.seatsFilled; index < onchain.seatsFilled; index += 1) {
        const seat = await this.deps.game.getSeat(state.onchainId, index);
        await prisma.seat.upsert({
          where: { matchId_index: { matchId: dbId, index } },
          create: {
            matchId: dbId,
            index,
            seatCommitment: `0x${seat.seatCommitment.toString(16)}`,
            persona: personas[index].name,
            emoji: personas[index].emoji,
            isAgent: seat.isAgent,
          },
          update: { isAgent: seat.isAgent },
        });
        await this.event(
          dbId,
          0,
          seat.isAgent ? "agent_seat" : "seat_bought",
          seat.isAgent
            ? `${personas[index].name} joins from the house roster.`
            : `${personas[index].name} - seat taken. No address attached.`,
          index,
        );
      }
      await prisma.match.update({
        where: { id: dbId },
        data: { seatsFilled: onchain.seatsFilled, potAmount: onchain.pot.toString() },
      });
    }
  }

  private async syncSeats(state: RuntimeMatch): Promise<void> {
    await this.refreshSeats(state.dbId, state.onchainId);
  }

  /** Pulls every seat's authoritative state off the contract into the mirror. */
  private async refreshSeats(dbId: number, onchainId: number): Promise<void> {
    const state = { dbId, onchainId };
    const row = await prisma.match.findUniqueOrThrow({
      where: { id: state.dbId },
      include: { seats: true },
    });
    for (const seat of row.seats) {
      const onchain = await this.deps.game.getSeat(state.onchainId, seat.index);
      await prisma.seat.update({
        where: { id: seat.id },
        data: {
          revealed: onchain.revealed,
          roleSecret: onchain.revealed ? `0x${onchain.roleSecret.toString(16)}` : null,
          isImpostor: onchain.revealed ? onchain.isImpostor : null,
          payout: onchain.payout.toString(),
          claimed: onchain.claimed,
          alive: !onchain.eliminated,
          eliminatedRound: onchain.eliminatedRound || null,
        },
      });
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────────────

  private makeWallet(label: string, account: { address: string; private_key: string }): SeatWallet {
    const signer = makeAccount(this.deps.provider, account.address, account.private_key);
    return new MockPoolSeat(
      label,
      signer,
      this.deps.provider,
      this.deps.deployment.pool,
      this.deps.deployment.game,
      this.deps.deployment.stakeToken,
      this.deps.deployment.ballot,
    );
  }

  /**
   * Tops the treasury up to cover `amount` of agent stakes.
   *
   * On devnet the stake token is a mock the keeper can mint. On Sepolia and mainnet it is
   * STRK, so the keeper must already hold it — and says so rather than silently running a
   * lobby it cannot fund.
   */
  private async ensureTreasury(amount: bigint): Promise<void> {
    const held = await this.deps.game.treasury();
    if (held >= amount) return;
    const needed = amount - held;

    const { contractAt, settle } = await import("../chain/client.js");
    const token = contractAt(
      this.deps.config.network.realPool ? "BallotToken" : "MockERC20",
      this.deps.deployment.stakeToken,
      this.deps.provider,
      this.deps.keeperAccount,
    );
    if (!this.deps.config.network.realPool) {
      await settle(
        this.deps.provider,
        await token.invoke("mint", [this.deps.keeperAccount.address, needed]),
      );
    }
    await settle(
      this.deps.provider,
      await token.invoke("approve", [this.deps.deployment.game, needed]),
    );
    await this.deps.game.fundTreasury(needed);
  }

  private async deploymentRow() {
    // Keyed on the addresses as well as the network, so redeploying starts a fresh history
    // rather than adopting the previous deployment's matches.
    return prisma.deployment.upsert({
      where: {
        network_gameAddress: {
          network: this.deps.deployment.network,
          gameAddress: this.deps.deployment.game,
        },
      },
      create: {
        network: this.deps.deployment.network,
        gameAddress: this.deps.deployment.game,
        ballotAddress: this.deps.deployment.ballot,
        poolAddress: this.deps.deployment.pool,
        stakeToken: this.deps.deployment.stakeToken,
        chainId: this.deps.deployment.chainId,
      },
      update: {
        gameAddress: this.deps.deployment.game,
        ballotAddress: this.deps.deployment.ballot,
        poolAddress: this.deps.deployment.pool,
        stakeToken: this.deps.deployment.stakeToken,
      },
    });
  }

  private async recordTx(matchId: number, kind: string, hash: string): Promise<void> {
    const deployment = await this.deploymentRow();
    await prisma.chainTx.upsert({
      where: { deploymentId_hash: { deploymentId: deployment.id, hash } },
      create: {
        matchId,
        deploymentId: deployment.id,
        network: this.deps.deployment.network,
        kind,
        hash,
        status: "accepted",
      },
      update: { status: "accepted" },
    });
  }

  private async event(
    matchId: number,
    round: number,
    kind: string,
    text: string,
    seat?: number,
    target?: number,
  ): Promise<void> {
    await prisma.matchEvent.create({
      data: { matchId, round, kind, text, seat: seat ?? null, target: target ?? null },
    });
  }
}

/** Devnet uses a mock token with no decimals worth respecting; STRK has 18. */
function defaultStake(config: KeeperConfig): bigint {
  if (config.network.name === "devnet") return 1_000_000n;
  return 1_000_000_000_000_000_00n; // 0.1 STRK
}
