"use client";

import type { STRK20_ACTION } from "@starknet-io/types-js";
import type { Connection, Strk20Account } from "./wallet";

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

/** Position identity lives in the SDK, beside the vector that pins it to the contract. */
export { OP, commitmentOf, newSecret, POSITION_TAG } from "@molfi/sdk";
export type { PositionSecret } from "@molfi/sdk";

/**
 * The action builders live in the SDK, beside the position identity they encode.
 *
 * Re-exported so the console's imports read as they always have. Defining them there is what
 * lets `/privacy` render the actual action list a wallet is handed instead of an illustration
 * of one, and what lets a test check the real thing.
 */
export {
  shieldActions,
  unshieldActions,
  openActions,
  claimActions,
  type PoolAddresses,
  type Strk20Action,
} from "@molfi/sdk";

export interface SubmitResult {
  ok: boolean;
  txHash?: string;
  error?: string;
  /** See the note on the direct route's result: false only when nothing can have been sent. */
  maybeSubmitted?: boolean;
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
    return {
      ok: false,
      error: `${connection.walletName} does not expose STRK20 actions.`,
      maybeSubmitted: false,
    };
  }

  if (dryRun && connection.capabilities.dryRun) {
    try {
      await (connection.account as Strk20Account).strk20PrepareInvoke(actions, true);
    } catch (err) {
      return {
        ok: false,
        error: `The wallet refused this before signing: ${errorText(err)}`,
        maybeSubmitted: false,
      };
    }
  }

  try {
    /**
     * The pool route needs the wallet-standard interface, which only an extension has.
     *
     * `routesFor` never offers this route unless `capabilities.privateActions` is true, and
     * that is only ever true for a wallet-standard connection — so reaching here with a Privy
     * account is a routing bug, and the guard says so instead of failing inside the cast.
     */
    if (!connection.wallet) {
      return {
        ok: false,
        error: "This wallet cannot take the pool route — it exposes no STRK20 actions.",
        maybeSubmitted: false,
      };
    }
    const { transaction_hash } = await (
      connection.account as Strk20Account
    ).strk20InvokeTransaction(actions);
    return { ok: true, txHash: transaction_hash };
  } catch (err) {
    return { ok: false, error: errorText(err), maybeSubmitted: !isUserRejection(err) };
  }
}

/**
 * The most informative sentence available from a wallet or chain error.
 *
 * Wallets wrap RPC failures in their own envelopes, so the useful text is often two levels
 * down and the top-level message is a generic one that sends whoever is debugging in the
 * wrong direction.
 */
/**
 * Did the user simply say no?
 *
 * SNIP-9 gives rejection its own code, 113, and wallets word it differently on top of that —
 * "User abort", "User rejected request", "Reject". Worth detecting for two reasons: the
 * wording is the wallet's internal vocabulary rather than anything a person should read, and
 * more importantly a cancellation is not a failure. Showing it in the same red as a revert
 * tells someone who deliberately backed out that something went wrong.
 */
export function isUserRejection(e: unknown): boolean {
  const err = e as { code?: number | string; message?: string; data?: { message?: string } };
  if (err?.code === 113 || String(err?.code) === "113") return true;
  const text = `${err?.message ?? ""} ${err?.data?.message ?? ""}`;
  return /user (abort|reject|denied|cancel)|rejected by user|request rejected|user closed/i.test(text);
}

export function errorText(e: unknown): string {
  if (isUserRejection(e)) return "cancelled — nothing was sent";

  const err = e as { message?: string; data?: { message?: string }; shortMessage?: string };
  const text =
    err?.data?.message || err?.shortMessage || err?.message || String(e) || "unknown error";

  // A contract refusal arrives as a Cairo short string in parentheses, several envelopes
  // deep. It is the whole content of the failure and the only part worth showing.
  const named = text.match(/\('([A-Z0-9_]+)'\)/) ?? text.match(/'([A-Z][A-Z0-9_]{5,})'/);
  if (named) return named[1].replace(/_/g, " ").toLowerCase();

  // An RPC rejection does not. starknet.js formats it across several lines with the request
  // echoed first, so the first line is `RPC: starknet_estimateFee with params {` — which
  // names the *method* and says nothing about the failure. Taking it as the message is what
  // this function used to do, and a trader whose position was refused was shown exactly
  // that. The keeper learned the same lesson; this is the same extraction.
  const rpc = text.match(/"message"\s*:\s*"([^"]+)"/);
  if (rpc) return rpc[1].slice(0, 160);
  const bare = text.match(
    /(Invalid transaction nonce|Account validation failed|insufficient|exceed balance|reverted)[^\n"]*/i,
  );
  if (bare) return bare[0].slice(0, 160);

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const useful = lines.find((l) => !/^RPC:/.test(l) && !/^[{}[\],]/.test(l) && l.length > 12);
  return (useful ?? lines[0] ?? "unknown error").slice(0, 200);
}
