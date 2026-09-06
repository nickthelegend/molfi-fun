/**
 * Position identity: the secret, and the commitment derived from it.
 *
 * This is the single point where the desk and the chain must agree. The browser derives the
 * commitment to look a position up; the contract derives it to decide who gets paid. If the
 * two disagreed by one field element every position would open fine and none could ever be
 * found again — and nothing short of a real payout would reveal it. So the derivation lives
 * here, in one place, mirrored by `commitment_of` in `market.cairo` and checked against it by
 * a fixed vector on both sides.
 */

import { hash, num } from "starknet";

/** Domain separator. Must equal `POSITION_TAG` in `market.cairo`. */
export const POSITION_TAG = "MOLFI_POSITION_V1";

/** The operations molfi's anonymizer understands, matching `market.cairo`. */
export const OP = { open: 0, claim: 1 } as const;

export interface PositionSecret {
  /** Random, generated in the browser, and the only thing that can claim the payout. */
  secret: string;
  marketId: number;
  bandLow: bigint;
  bandHigh: bigint;
}

/** A Cairo short string as the felt it encodes. */
export function shortStringToFelt(text: string): string {
  let out = 0n;
  for (const ch of text) out = (out << 8n) | BigInt(ch.charCodeAt(0));
  return "0x" + out.toString(16);
}

/** A u256 as the two felts Cairo's calldata expects, low limb first. */
export function u256Parts(v: bigint): [string, string] {
  return [num.toHex(v & ((1n << 128n) - 1n)), num.toHex(v >> 128n)];
}

/**
 * A fresh position secret.
 *
 * Generated from the platform CSPRNG and never sent anywhere. If it is lost the payout is
 * unreachable — not by molfi, not by anyone.
 *
 * 31 bytes, not 32: a felt is smaller than 2^252, and a full 32 bytes would sometimes
 * overflow the field and be silently reduced, producing a secret whose commitment nobody
 * could reproduce.
 */
export function newSecret(): string {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The commitment a position is stored under.
 *
 * Mirrors `commitment_of` in `market.cairo` exactly, including the order of the span. The
 * commitment is public and knowing it proves nothing about who holds its preimage, which is
 * what lets the desk look a position up without the chain being told who is asking.
 */
export function commitmentOf(s: PositionSecret): string {
  const [lowLo, lowHi] = u256Parts(s.bandLow);
  const [highLo, highHi] = u256Parts(s.bandHigh);
  return num.toHex(
    hash.computePoseidonHashOnElements([
      shortStringToFelt(POSITION_TAG),
      s.secret,
      num.toHex(BigInt(s.marketId)),
      lowLo,
      lowHi,
      highLo,
      highHi,
    ]),
  );
}

/** The domain tag for a direction ticket, matching `DIRECTION_TAG` in `updown.cairo`. */
const DIRECTION_TAG = "MOLFI_DIRECTION_V1";

/** The secret a direction ticket is opened under. No band — there is nothing to hide but a bit. */
export interface DirectionSecret {
  secret: string;
  roundId: number;
  direction: "up" | "down";
}

/**
 * The commitment a direction ticket is stored under.
 *
 * Mirrors `commitment_of` in `updown.cairo`: `poseidon(DIRECTION_TAG, secret, round_id,
 * direction)`, with the direction as the felt the contract uses — 0 for up, 1 for down.
 *
 * A direction is one bit, which is why the secret is inside the hash rather than beside it.
 * Without it, two guesses would open every ticket on the board. The **tag** is the other half:
 * both games hash `(tag, secret, id, …)` and both number their markets from one, so without
 * distinct domains a preimage valid on one contract would be valid on the other.
 */
export function commitmentOfDirection(s: DirectionSecret): string {
  return num.toHex(
    hash.computePoseidonHashOnElements([
      shortStringToFelt(DIRECTION_TAG),
      s.secret,
      num.toHex(BigInt(s.roundId)),
      num.toHex(s.direction === "up" ? 0n : 1n),
    ]),
  );
}
