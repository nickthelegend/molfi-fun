/**
 * The auditor must agree with the contract on a good match and disagree on a tampered one.
 * A checker that always says "fine" is worse than no checker.
 */

import { describe, expect, it } from "vitest";
import { assessPrivacy, auditMatch, detectiveWeight, recomputeRole, recoverVotes } from "../src/audit.js";
import { NO_TARGET, claimCommitment, finalSeed, seatCommitment, voteReceipt } from "../src/hashing.js";
import { MatchPhase, type MatchView } from "../src/types.js";

function seat(index: number, roleSecret: bigint, role: "crew" | "impostor", alive: boolean, payout: string) {
  return {
    index,
    location: 0,
    locationName: "Cafeteria",
    tasksCompleted: 0,
    totalTasks: 4,
    onCameras: false,
    persona: `S${index}`,
    emoji: "🙂",
    isAgent: true,
    alive,
    eliminatedRound: alive ? null : 1,
    eliminatedBy: alive ? null : ("vote" as const),
    revealedRole: role,
    roleSecret: `0x${roleSecret.toString(16)}`,
    claimed: false,
    payout,
  };
}

function buildMatch(seedValue: bigint, secrets: bigint[], impostorBps: number): MatchView {
  const commitments = secrets.map((s) => seatCommitment(s, claimCommitment(s + 1n)));
  const seed = finalSeed(seedValue, commitments);
  const roles = secrets.map((s) => recomputeRole(seed, s, impostorBps));
  const aliveImpostors = 0;
  return {
    matchId: 1,
    phase: MatchPhase.Settled,
    roundPhase: null,
    round: 1,
    rounds: 2,
    seatCount: secrets.length,
    seatsFilled: secrets.length,
    stakeAmount: "1000",
    potAmount: String(1000 * secrets.length),
    impostorBps,
    detectiveBps: 1200,
    protocolBps: 300,
    seedCommitment: "0x1",
    finalSeed: `0x${seed.toString(16)}`,
    crewWon: aliveImpostors === 0,
    impostorCount: roles.filter((r) => r === "impostor").length,
    detectiveWeightTotal: 0,
    seats: secrets.map((s, i) =>
      // Every impostor is dead, so the crew won — a self-consistent match.
      seat(i, s, roles[i], roles[i] !== "impostor", "100"),
    ),
    tallies: [{ round: 1, targets: [{ seat: 0, votes: 2 }] }],
    events: [],
    sabotage: 0,
    sabotageName: null,
    sabotageEndsAt: null,
    bodies: [],
    taskProgress: 0,
    phaseEndsAt: null,
    txHashes: [],
  };
}

describe("auditMatch", () => {
  const secrets = [11n, 22n, 33n, 44n];

  it("agrees with a self-consistent settled match", () => {
    const match = buildMatch(999n, secrets, 2500);
    const result = auditMatch(match);
    expect(result.applicable).toBe(true);
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(result.checks.length);
  });

  it("catches a role that does not follow from the seed", () => {
    const match = buildMatch(999n, secrets, 2500);
    // Flip one seat's claimed role without changing its secret.
    const target = match.seats[0];
    target.revealedRole = target.revealedRole === "impostor" ? "crew" : "impostor";
    const result = auditMatch(match);
    expect(result.checks.find((c) => c.id === "roles")!.ok).toBe(false);
  });

  it("catches a misreported impostor count", () => {
    const match = buildMatch(999n, secrets, 2500);
    match.impostorCount = (match.impostorCount ?? 0) + 1;
    expect(auditMatch(match).checks.find((c) => c.id === "impostor-count")!.ok).toBe(false);
  });

  it("catches a pot that pays out more than it took in", () => {
    const match = buildMatch(999n, secrets, 2500);
    match.seats.forEach((s) => (s.payout = "999999"));
    expect(auditMatch(match).checks.find((c) => c.id === "conservation")!.ok).toBe(false);
  });

  it("catches a round with more ballots than seats", () => {
    const match = buildMatch(999n, secrets, 2500);
    match.tallies = [{ round: 1, targets: [{ seat: 0, votes: 99 }] }];
    expect(auditMatch(match).checks.find((c) => c.id === "tallies")!.ok).toBe(false);
  });

  it("declines to judge a match that has not settled", () => {
    const match = buildMatch(999n, secrets, 2500);
    match.phase = MatchPhase.Playing;
    expect(auditMatch(match).applicable).toBe(false);
  });
});

