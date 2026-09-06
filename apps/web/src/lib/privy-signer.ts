"use client";

import { Signer, type Signature } from "starknet";

/** How the app proves who it is, refreshed per call because access tokens expire. */
export interface PrivyAuth {
  accessToken: () => Promise<string | null>;
  identityToken: () => string | null;
}

/**
 * A starknet.js signer whose key is not in this browser.
 *
 * Everything starknet.js needs from a signer is a signature over a hash it computes itself, so
 * the key can live anywhere that will answer. Here it lives in Privy.
 *
 * Extending `Signer` rather than implementing `SignerInterface` is the whole design decision.
 * The interface has four methods and every one of them has to rebuild a transaction hash from
 * its parts — the invoke hash alone takes fourteen fields, three of which are enums whose
 * spelling differs between the RPC types and the hashing types. Getting any of them wrong
 * produces a signature that verifies against nothing, and the failure surfaces as a bare
 * `INVALID_SIG` from the sequencer with no clue which field was off. `Signer` already computes
 * all four hashes correctly and funnels them through one `protected signRaw`, so overriding
 * that single method leaves starknet.js owning every byte that goes into the hash and leaves
 * this class owning nothing but the round trip.
 *
 * The consequence worth stating is what a compromised browser gets. There is no key here to
 * steal — the worst it can do is ask the server to sign, which is the same thing a compromised
 * browser holding a key could do. What it cannot do is take the key elsewhere and keep signing
 * after the session ends.
 */
export class PrivySigner extends Signer {
  readonly #publicKey: string;
  readonly #auth: PrivyAuth;

  constructor(publicKey: string, auth: PrivyAuth) {
    // The base class wants a private key it will never be asked to use, because `signRaw` —
    // the only place `pk` is read — is replaced below. A zero makes that explicit.
    super("0x0");
    this.#publicKey = publicKey;
    this.#auth = auth;
  }

  override async getPubKey(): Promise<string> {
    return this.#publicKey;
  }

  /**
   * The one primitive: ask the server for a signature over one hash.
   *
   * The wallet is deliberately not sent. The endpoint reads it off the caller's own verified
   * session, so there is nothing here that could name somebody else's key.
   */
  protected override async signRaw(msgHash: string): Promise<Signature> {
    const accessToken = await this.#auth.accessToken();
    if (!accessToken) throw new Error("your session expired — sign in again");

    const idToken = this.#auth.identityToken();
    const res = await fetch("/api/wallet/sign", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        ...(idToken ? { "x-privy-id-token": idToken } : {}),
      },
      body: JSON.stringify({ hash: msgHash }),
      cache: "no-store",
    });

    const body = (await res.json().catch(() => ({}))) as { signature?: string; error?: string };
    if (!res.ok || !body.signature) {
      // The route's own sentence, not a status code. This string reaches the deck.
      throw new Error(body.error ?? `the signer answered ${res.status}`);
    }
    return splitSignature(body.signature);
  }
}

/**
 * Privy returns `r` and `s` glued together; Starknet wants them apart.
 *
 * 128 hex characters, sixty-four each, and the halves are fixed width — a leading zero in `s`
 * is part of the field element, not padding to be trimmed. Splitting on length rather than
 * parsing is what keeps that true: `BigInt(…).toString(16)` on the whole thing would silently
 * drop a zero byte and produce a signature that verifies against nothing.
 */
export function splitSignature(sig: string): Signature {
  const hex = sig.startsWith("0x") ? sig.slice(2) : sig;
  if (hex.length !== 128) {
    throw new Error(`the signer returned ${hex.length} hex digits, expected 128`);
  }
  return [`0x${hex.slice(0, 64)}`, `0x${hex.slice(64)}`];
}
