/**
 * Read models for the client.
 *
 * These are assembled from the mirror in Postgres, but every field that decides money
 * (`payout`, `claimed`, `isImpostor`, `crewWon`) is written there only after being read back
 * off the contract. Nothing in this file computes an outcome.
 */

import {
  MatchPhase,
  NO_TARGET,
  shipMapById,
  shipMapForSeed,
  type MatchView,
  type SeatView,
} from "@crewkill/protocol";
import { prisma } from "../db.js";
import { activeDeploymentId } from "./scope.js";
import type { CrewKillContract } from "../chain/crewkill.js";
import { SABOTAGE_CONFIG, locationName } from "../game/ship.js";

export async function buildMatchView(
  dbId: number,
  game: CrewKillContract,
): Promise<MatchView | null> {
  const row = await prisma.match.findUnique({
    where: { id: dbId },
    include: {
      seats: { orderBy: { index: "asc" } },
      events: { orderBy: { id: "asc" }, take: 400 },
      txs: { orderBy: { id: "desc" }, take: 60 },
    },
  });
  if (!row) return null;

  // Which ship this match is on falls out of `final_seed`, exactly like roles and personas —
  // so the map is not the operator's choice either.
  const map = row.finalSeed ? shipMapForSeed(BigInt(row.finalSeed)) : shipMapById("obsidian");

  const seats: SeatView[] = row.seats.map((seat) => ({
    index: seat.index,
    location: seat.location,
    locationName: locationName(map, seat.location),
    tasksCompleted: seat.tasksCompleted,
    totalTasks: seat.totalTasks,
    onCameras: seat.onCameras,
    persona: seat.persona,
    emoji: seat.emoji,
    isAgent: seat.isAgent,
    alive: seat.alive,
    eliminatedRound: seat.eliminatedRound,
    eliminatedBy: (seat.eliminatedBy as "vote" | "kill" | null) ?? null,
    revealedRole: seat.revealed ? (seat.isImpostor ? "impostor" : "crew") : null,
    roleSecret: seat.revealed ? seat.roleSecret : null,
    claimed: seat.claimed,
    payout: seat.payout,
  }));

  // Tallies come straight off the contract: they are the only vote data that exists, and
  // they are counts, never attributions.
  const tallies: MatchView["tallies"] = [];
  const onchainId = Number(row.onchainId);
  const upTo = row.roundsPlayed > 0 ? row.roundsPlayed : row.round;
  for (let round = 1; round <= upTo; round += 1) {
    const targets: Array<{ seat: number; votes: number }> = [];
    for (const seat of row.seats) {
      const votes = await game.getTally(onchainId, round, seat.index);
      if (votes > 0) targets.push({ seat: seat.index, votes });
    }
    const skips = await game.getTally(onchainId, round, NO_TARGET);
    if (skips > 0) targets.push({ seat: NO_TARGET, votes: skips });
    if (targets.length > 0) tallies.push({ round, targets });
  }

  return {
    matchId: onchainId,
    phase: row.phase,
    roundPhase: (row.roundPhase as MatchView["roundPhase"]) ?? null,
    round: row.round,
    rounds: row.rounds,
    seatCount: row.seatCount,
    seatsFilled: row.seatsFilled,
    stakeAmount: row.stakeAmount,
    potAmount: row.potAmount,
    impostorBps: row.impostorBps,
    detectiveBps: row.detectiveBps,
    protocolBps: row.protocolBps,
    seedCommitment: row.seedCommitment,
    finalSeed: row.finalSeed,
    crewWon: row.crewWon,
    impostorCount: row.impostorCount,
    detectiveWeightTotal: row.detectiveWeightTotal,
    seats,
    tallies,
    events: row.events.map((event) => ({
      id: String(event.id),
      round: event.round,
      at: event.createdAt.toISOString(),
      kind: event.kind as MatchView["events"][number]["kind"],
      text: event.text,
      seat: event.seat ?? undefined,
      target: event.target ?? undefined,
    })),
    mapId: map.id,
    mapName: map.name,
    sabotage: row.sabotage,
    sabotageName: row.sabotage ? (SABOTAGE_CONFIG[row.sabotage]?.name ?? null) : null,
    sabotageEndsAt: row.sabotageEndsAt?.toISOString() ?? null,
    // Bodies are derived from the seats the chain already knows are dead, so the map and
    // the settlement can never disagree about who is lying where.
    //
    // `reported` drives whether the body is still lying on the floor for people to find. A
    // kill from an earlier round has been through a meeting and is accounted for; a kill
    // from the round in progress has not, so it is still out there to be stumbled over.
    bodies: row.seats
      .filter((seat) => !seat.alive && seat.eliminatedBy === "kill")
      .map((seat) => ({
        victim: seat.index,
        location: seat.location,
        round: seat.eliminatedRound ?? 0,
        reported: (seat.eliminatedRound ?? 0) < row.round,
      })),
    taskProgress: taskProgressOf(row.seats),
    phaseEndsAt: row.phaseEndsAt?.toISOString() ?? null,
    txHashes: row.txs.map((tx) => ({
      kind: tx.kind,
      hash: tx.hash,
      at: tx.createdAt.toISOString(),
    })),
  };
}

