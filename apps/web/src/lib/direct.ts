"use client";

import { CallData, type Call } from "starknet";
import { commitmentOf, offsetsOf, u256Parts, type PositionSecret } from "@molfi/sdk";
import { errorText } from "./pool";
import type { PoolAddresses } from "./pool";
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
 * So this route exists, and the interesting part is that it still hides the band.
 *
 * The price of a position depends only on how far its band reaches from its own midpoint —
 * a pair of ratios, with the absolute price cancelling out — so the chain can charge for a
 * position correctly while being told nothing about what it predicts. What lands in a public
 * block is a commitment, two widths and a stake. The band is revealed to `claim_position`
 * after the market has settled, against the commitment that has bound it since the open.
 *
 * "Your position stays sealed until settlement" is therefore true on this route too. What it
 * does not hide, and the UI says so plainly, is that *you* opened *a* position for *this
 * much*. That is the part the pool is for.
 */

/** The band's reach, exactly as `open_position` will recompute it at claim time. */
export function reachOf(s: PositionSecret): [bigint, bigint] {
  return offsetsOf((s.bandLow + s.bandHigh) / 2n, s.bandLow, s.bandHigh);
}

/**
 * Approve, then open. Two calls, one transaction.
 *
 * The approve is exact rather than unlimited. An unlimited allowance to a market contract is
 * a standing invitation, and there is no reason to leave one behind for a position that is
 * opened once.
 */
export function openCalls(a: PoolAddresses, s: PositionSecret, stake: bigint): Call[] {
  const [lowOff, highOff] = reachOf(s);
  return [
    {
      contractAddress: a.token,
      entrypoint: "approve",
      calldata: CallData.compile([a.market, ...u256Parts(stake)]),
    },
    {
      contractAddress: a.market,
      entrypoint: "open_position",
      calldata: CallData.compile([
        s.marketId,
        commitmentOf(s),
        ...u256Parts(lowOff),
        ...u256Parts(highOff),
        ...u256Parts(stake),
      ]),
    },
  ];
}

/**
 * Claim a settled winning position back to the address that opened it.
 *
 * This is the transaction where the band becomes public, and it is the only one. The
 * contract recomputes the commitment from the preimage, recomputes the reach from the band,
 * and checks both — so a trader can neither claim a band they did not buy nor a width they
 * did not pay for.
 */
export function claimCalls(a: PoolAddresses, s: PositionSecret): Call[] {
  return [
    {
      contractAddress: a.market,
      entrypoint: "claim_position",
      calldata: CallData.compile([
        s.marketId,
        s.secret,
        ...u256Parts(s.bandLow),
        ...u256Parts(s.bandHigh),
      ]),
    },
  ];
}

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
