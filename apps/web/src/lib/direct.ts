"use client";

import type { Call } from "starknet";
import { errorText } from "./pool";
import type { Connection } from "./wallet";

/**
 * Trading from an ordinary Starknet account.
 *
 * The other route into molfi is the STRK20 pool, and it is the better one: it hides the
 * trader, the size and the band all at once. But it needs a wallet that speaks STRK20, and
 * for most of a year most wallets have not. A market that only one kind of wallet can reach
 * is a market nobody trades, and molfi spent seventeen settled rounds proving exactly that —
 * every one of them with a stake of zero.
 *
 * So this route exists, and the interesting part is that it still hides the band. The price
 * of a position depends only on how far its band reaches from its own midpoint — a pair of
 * ratios, with the absolute price cancelling out — so the chain can charge for a position
 * correctly while being told nothing about what it predicts. What lands in a public block is
 * a commitment, two widths and a stake.
 *
 * "Your position stays sealed until settlement" is therefore true on this route too. What it
 * does not hide, and the UI says so plainly, is that *you* opened *a* position for *this
 * much*. That is the part the pool is for.
 */

/**
 * The calls themselves live in the SDK.
 *
 * Re-exported here so the console's imports read the way they always have, but defined
 * beside `commitmentOf` — the other place the browser and the chain must agree byte for
 * byte. `scripts/integration.mjs` imports the same functions and runs them against a real
 * chain, so what that test proves is that *these* calls are accepted, not that a
 * reimplementation of them is.
 */
export { claimCalls, openCalls, reachOf } from "@molfi/sdk";
export type { TradeAddresses } from "@molfi/sdk";

export interface SubmitResult {
  ok: boolean;
  txHash?: string;
  error?: string;
}

/**
 * Send a plain multicall through the connected account.
 *
 * Simulated first, for the same reason the pool route dry-runs: a calldata mistake found
 * before the signature costs nothing, and one found after costs the user a fee for a
 * transaction that could never have worked. A wallet that will not simulate is not a reason
 * to refuse — the simulation is a courtesy, not the check.
 */
export async function submitDirect(
  connection: Connection,
  calls: Call[],
): Promise<SubmitResult> {
  try {
    await connection.account.simulateTransaction([{ type: "INVOKE", payload: calls }], {
      skipValidate: true,
    });
  } catch (err) {
    const text = errorText(err);
    // Only refuse on a revert the node is sure about. Simulation fails for plenty of reasons
    // that say nothing about the call — an estimate the node will not do, a rate limit, a
    // wallet that does not implement it — and refusing on those would block a good trade.
    if (/execution|revert|entry ?point|argent|failed to deserialize/i.test(text)) {
      return { ok: false, error: `This would fail on chain: ${text}` };
    }
  }

  try {
    const { transaction_hash } = await connection.account.execute(calls);
    return { ok: true, txHash: transaction_hash };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}