/** Crew task completion across the roster, 0..1. */
function taskProgressOf(
  seats: Array<{ tasksCompleted: number; totalTasks: number }>,
): number {
  const total = seats.reduce((sum, seat) => sum + seat.totalTasks, 0);
  if (total === 0) return 0;
  const done = seats.reduce((sum, seat) => sum + seat.tasksCompleted, 0);
  return Math.min(1, done / total);
}

export async function listMatches(network: string, gameAddress: string): Promise<
  Array<{
    dbId: number;
    matchId: number;
    phase: number;
    seatsFilled: number;
    seatCount: number;
    stakeAmount: string;
    potAmount: string;
    phaseEndsAt: string | null;
  }>
> {
  const rows = await prisma.match.findMany({
    where: { deploymentId: await activeDeploymentId(network, gameAddress) },
    orderBy: { id: "desc" },
    take: 25,
  });
  return rows.map((row) => ({
    dbId: row.id,
    matchId: Number(row.onchainId),
    phase: row.phase,
    seatsFilled: row.seatsFilled,
    seatCount: row.seatCount,
    stakeAmount: row.stakeAmount,
    potAmount: row.potAmount,
    phaseEndsAt: row.phaseEndsAt?.toISOString() ?? null,
  }));
}

/**
 * Real totals for the whole deployment, not a page of it.
 *
 * `recentMatches` returns the latest 25, which is the right shape for a list and completely
 * the wrong shape for a counter: anything summing that page reports 25 forever, no matter
 * how many matches have actually been played. The hub was doing exactly that and printing it
 * as "matches recorded".
 *
 * These are aggregates computed by the database over every row in the deployment, so the
 * number moves when the truth moves.
 */
export async function deploymentTotals(network: string, gameAddress: string): Promise<{
  matches: number;
  settled: number;
  aborted: number;
  seatsFilled: number;
  potTotal: string;
  transactions: number;
}> {
  const deploymentId = await activeDeploymentId(network, gameAddress);

  const [matches, settled, aborted, seatAgg, potRows, transactions] = await Promise.all([
    prisma.match.count({ where: { deploymentId } }),
    prisma.match.count({ where: { deploymentId, phase: MatchPhase.Settled } }),
    prisma.match.count({ where: { deploymentId, phase: MatchPhase.Aborted } }),
    prisma.match.aggregate({ where: { deploymentId }, _sum: { seatsFilled: true } }),
    prisma.match.findMany({ where: { deploymentId }, select: { potAmount: true } }),
    // Scoped to the deployment, like every other figure here. Counting by network would
    // fold a retired deployment's transactions into the live one's totals.
    prisma.chainTx.count({ where: { deploymentId } }),
  ]);

  // Pots are decimal strings wider than a JS number stays exact at, so they are summed as
  // bigint rather than by the database's numeric aggregate.
  let pot = 0n;
  for (const row of potRows) {
    try {
      pot += BigInt(row.potAmount);
    } catch {
      // A row whose pot will not parse is skipped rather than allowed to poison the sum.
    }
  }

  return {
    matches,
    settled,
    aborted,
    seatsFilled: seatAgg._sum.seatsFilled ?? 0,
    potTotal: pot.toString(),
    transactions,
  };
}

/**
 * Every deployment this keeper has ever recorded, live and retired.
 *
 * A deployment is a set of addresses on a chain. When a devnet restarts and the contracts go
 * up again, the old ones do not stop having existed - the matches settled against them are
 * still real, they are just no longer checkable, because the code they were checked by is
 * gone. Showing them as retired rather than deleting them is the honest way to hold that.
 */
export async function deploymentHistory(activeGameAddress: string): Promise<
  Array<{
    id: number;
    network: string;
    gameAddress: string;
    ballotAddress: string;
    live: boolean;
    matches: number;
    settled: number;
    transactions: number;
    firstSeen: string;
  }>