describe("recoverVotes", () => {
  it("recovers exactly the ballots a secret cast, and nothing else", () => {
    const secret = 7n;
    const cast = new Set([
      voteReceipt(secret, 1, 2).toString(),
      voteReceipt(secret, 2, NO_TARGET).toString(),
    ]);
    const found = recoverVotes(secret, 2, 4, (r) => cast.has(r.toString()));
    expect(found).toEqual([
      { round: 1, target: 2 },
      { round: 2, target: NO_TARGET },
    ]);
  });

  it("recovers nothing from a secret that did not vote", () => {
    const cast = new Set([voteReceipt(7n, 1, 2).toString()]);
    expect(recoverVotes(8n, 2, 4, (r) => cast.has(r.toString()))).toEqual([]);
  });
});

describe("detectiveWeight", () => {
  it("pays earlier reads more than later ones", () => {
    const early = detectiveWeight([{ round: 1, target: 3 }], [3], 3);
    const late = detectiveWeight([{ round: 3, target: 3 }], [3], 3);
    expect(early).toBe(3);
    expect(late).toBe(1);
    expect(early).toBeGreaterThan(late);
  });

  it("pays nothing for naming a crewmate", () => {
    expect(detectiveWeight([{ round: 1, target: 0 }], [3], 3)).toBe(0);
  });
});

describe("assessPrivacy", () => {
  it("rates a careful player strong", () => {
    const a = assessPrivacy({
      shieldedSeparately: true,
      msBetweenShieldAndStake: 120_000,
      seatsInLobby: 6,
      uniformStake: true,
    });
    expect(a.band).toBe("strong");
    expect(a.factors.every((f) => f.ok)).toBe(true);
  });

  it("rates a same-breath deposit in a thin lobby weak", () => {
    const a = assessPrivacy({
      shieldedSeparately: false,
      msBetweenShieldAndStake: 1_000,
      seatsInLobby: 1,
      uniformStake: true,
    });
    expect(a.band).toBe("weak");
    expect(a.factors.filter((f) => !f.ok).length).toBe(3);
  });
});

/**
 * The weighting the detective-pool explainer prints.
 *
 * That page shows a worked example with specific numbers, and a worked example that has
 * drifted from the rule it claims to illustrate is worse than no example. These pin the
 * figures on the page to the function the contract's payout follows.
 */
describe("detective weighting, as the explainer prints it", () => {
  const ROUNDS = 4;
  const impostors = [2, 5];

  it("pays rounds-remaining-plus-one per correct vote", () => {
    // Seat 0 on the page: correct in rounds 1 and 2, weight 4 + 3 = 7.
    const weight = detectiveWeight(
      [
        { round: 1, target: 2 },
        { round: 2, target: 5 },
      ],
      impostors,
      ROUNDS,
    );
    expect(weight).toBe(7);
  });

  it("pays a final-round read the minimum", () => {
    // Seat 3 on the page: correct once, in round 4, weight 1.
    expect(detectiveWeight([{ round: 4, target: 2 }], impostors, ROUNDS)).toBe(1);
  });

  it("pays an impostor who named their own partner", () => {
    // Seat 5 on the page: weight 3. The pool asks whether you were right, not whose side
    // you were on, and the explainer leans on exactly that.
    expect(detectiveWeight([{ round: 2, target: 2 }], impostors, ROUNDS)).toBe(3);
  });

  it("makes the early read four times the late one", () => {
    const early = detectiveWeight([{ round: 1, target: 2 }], impostors, ROUNDS);
    const late = detectiveWeight([{ round: 4, target: 2 }], impostors, ROUNDS);
    expect(early / late).toBe(4);
  });
});
