#!/usr/bin/env -S npx tsx
/**
 * CrewKill, as tools an agent can hold.
 *
 * The game already had everything an outside player needs: a read API for what your seat can
 * see, and an action endpoint authorised by a token only the seat holder can compute. What it
 * did not have was a way for anything other than a browser to sit down. This is that.
 *
 * An agent connected here is a player in the full sense. It buys its own seat with a signed
 * transaction, computes its own role from a secret this process generates and the keeper never
 * sees, and votes by spending a real ballot. It can be lied to, voted out, and it can win.
 *
 * The deliberate omission is a tool that reveals anything hidden. There is no "who is the
 * impostor" call, because the honest answer is that nobody has it - not the keeper, not this
 * server, not the contract until the reveal. An agent has to deduce it like everyone else.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { adjacencyOf, roomNameOf, shipMapById, MatchPhase, NO_TARGET } from "@crewkill/protocol";
import { Action, KeeperClient, buySeatOnDevnet, roleOf, type Seat } from "./client.ts";

const KEEPER = process.env.KEEPER_URL ?? "http://localhost:8080";
const keeper = new KeeperClient(KEEPER);

/** The seat this agent holds, once it has one. One seat per process, like a person. */
let held: Seat | null = null;

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

const server = new McpServer({ name: "crewkill", version: "1.0.0" });

// ── looking around ───────────────────────────────────────────────────────────────────

server.tool(
  "crewkill_lobby",
  "Find a match to join. Returns the open lobby and how many seats are left in it.",
  {},
  async () => {
    const lobby = await keeper.lobby();
    if (!lobby) return ok("No lobby is open right now. One opens as soon as the current match starts.");
    return ok(
      `Match #${lobby.matchId} is open: ${lobby.seatsFilled}/${lobby.seatCount} seats taken, ` +
        `stake ${Number(lobby.stakeAmount) / 1e6} STRK, ${lobby.rounds} rounds. ` +
        `Call crewkill_join to take a seat.`,
    );
  },
);

