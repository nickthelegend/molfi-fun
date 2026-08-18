/**
 * Human gameplay actions.
 *
 * Movement, tasks, reports and the emergency button are *gameplay* — they generate the
 * evidence a meeting argues about. They are routed through the keeper because they are free
 * and need to happen several times a round; putting them on-chain would cost a pool fee per
 * step and make the game unplayable.
 *
 * Nothing here can touch money. Votes, night actions, roles and payouts go straight to the
 * contract from the player's own wallet.
 */

import { z } from "zod";
import type { Express } from "express";
import { ActionType, type AgentAction } from "../game/strategies.js";
import type { Engine } from "../game/engine.js";
import { prisma } from "../db.js";
import { activeDeploymentId } from "./scope.js";

const actionSchema = z.object({
  seatIndex: z.number().int().min(0).max(11),
  /** `actionToken(roleSecret, claimSecret)` — computable only by the seat holder. */
  token: z.string(),
  type: z.nativeEnum(ActionType),
  destination: z.number().int().min(0).max(13).optional(),
  target: z.number().int().min(0).max(11).optional(),
  sabotage: z.number().int().min(1).max(4).optional(),
});

/** Trust-on-first-use bindings from seat to capability token, per match. */
const seatTokens = new Map<string, string>();

export function registerActionRoutes(
  app: Express,
  engine: Engine,
  network: string,
  gameAddress: string,
): void {
  app.post("/api/matches/:id/action", async (req, res) => {
    const parsed = actionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { seatIndex, token, type, destination, target, sabotage } = parsed.data;

    if (!/^[0-9]+$/.test(req.params.id)) {
      res.status(400).json({ error: "match id must be a positive integer" });
      return;
    }
    const row = await prisma.match.findFirst({
      // An action must address a match on the chain we are signing against — otherwise a
      // stale id from another network would be accepted and then fail at the contract.
      where: {
        onchainId: BigInt(req.params.id),
        deploymentId: await activeDeploymentId(network, gameAddress),
      },
      orderBy: { id: "desc" },
    });
    if (!row) {
      res.status(404).json({ error: "no such match" });
      return;
    }

    const key = `${row.id}:${seatIndex}`;
    const bound = seatTokens.get(key);
    if (bound === undefined) {
      seatTokens.set(key, token);
    } else if (bound !== token) {
      res.status(403).json({ error: "this seat is being driven by another client" });
      return;
    }

    const action: AgentAction = { type, destination, target, sabotage };
    const queued = engine.queueAction(row.id, seatIndex, action);
    if (!queued) {
      res.status(409).json({ error: "seat is not alive, or the match is not in play" });
      return;
    }
    res.json({ ok: true });
  });
}
