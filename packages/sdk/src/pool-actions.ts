/**
 * The STRK20 action lists a trade is made of.
 *
 * In the SDK for the same reason the direct route's calls are: this is where the browser and
 * the pool have to agree exactly, and a copy of that agreement inside a component is a copy
 * that drifts. It also means the privacy page can render the *real* action list a wallet
 * would be handed, rather than a hand-written illustration of one — which is the difference
 * between showing the integration and describing it.
 *
 * Nothing here signs, submits or touches a wallet.
 */

import { num } from "starknet";
import { OP, u256Parts, type PositionSecret } from "./positions.ts";

/**
 * The STRK20 action shape, transcribed rather than imported.
 *
 * `@starknet-io/types-js` is a dependency of the web app, not of this package, and adding it
 * here to name four object literals would drag the wallet-API types into every consumer of
 * the pricing kernel. The web app still checks these against the real `STRK20_ACTION` at the
 * point it hands them to the wallet, so a drift in the upstream type fails there.
 */
export type Strk20Action =
  | { type: "deposit"; token: `0x${string}`; amount: string }
  | { type: "withdraw"; token: `0x${string}`; amount: string; recipient: `0x${string}` }
  | { type: "transfer"; token: `0x${string}`; amount: string | "OPEN"; recipient: `0x${string}` }
  | { type: "invoke"; contract: `0x${string}`; calldata: string[] };

export interface PoolAddresses {
  pool: string;
  token: string;
  market: string;
}

const u256 = u256Parts;

/** Move public tokens into the pool. The public leg names you; nothing after it does. */
export function shieldActions(a: PoolAddresses, amount: bigint): Strk20Action[] {
  return [{ type: "deposit", token: a.token as `0x${string}`, amount: num.toHex(amount) }];
}

/** Move a private balance back out to a public address. Public again, and by design. */
export function unshieldActions(
  a: PoolAddresses,
  amount: bigint,
  to: string,
): Strk20Action[] {
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
 * Open a position: two actions, one atomic transaction.
 *
 * The withdraw leg is not optional and its absence was a real bug. The pool's
 * `InvokeExternalInput` is `{ contract_address, calldata }` and nothing else — no token, no
 * amount — so an invoke on its own moves no money at all. The documented swap example omits
 * the leg because the wallet's own SDK adds it there; reading the pool's ABI is what settles
 * it, and the ABI says the invoke cannot carry a transfer.
 *
 * Phase order makes this legal in one transaction: `Withdraw` is phase 6 and
 * `InvokeExternal` is phase 7, so the tokens land at the helper before it is called. The
 * pool's balance invariant closes because the note being spent covers the withdrawal.
 *
 * No open note is created. The helper returns an empty span, because the stake parks in the
 * contract until the market settles — asking the pool to open a note for a credit that never
 * arrives would leave the invariant unsatisfiable.
 *
 * Calldata order is the contract's `privacy_invoke` signature, in order. The pool
 * deserializes straight into those parameters, so this array *is* the interface — get the
 * order wrong and the failure is a deserialization error with nothing in it to read.
 */
export function openActions(
  a: PoolAddresses,
  s: PositionSecret,
  stake: bigint,
): Strk20Action[] {
  const [lowLo, lowHi] = u256(s.bandLow);
  const [highLo, highHi] = u256(s.bandHigh);
  return [
    // The stake, out of the pool and into the market contract. A public transfer: observers
    // see the pool pay the helper, not who asked it to.
    {
      type: "withdraw",
      token: a.token as `0x${string}`,
      amount: num.toHex(stake),
      recipient: a.market as `0x${string}`,
    },
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
): Strk20Action[] {
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