server.tool(
  "crewkill_look",
  "What your seat can see right now: the phase, where you are, who is in the room with you, and where you could go next. This is the only view you get — it is what a player sees, not what the server knows.",
  {},
  async () => {
    if (!held) return fail("You have no seat yet. Call crewkill_join first.");
    const match = await keeper.match(held.matchId);
    const me = match.seats[held.seatIndex];
    const map = shipMapById(match.mapId);
    const phase = MatchPhase[match.phase];

    if (!me.alive) {
      return ok(
        `You are out — ${me.eliminatedBy === "vote" ? "voted out" : "killed"} in round ${me.eliminatedRound}. ` +
          `The match is still running; you can watch with crewkill_look but you cannot act.`,
      );
    }

    const here = match.seats.filter((s) => s.alive && s.location === me.location && s.index !== me.index);
    const exits = (adjacencyOf(map)[me.location] ?? []).map((r) => `${r} (${roomNameOf(map, r)})`);
    const alive = match.seats.filter((s) => s.alive).length;

    return ok(
      [
        `Match #${match.matchId}, round ${match.round}/${match.rounds}, phase ${phase}${match.roundPhase ? ` (${match.roundPhase})` : ""}.`,
        `You are seat ${me.index} (${me.persona}), your role is ${roleOf(match, held)}.`,
        `You are in ${me.locationName}. ${here.length ? `With you: ${here.map((s) => `seat ${s.index} ${s.persona}`).join(", ")}.` : "Nobody else is here."}`,
        `Exits: ${exits.join(", ") || "none"}.`,
        `${alive} of ${match.seatCount} still alive. Tasks ${me.tasksCompleted}/${me.totalTasks}.`,
        match.sabotage ? `SABOTAGE ACTIVE (${match.sabotage}). Someone has to fix it.` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  },
);

server.tool(
  "crewkill_transcript",
  "What has been said and done in this match so far, newest last. This is your evidence — deduction has to come from here.",
  { limit: z.number().int().min(1).max(80).default(30) },
  async ({ limit }) => {
    if (!held) return fail("You have no seat yet. Call crewkill_join first.");
    const match = await keeper.match(held.matchId);
    const lines = match.events.slice(-limit).map((e) => `r${e.round} ${e.text}`);
    return ok(lines.join("\n") || "Nothing has happened yet.");
  },
);

// ── sitting down ─────────────────────────────────────────────────────────────────────

server.tool(
  "crewkill_join",
  "Buy a seat in the open lobby. This sends real signed transactions: it shields your stake through the privacy pool and then takes a seat, so the game records a commitment and never an address. Your role secret is generated here and never leaves this process.",
  {},
  async () => {
    if (held) return fail(`You already hold seat ${held.seatIndex} in match #${held.matchId}.`);
    const lobby = await keeper.lobby();
    if (!lobby) return fail("No lobby is open right now.");
    if (lobby.seatsFilled >= lobby.seatCount) return fail("That lobby is full.");

    const config = await keeper.config();
    const bought = await buySeatOnDevnet(config, lobby);
    held = bought.seat;

    return ok(
      [
        `Seated. You are seat ${held.seatIndex} in match #${held.matchId}.`,
        `Shield tx: ${bought.shieldTx}`,
        `Join tx:   ${bought.joinTx}`,
        `Your role is drawn from a seed nobody could steer, and stays sealed until the match ends.`,
        `Call crewkill_look to see where you are.`,
      ].join("\n"),
    );
  },
);

// ── playing ──────────────────────────────────────────────────────────────────────────

server.tool(
  "crewkill_move",
  "Walk to an adjacent room. You can only reach rooms listed as exits by crewkill_look.",
  { room: z.number().int().min(0).max(13).describe("Room id to walk to") },
  async ({ room }) => {
    if (!held) return fail("You have no seat yet.");
    const match = await keeper.match(held.matchId);
    const map = shipMapById(match.mapId);
    const from = match.seats[held.seatIndex].location;
    if (!(adjacencyOf(map)[from] ?? []).includes(room)) {
      return fail(`No corridor from ${roomNameOf(map, from)} to ${roomNameOf(map, room)}.`);
    }
    await keeper.act(held.matchId, held, Action.Move, { destination: room });
    return ok(`Walking to ${roomNameOf(map, room)}.`);
  },
);

server.tool(
  "crewkill_task",
  "Do a task in the room you are standing in. Crew win by finishing tasks. An impostor calling this is faking one, which is exactly what an impostor should do.",
  {},
  async () => {
    if (!held) return fail("You have no seat yet.");
    const match = await keeper.match(held.matchId);
    const impostor = roleOf(match, held) === "impostor";
    await keeper.act(held.matchId, held, impostor ? Action.FakeTask : Action.DoTask);
    return ok(impostor ? "Pretending to work." : "Working on a task.");
  },
);

server.tool(
  "crewkill_kill",
  "Impostors only. Eliminate a seat standing in your room.",
  { seat: z.number().int().min(0).max(11).describe("Seat index to eliminate") },
  async ({ seat }) => {
    if (!held) return fail("You have no seat yet.");
    const match = await keeper.match(held.matchId);
    if (roleOf(match, held) !== "impostor") return fail("You are crew. You cannot kill.");
    const me = match.seats[held.seatIndex];
    const victim = match.seats[seat];
    if (!victim?.alive) return fail("That seat is already out.");
    if (victim.location !== me.location) return fail("They are not in your room.");
    await keeper.act(held.matchId, held, Action.Kill, { target: seat });
    return ok(`Killing seat ${seat} in ${me.locationName}.`);
  },
);

server.tool(
  "crewkill_call_meeting",
  "Call an emergency meeting, which stops play and forces a vote.",
  {},
  async () => {
    if (!held) return fail("You have no seat yet.");
    await keeper.act(held.matchId, held, Action.CallMeeting);
    return ok("Meeting called. Everyone stops and votes.");
  },
);

server.tool(
  "crewkill_vote",
  "Vote a seat out during a meeting, or skip. Your vote is spent as a ballot through the pool, so the tally is public and who cast it is not.",
  {
    seat: z
      .number()
      .int()
      .min(0)
      .max(11)
      .optional()
      .describe("Seat index to eject. Leave empty to skip."),
  },
  async ({ seat }) => {
    if (!held) return fail("You have no seat yet.");
    const match = await keeper.match(held.matchId);
    if (match.roundPhase !== "voting") return fail("It is not a voting phase right now.");
    if (seat !== undefined && !match.seats[seat]?.alive) return fail("That seat is already out.");
    await keeper.act(held.matchId, held, seat === undefined ? Action.Skip : Action.Report, {
      target: seat ?? NO_TARGET,
    });
    return ok(seat === undefined ? "Skipping this vote." : `Voting to eject seat ${seat}.`);
  },
);

server.tool(
  "crewkill_verify",
  "After a match settles, replay it from published data and check the contract's payouts against an independent recomputation. Works for any match, not only yours.",
  { matchId: z.number().int().min(0).describe("Match to check") },
  async ({ matchId }) => {
    const { auditMatch } = await import("@crewkill/protocol");
    const match = await keeper.match(matchId);
    const result = auditMatch(match);
    if (!result.applicable) return ok(`Match #${matchId} has not settled, so there is nothing to check yet.`);
    return ok(
      [
        `Match #${matchId}: ${result.passed}/${result.checks.length} checks agree, ${result.failed} disagree.`,
        ...result.checks.map((c) => `${c.ok ? "OK  " : "FAIL"} ${c.label}: chain=${c.onChain} recomputed=${c.recomputed}`),
      ].join("\n"),
    );
  },
);

await server.connect(new StdioServerTransport());
