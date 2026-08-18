/**
 * Keeper entry point: HTTP + WebSocket API, the phase clock, and the house agents.
 */

import { activeDeploymentId } from "./api/scope.js";
import { discloseMatch } from "./api/disclosure.js";
import { createServer } from "node:http";
import { DEFAULT_MATCH } from "@crewkill/protocol";
import cors from "cors";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import { registerActionRoutes } from "./api/actions.js";
import { buildMatchView, listMatches, deploymentTotals, deploymentHistory, recentActivity, balanceStats} from "./api/views.js";
import { makeAccount, makeProvider } from "./chain/client.js";
import { CrewKillContract, loadDeployment } from "./chain/crewkill.js";
import { canDrivePrivatePool, loadConfig } from "./config.js";
import { prisma } from "./db.js";
import { Engine } from "./game/engine.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "keeper" });

async function devnetAccounts(rpcUrl: string): Promise<Array<{ address: string; private_key: string }>> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "devnet_getPredeployedAccounts",
      params: {},
    }),
  });
  const body = (await response.json()) as {
    result?: Array<{ address: string; private_key: string }>;
  };
  return body.result ?? [];
}

async function main(): Promise<void> {
  const config = loadConfig();
  const deployment = loadDeployment(config.network.name);
  const provider = makeProvider(deployment.rpcUrl);
  const chainId = await provider.getChainId();
  if (chainId !== deployment.chainId) {
    throw new Error(
      `Deployment was made against chain ${deployment.chainId} but the RPC reports ${chainId}.`,
    );
  }
  // A deployment file is a claim; this is the check.
  await provider.getClassHashAt(deployment.game);
  await provider.getClassHashAt(deployment.pool);

  const keeperAccount = makeAccount(provider, config.keeperAddress, config.keeperPrivateKey);
  const game = new CrewKillContract(deployment.game, provider, keeperAccount);

  // House agents need somewhere to act from. On devnet that is the predeployed accounts;
  // against a real pool it needs the Privacy SDK, which needs operator credentials.
  let agentAccounts: Array<{ address: string; private_key: string }> = [];
  if (!config.network.realPool) {
    agentAccounts = (await devnetAccounts(deployment.rpcUrl)).slice(1);
  } else if (!canDrivePrivatePool(config)) {
    log.warn(
      "Real STRK20 pool selected but PROVING_SERVICE_URL / INDEXER_URL / AGENT_VIEWING_KEY are unset - " +
        "house agents are disabled. Human seats still work end to end through their own privacy wallet.",
    );
  }

  const sockets = new Set<WebSocket>();
  const engine = new Engine({
    config,
    deployment,
    provider,
    keeperAccount,
    game,
    agentAccounts,
    broadcast: (dbId) => {
      void broadcastMatch(dbId);
    },
  });

  async function broadcastMatch(dbId: number): Promise<void> {
    if (sockets.size === 0) return;
    const view = await buildMatchView(dbId, game);
    if (!view) return;
    const payload = JSON.stringify({ type: "match", data: view }, bigintReplacer);
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", async (_req, res) => {
    const block = await provider.getBlockLatestAccepted();
    res.json({ ok: true, network: config.network.name, block: block.block_number });
  });

  /** Everything the browser needs to talk to the chain itself. */
  app.get("/api/config", async (_req, res) => {
    res.json({
      network: config.network.name,
      chainId: deployment.chainId,
      rpcUrl: deployment.rpcUrl,
      explorer: config.network.explorer,
      realPool: config.network.realPool,
      contracts: {
        game: deployment.game,
        ballot: deployment.ballot,
        pool: deployment.pool,
        stakeToken: deployment.stakeToken,
      },
      defaults: DEFAULT_MATCH,
    });
  });

  app.get("/api/matches", async (_req, res) => {
    res.json(await listMatches(config.network.name, deployment.game));
  });

  /**
   * Totals for the whole deployment.
   *
   * Separate from /api/matches on purpose. That endpoint pages, and anything counting its
   * response reports the page size rather than the truth.
   */
  app.get("/api/stats", async (_req, res) => {
    try {
      res.json(await deploymentTotals(config.network.name, deployment.game));
    } catch (error) {
      log.error({ err: error }, "stats failed");
      res.status(503).json({ error: "stats unavailable" });
    }
  });

  /** Every deployment this keeper has recorded, so a retired one is visible rather than gone. */
  app.get("/api/deployments", async (_req, res) => {
    try {
      res.json(await deploymentHistory(deployment.game));
    } catch (error) {
      log.error({ err: error }, "deployments failed");
      res.status(503).json({ error: "deployments unavailable" });
    }
  });

  /** The latest real events, for anything that wants to show a heartbeat. */
  app.get("/api/activity", async (_req, res) => {
    try {
      res.json(await recentActivity(config.network.name, deployment.game));
    } catch (error) {
      log.error({ err: error }, "activity failed");
      res.status(503).json({ error: "activity unavailable" });
    }
  });

  /** Win rates by ship and by persona, across every settled match on this deployment. */
  app.get("/api/balance", async (_req, res) => {
    try {
      res.json(await balanceStats(config.network.name, deployment.game));
    } catch (error) {
      log.error({ err: error }, "balance failed");
      res.status(503).json({ error: "balance unavailable" });
    }
  });

  app.get("/api/matches/:id", async (req, res) => {
    const onchainId = parseMatchId(req.params.id);
    if (onchainId === null) {
      res.status(400).json({ error: "match id must be a positive integer" });
      return;
    }
    const row = await prisma.match.findFirst({
      // Scoped to the chain this keeper is actually talking to, so a stale run against another
      // network can never be served as if it were this one.
      where: { onchainId, deploymentId: await activeDeploymentId(config.network.name, deployment.game) },
      orderBy: { id: "desc" },
    });
    if (!row) {
      res.status(404).json({ error: "no such match" });
      return;
    }
    const view = await buildMatchView(row.id, game);
    res.json(JSON.parse(JSON.stringify(view, bigintReplacer)));
  });

  /**
   * The lobby a player can join right now, or `null`.
   *
   * There is routinely no open lobby — the moment one match starts playing, the next has not
   * been created yet. That is an ordinary state, so it answers 200 with a null body rather
   * than a 404: a client polling this every few seconds should not be painting its console
   * red for a situation the product considers normal.
   */
  /**
   * Opens a finished match: who voted for whom, recovered from published role secrets by
   * checking candidate receipts against the deployed contract.
   *
   * Deliberately a separate route rather than part of the match view — it costs a few hundred
   * on-chain reads, and it is a thing a viewer chooses to do, not something that should happen
   * on every poll.
   */
  app.get("/api/matches/:id/disclosure", async (req, res) => {
    const onchainId = parseMatchId(req.params.id);
    if (onchainId === null) {
      res.status(400).json({ error: "match id must be a positive integer" });
      return;
    }
    const row = await prisma.match.findFirst({
      where: { onchainId, deploymentId: await activeDeploymentId(config.network.name, deployment.game) },
      orderBy: { id: "desc" },
    });
    if (!row) {
      res.status(404).json({ error: "no such match" });
      return;
    }
    const disclosure = await discloseMatch(row.id, game);
    res.json(JSON.parse(JSON.stringify(disclosure, bigintReplacer)));
  });

  app.get("/api/lobby", async (_req, res) => {
    const row = await prisma.match.findFirst({
      where: { phase: 0, deploymentId: await activeDeploymentId(config.network.name, deployment.game) },
      orderBy: { id: "desc" },
    });
    if (!row) {
      res.json({ lobby: null });
      return;
    }
    const view = await buildMatchView(row.id, game);
    res.json(JSON.parse(JSON.stringify({ lobby: view }, bigintReplacer)));
  });

  /**
   * Relays a seat reveal.
   *
   * `reveal_seat` is permissionless — the secret is the authorisation — so this endpoint
   * grants no power the caller did not already have. It exists so a player does not have to
   * stamp their own wallet address next to their seat on-chain just to publish a secret that
   * is about to be public. Nothing about the requester is logged or stored.
   */
  const revealSchema = z.object({
    matchId: z.number().int().positive(),
    roleSecret: z.string(),
    claimCommitment: z.string(),
  });

  app.post("/api/reveal", async (req, res) => {
    const parsed = revealSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const txHash = await game.revealSeat(
        parsed.data.matchId,
        BigInt(parsed.data.roleSecret),
        BigInt(parsed.data.claimCommitment),
      );
      res.json({ txHash });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  const createSchema = z.object({
    seatCount: z.number().int().min(4).max(12).optional(),
    rounds: z.number().int().min(1).max(8).optional(),
    stakeAmount: z.string().optional(),
  });

  app.post("/api/matches", async (req, res) => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const row = await engine.openMatch({
      ...parsed.data,
      stakeAmount: parsed.data.stakeAmount ? BigInt(parsed.data.stakeAmount) : undefined,
    });
    res.json({ dbId: row.id, matchId: Number(row.onchainId) });
  });

  registerActionRoutes(app, engine, config.network.name, deployment.game);

  // Nothing may leave this server as HTML. A client that parses every response as JSON is
  // entitled to get JSON even when something upstream threw.
  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      log.error({ err: error }, "unhandled request error");
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : "internal error" });
    },
  );

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    void (async () => {
      // A new socket gets the current match immediately, scoped to this chain.
      const row = await prisma.match.findFirst({
        where: { deploymentId: await activeDeploymentId(config.network.name, deployment.game) },
        orderBy: { id: "desc" },
      });
      if (row) {
        const view = await buildMatchView(row.id, game);
        if (view) socket.send(JSON.stringify({ type: "match", data: view }, bigintReplacer));
      }
    })();
  });

  server.listen(config.port, () => {
    log.info(
      { port: config.port, network: config.network.name, game: deployment.game },
      "keeper listening",
    );
  });

  // The clock. Everything time-based in CrewKill happens because of this loop.
  const tick = async (): Promise<void> => {
    try {
      await engine.tick();
    } catch (error) {
      log.error({ err: error }, "engine tick failed");
    }
  };
  setInterval(() => void tick(), config.pollIntervalMs);
  void tick();
}

/**
 * Match ids arrive as path segments, so they are attacker-controlled strings. `BigInt("x")`
 * throws a `SyntaxError`, which Express turns into an HTML 500 — an API should answer a bad
 * id with a 400 and JSON, not a stack trace in a content type the caller cannot parse.
 */
function parseMatchId(raw: string): bigint | null {
  if (!/^[0-9]+$/.test(raw)) return null;
  const value = BigInt(raw);
  return value > 0n ? value : null;
}

/** JSON has no bigint; amounts are strings everywhere on the wire. */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

main().catch((error) => {
  logger.error({ err: error }, "keeper failed to start");
  process.exit(1);
});