> {
  const rows = await prisma.deployment.findMany({ orderBy: { id: "asc" } });
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      network: row.network,
      gameAddress: row.gameAddress,
      ballotAddress: row.ballotAddress,
      live: row.gameAddress === activeGameAddress,
      matches: await prisma.match.count({ where: { deploymentId: row.id } }),
      settled: await prisma.match.count({
        where: { deploymentId: row.id, phase: MatchPhase.Settled },
      }),
      transactions: await prisma.chainTx.count({ where: { deploymentId: row.id } }),
      firstSeen: row.createdAt.toISOString(),
    })),
  );
}

/**
 * The most recent things that actually happened, across the deployment.
 *
 * The hub can say six contracts are live and 21,000 transactions were signed, and both are
 * true and neither is a heartbeat. A row that says a match settled forty seconds ago is the
 * difference between a site describing a system and a site attached to one.
 *
 * Drawn from the keeper's own event log, which is written as matches run, so nothing here is
 * generated for display.
 */
export async function recentActivity(
  network: string,
  gameAddress: string,
  limit = 12,
): Promise<Array<{ id: string; matchId: number; kind: string; text: string; at: string }>> {
  const deploymentId = await activeDeploymentId(network, gameAddress);
  const rows = await prisma.matchEvent.findMany({
    where: { match: { deploymentId } },
    orderBy: { id: "desc" },
    take: Math.min(limit, 50),
    include: { match: { select: { onchainId: true } } },
  });

  return rows.map((row) => ({
    id: String(row.id),
    matchId: Number(row.match.onchainId),
    kind: row.kind,
    text: row.text,
    at: row.createdAt.toISOString(),
  }));
}

/**
 * Aggregates worth arguing about.
 *
 * A settled match is evidence the system works. Six hundred of them are evidence of
 * something else: whether the game is balanced. Per-ship crew win rates say whether one map
 * is easier than another, and per-persona rates say whether the agent strategies differ in
 * strength - both being questions a designer would ask and neither answerable from a match
 * list.
 *
 * Counted across every settled match on the deployment, so a rate is over the whole history
 * rather than the page the archive shows.
 */
export async function balanceStats(
  network: string,
  gameAddress: string,
): Promise<{
  totalSettled: number;
  crewWins: number;
  byShip: Array<{ mapId: string; settled: number; crewWins: number }>;
  byPersona: Array<{ persona: string; played: number; survived: number; impostorRuns: number }>;
}> {
  const deploymentId = await activeDeploymentId(network, gameAddress);

  const settled = await prisma.match.findMany({
    where: { deploymentId, phase: MatchPhase.Settled },
    select: { finalSeed: true, crewWon: true },
  });

  const ships = new Map<string, { settled: number; crewWins: number }>();
  for (const row of settled) {
    // Which ship a match ran on is not stored - it falls out of the final seed, the same way
    // the client derives it. Deriving it here keeps one source of truth for that mapping.
    let key = "unknown";
    if (row.finalSeed) {
      try {
        key = shipMapForSeed(BigInt(row.finalSeed)).name;
      } catch {
        // A seed that will not parse is counted as unknown rather than dropped, so the ship
        // totals still add up to the settled total.
      }
    }
    const entry = ships.get(key) ?? { settled: 0, crewWins: 0 };
    entry.settled += 1;
    if (row.crewWon) entry.crewWins += 1;
    ships.set(key, entry);
  }

  const seats = await prisma.seat.findMany({
    where: { match: { deploymentId, phase: MatchPhase.Settled } },
    select: { persona: true, alive: true, isImpostor: true },
  });

  const personas = new Map<string, { played: number; survived: number; impostorRuns: number }>();
  for (const seat of seats) {
    const key = seat.persona ?? "unknown";
    const entry = personas.get(key) ?? { played: 0, survived: 0, impostorRuns: 0 };
    entry.played += 1;
    if (seat.alive) entry.survived += 1;
    if (seat.isImpostor) entry.impostorRuns += 1;
    personas.set(key, entry);
  }

  return {
    totalSettled: settled.length,
    crewWins: settled.filter((m) => m.crewWon).length,
    byShip: [...ships.entries()]
      .map(([mapId, v]) => ({ mapId, ...v }))
      .sort((a, b) => b.settled - a.settled),
    byPersona: [...personas.entries()]
      .map(([persona, v]) => ({ persona, ...v }))
      .sort((a, b) => b.played - a.played),
  };
}
