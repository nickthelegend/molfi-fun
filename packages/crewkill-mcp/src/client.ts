/**
 * The seat an agent actually holds.
 *
 * Everything here is real: a seat is bought with a signed transaction through the pool
 * contract, the role is computed locally from a secret the keeper never sees, and every
 * action is authorised with a token only the seat holder can compute. An agent playing
 * through this is a player, not a scripted opponent the server moves on its behalf.
 */

import { Account, RpcProvider } from "starknet";
import {
  MatchPhase,
  NO_TARGET,
  actionToken,
  claimCommitment,
  isImpostor,
  seatCommitment,
  type MatchView,
} from "@crewkill/protocol";

/** Mirrors the keeper's ActionType. Kept here so the agent can name what it is doing. */
export const Action = {
  None: 0,
  Move: 1,
  DoTask: 2,
  FakeTask: 3,
  Kill: 4,
  Report: 5,
  CallMeeting: 6,
  Vent: 7,
  Sabotage: 8,
  UseCams: 9,
  Skip: 10,
  FixSabotage: 11,
} as const;

export interface Seat {
  matchId: number;
  seatIndex: number;
  roleSecret: bigint;
  claimSecret: bigint;
}

function randomFelt(): bigint {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  return BigInt("0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
}

export class KeeperClient {
  constructor(private readonly base: string) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}${path}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    return (await res.json()) as T;
  }

  config = () => this.get<ChainConfig>("/api/config");
  lobby = () => this.get<{ lobby: MatchView | null }>("/api/lobby").then((r) => r.lobby);
  match = (id: number) => this.get<MatchView>(`/api/matches/${id}`);
  matches = () => this.get<Array<{ matchId: number; phase: number; seatsFilled: number; seatCount: number }>>("/api/matches");

  /** Queues an action for a seat. The token proves the caller holds it. */
  async act(matchId: number, seat: Seat, type: number, extra: Record<string, number> = {}) {
    const res = await fetch(`${this.base}/api/matches/${matchId}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        seatIndex: seat.seatIndex,
        token: actionToken(seat.roleSecret, seat.claimSecret).toString(),
        type,
        ...extra,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(body.error ?? `action returned ${res.status}`);
    return body;
  }
}

export interface ChainConfig {
  network: string;
  rpcUrl: string;
  realPool: boolean;
  contracts: { game: string; ballot: string; pool: string; stakeToken: string };
}

/**
 * Buys a seat on devnet with a borrowed prefunded key.
 *
 * Devnet only, and deliberately so. On a real pool a seat is bought through the player's own
 * privacy wallet, and an agent that wanted to play there would need its own funded wallet and
 * viewing key rather than borrowing one — which is a credential decision for whoever runs it,
 * not something this server should paper over.
 */
export async function buySeatOnDevnet(
  config: ChainConfig,
  match: MatchView,
): Promise<{ seat: Seat; shieldTx: string; joinTx: string; address: string }> {
  if (config.realPool) {
    throw new Error(
      "This server buys seats only on devnet. On a real pool an agent needs its own funded " +
        "privacy wallet, which is a credential decision for the operator.",
    );
  }

  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });

  // Borrow a predeployed devnet account. These are the ones devnet funds at genesis.
  const res = await fetch(config.rpcUrl.replace(/\/rpc$/, ""), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "devnet_getPredeployedAccounts", params: [] }),
  });
  const body = (await res.json()) as { result?: Array<{ address: string; private_key: string }> };
  const accounts = body.result;
  if (!accounts?.length) throw new Error("devnet returned no predeployed accounts");

  // Later accounts, so an agent does not collide with the keeper's own house agents.
  const picked = accounts[accounts.length - 1 - Math.floor(Math.random() * 4)];
  const account = new Account({
    provider,
    address: picked.address,
    signer: picked.private_key,
    cairoVersion: "1",
  });

  const roleSecret = randomFelt();
  const claimSecret = randomFelt();
  const commitment = seatCommitment(roleSecret, claimCommitment(claimSecret));
  const stake = BigInt(match.stakeAmount);

  const send = async (calls: Array<{ contractAddress: string; entrypoint: string; calldata: string[] }>) => {
    const tx = await account.execute(calls, { tip: 0n });
    await provider.waitForTransaction(tx.transaction_hash, { retryInterval: 400 });
    return tx.transaction_hash;
  };

  // Shield: mint the devnet stake token, approve the pool, deposit. `deposit` takes a u128,
  // so the amount is one felt, not a u256 pair.
  const shieldTx = await send([
    { contractAddress: config.contracts.stakeToken, entrypoint: "mint", calldata: [picked.address, stake.toString(), "0"] },
    { contractAddress: config.contracts.stakeToken, entrypoint: "approve", calldata: [config.contracts.pool, stake.toString(), "0"] },
    { contractAddress: config.contracts.pool, entrypoint: "deposit", calldata: [config.contracts.stakeToken, stake.toString()] },
  ]);

  // Take the seat through the pool's sandwich, so the game records the commitment and never
  // this address. The payload is privacy_invoke's eight arguments in declaration order.
  const noteId = commitment % 2n ** 200n || 1n;
  const joinTx = await send([
    {
      contractAddress: config.contracts.pool,
      entrypoint: "invoke",
      calldata: [
        config.contracts.game,
        config.contracts.stakeToken,
        stake.toString(),
        picked.address,
        "0", // CrewKillOperation.JoinSeat
        match.matchId.toString(),
        commitment.toString(),
        "0", // BallotKind.Vote
        "0", // round
        "0", // target seat
        "0", // secret
        noteId.toString(),
      ],
    },
  ]);

  // Which slot the seat landed in, read from the contract rather than inferred. The keeper's
  // view does not publish commitments - deliberately, since that is the link the game exists
  // to break - so the only place this answer exists is the chain.
  const seatIndex = await lookupSeatIndex(provider, config.contracts.game, match.matchId, commitment);
  if (seatIndex === null) {
    throw new Error("seat bought but the contract does not report an index yet; retry in a moment");
  }

  return {
    seat: { matchId: match.matchId, seatIndex, roleSecret, claimSecret },
    shieldTx,
    joinTx,
    address: picked.address,
  };
}

/** Asks the game contract which slot a commitment occupies. */
async function lookupSeatIndex(
  provider: RpcProvider,
  game: string,
  matchId: number,
  commitment: bigint,
): Promise<number | null> {
  try {
    const result = await provider.callContract({
      contractAddress: game,
      entrypoint: "get_seat_index",
      calldata: [matchId.toString(), commitment.toString()],
    });
    return Number(BigInt(result[0]));
  } catch {
    return null;
  }
}

/** Your role, computed here from your own secret. Nobody else can do this for you. */
export function roleOf(match: MatchView, seat: Seat): "impostor" | "crew" | "sealed" {
  if (!match.finalSeed) return "sealed";
  return isImpostor(BigInt(match.finalSeed), seat.roleSecret, match.impostorBps) ? "impostor" : "crew";
}

export { MatchPhase, NO_TARGET };


