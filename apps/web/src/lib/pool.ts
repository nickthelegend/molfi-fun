"use client";

import type { STRK20_ACTION } from "@starknet-io/types-js";
import { num } from "starknet";
import { OP, u256Parts, type PositionSecret } from "@molfi/sdk";
import type { Connection } from "./wallet";

/**
 * The four things a trader does through the pool.
 *
 * Each is a list of actions handed to the wallet, which discovers the notes, builds the
 * proof, and submits. molfi never sees a viewing key and never signs.
 *
 * The sandwich is the interesting one. Opening a position is a single atomic transaction:
 * the pool withdraws the stake to molfi's anonymizer, calls its `privacy_invoke`, and reads
 * back the notes to credit — which for an open is none, because the stake parks in the
 * contract until the market settles. That empty span is what makes molfi a stateful helper
 * rather than a pass-through, and it is the whole reason a position can stay hidden between
 * opening and settling.
 */

export interface PoolAddresses {
  pool: string;
  token: string;
  market: string;
}

/** Position identity lives in the SDK, beside the vector that pins it to the contract. */
export { OP, commitmentOf, newSecret, POSITION_TAG } from "@molfi/sdk";
export type { PositionSecret } from "@molfi/sdk";

const u256 = u256Parts;

/** Move public tokens into the pool. The public leg names you; nothing after it does. */
export function shieldActions(a: PoolAddresses, amount: bigint): STRK20_ACTION[] {
  return [{ type: "deposit", token: a.token as `0x${string}`, amount: num.toHex(amount) }];
}

/** Move a private balance back out to a public address. Public again, and by design. */
export function unshieldActions(
  a: PoolAddresses,
  amount: bigint,
  to: string,
): STRK20_ACTION[] {
  return [
    {
      type: "withdraw",
      token: a.token as `0x${string}`,
      amount: num.toHex(amount),
      recipient: to as `0x${string}`,
    },
  ];
}

/**
 * Open a position: one invoke, atomic.
 *
 * No open note is created. The helper returns an empty span because the stake stays parked
 * in the contract until the market settles, and asking the pool to open a note for a credit
 * that never arrives would leave the transaction's balance invariant unsatisfiable.
 *
 * Calldata order is the contract's `privacy_invoke` signature, in order. The pool
 * deserializes straight into those parameters, so this array *is* the interface — get the
 * order wrong and the failure is a deserialization error with nothing in it to read.
 */
export function openActions(
  a: PoolAddresses,
  s: PositionSecret,
  stake: bigint,
): STRK20_ACTION[] {
  const [lowLo, lowHi] = u256(s.bandLow);
  const [highLo, highHi] = u256(s.bandHigh);
  return [
    {
      type: "invoke",
      contract: a.market as `0x${string}`,
      calldata: [
        num.toHex(OP.open),
        num.toHex(s.marketId),
        lowLo,
        lowHi,
        highLo,
        highHi,
        a.token,
        num.toHex(stake),
        s.secret,
        // note_id is unused on open — nothing is credited back.
        "0x0",
      ],
    },
  ];
}

/**
 * Claim a settled winning position into an open note.
 *
 * Two actions, in the order the pool's phases require: the note is opened first so its id
 * exists for the invoke to reference, and `${openNoteIds[0]}` is the placeholder the wallet
 * substitutes at assembly time. Referencing a note that does not exist yet is exactly what
 * that indirection is for.
 *
 * The contract recomputes the commitment from the preimage, so naming a band without holding
 * its secret finds no position at all.
 */
export function claimActions(
  a: PoolAddresses,
  s: PositionSecret,
  recipient: string,
): STRK20_ACTION[] {
  const [lowLo, lowHi] = u256(s.bandLow);
  const [highLo, highHi] = u256(s.bandHigh);
  return [
    // The note the payout is credited into. Its amount is public — it is measured on chain,
    // so it could not have been fixed at proof time — but its owner is not.
    {
      type: "transfer",
      token: a.token as `0x${string}`,
      amount: "OPEN",
      recipient: recipient as `0x${string}`,
    },
    {
      type: "invoke",
      contract: a.market as `0x${string}`,
      calldata: [
        num.toHex(OP.claim),
        num.toHex(s.marketId),
        lowLo,
        lowHi,
        highLo,
        highHi,
        a.token,
        // Nothing is withdrawn to the helper on a claim; it already holds the stake.
        "0x0",
        s.secret,
        "${openNoteIds[0]}",
      ],
    },
  ];
}

export interface SubmitResult {
  ok: boolean;
  txHash?: string;
  error?: string;
}

/**
 * Hand a list of actions to the wallet.
 *
 * Dry-runs first wherever the wallet supports it. The docs call this "the cheapest way to
 * catch a calldata-shape mistake", and the alternative is finding out after the user has
 * already approved and paid for a transaction that could never have worked.
 */
export async function submit(
  connection: Connection,
  actions: STRK20_ACTION[],
  { dryRun = true }: { dryRun?: boolean } = {},
): Promise<SubmitResult> {
  if (!connection.capabilities.privateActions) {
    return { ok: false, error: `${connection.walletName} does not expose STRK20 actions.` };
  }

  if (dryRun && connection.capabilities.dryRun) {
    try {
      await connection.account.strk20PrepareInvoke(actions, true);
    } catch (err) {
      return {
        ok: false,
        error: `The wallet refused this before signing: ${errorText(err)}`,
      };
    }
  }

  try {
    const { transaction_hash } = await connection.account.strk20InvokeTransaction(actions);
    return { ok: true, txHash: transaction_hash };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

/**
 * The most informative sentence available from a wallet or chain error.
 *
 * Wallets wrap RPC failures in their own envelopes, so the useful text is often two levels
 * down and the top-level message is a generic one that sends whoever is debugging in the
 * wrong direction.
 */
export function errorText(e: unknown): string {
  const err = e as { message?: string; data?: { message?: string }; shortMessage?: string };
  const pick =
    err?.data?.message || err?.shortMessage || err?.message || String(e) || "unknown error";
  return pick.split("\n")[0].slice(0, 200);
}
