import "server-only";
import { PrivyClient } from "@privy-io/node";

/**
 * Privy, server side only.
 *
 * `server-only` at the top is not decoration. The app secret in this module signs on behalf of
 * every wallet molfi manages, and a single accidental import from a client component would put
 * it in the browser bundle — the one mistake here that cannot be walked back, because a secret
 * that has been served to a browser is a secret that has been published.
 */

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const appSecret = process.env.PRIVY_APP_SECRET;

/** Null rather than a throw at import time: an unconfigured deploy should render, not 500. */
export const privy = appId && appSecret ? new PrivyClient({ appId, appSecret }) : null;
export const privyConfigured = Boolean(appId && appSecret);

export interface StarknetWallet {
  id: string;
  address: string;
  publicKey: string;
}

export interface Caller {
  userId: string;
  /** The caller's Starknet wallet, if Privy has already made them one. */
  wallet: StarknetWallet | null;
}

/**
 * Who is asking, proven twice, and what they own.
 *
 * Privy's own integration guide shows a signing endpoint that takes a `walletId` and a `hash`
 * from the request body and signs, with no authentication whatsoever. Deployed as written that
 * is a remote signing oracle for every wallet the app manages: wallet ids are handed to the
 * browser, so anyone who can reach the URL can have the server sign any payload with anyone's
 * key. None of that is inherited here.
 *
 * Two tokens, because they answer two different questions. The **access token** proves there
 * is a live session and says whose. The **identity token** carries the user's linked accounts,
 * which is how the wallet is found — so the browser never names a wallet and cannot name
 * somebody else's. The two must agree on the user; a valid access token paired with another
 * account's identity token is refused rather than quietly preferring one of them.
 */
export async function callerOf(req: Request): Promise<Caller | null> {
  if (!privy) return null;

  const header = req.headers.get("authorization");
  const accessToken = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : null;
  const identityToken = req.headers.get("x-privy-id-token");
  if (!accessToken) return null;

  try {
    const claims = await privy.utils().auth().verifyAccessToken(accessToken);
    const userId = idFrom(claims);
    if (!userId) return null;

    if (!identityToken) return { userId, wallet: null };

    const user = await privy.utils().auth().verifyIdentityToken(identityToken);
    // Both tokens, one account. Without this the identity token could come from anywhere.
    if (idFrom(user) !== userId) return null;

    return { userId, wallet: starknetWalletOf(user) };
  } catch {
    // Invalid, expired, forged, or for another app — all the same answer. Distinguishing them
    // would tell someone guessing which part of the guess was right.
    return null;
  }
}

/** The id, whichever of Privy's three spellings this payload happens to use. */
function idFrom(o: unknown): string | null {
  const r = o as { user_id?: string; userId?: string; id?: string; sub?: string };
  return r?.user_id ?? r?.userId ?? r?.id ?? r?.sub ?? null;
}

/**
 * The Starknet wallet among a user's linked accounts, if there is one.
 *
 * Privy's `LinkedAccount` is a discriminated union of a dozen shapes and the wallet fields are
 * not on every arm, so this reads it as records. Cast once, here, with the reason written
 * down, rather than at each call site where the next reader has to work out whether it was
 * deliberate.
 */
export function starknetWalletOf(user: unknown): StarknetWallet | null {
  const accounts = (user as { linked_accounts?: unknown }).linked_accounts;
  if (!Array.isArray(accounts)) return null;

  for (const raw of accounts as Array<Record<string, unknown>>) {
    if (raw.chain_type !== "starknet") continue;
    const id = (raw.id ?? raw.wallet_id) as string | undefined;
    const address = raw.address as string | undefined;
    if (!id || !address) continue;
    return { id, address, publicKey: (raw.public_key as string) ?? "" };
  }
  return null;
}

/**
 * This user's Starknet wallet, resolved without needing an identity token.
 *
 * The identity token was originally the only way to find an existing wallet, and requiring it
 * broke the entire login: identity tokens are a per-app Privy setting, this app does not have
 * them enabled, so `useIdentityToken()` returned nothing, the client's effect never fired, and
 * a **successfully authenticated** visitor sat on "OPENING YOUR WALLET…" forever. The bug was
 * invisible until the email round trip could actually be completed.
 *
 * `create` takes an **idempotency key**, which is the primitive that was wanted all along: the
 * same key returns the same wallet instead of making a second one. Keyed on the Privy user id,
 * so "create this user's wallet" and "fetch this user's wallet" are one call that is safe to
 * repeat — from any browser, on any device, after any reload.
 *
 * The identity token stays supported and is preferred when present: it answers from the user's
 * own linked accounts with no write at all.
 */
export async function walletFor(caller: Caller): Promise<StarknetWallet> {
  if (!privy) throw new Error("wallets are not configured on this deployment");

  /**
   * The linked-account shortcut is gone, deliberately.
   *
   * It used to return `caller.wallet` — a Starknet wallet found among the user's linked
   * accounts — without going to Privy at all. That was right while wallets were user-owned.
   * Now the only wallet molfi can actually sign for is the app-owned one behind the
   * idempotency key below, and a linked account is by definition *not* that. Preferring it
   * would hand a returning user the wallet from the old model: real address, real balance,
   * no way to sign.
   *
   * One source of truth for "which account is this session's", even though it costs a call.
   */

  /**
   * Created **without** an `owner`, and that is a custody decision rather than an oversight.
   *
   * Passing `owner: { user_id }` makes the wallet the user's, which sounds strictly better and
   * silently breaks the product: Privy will then only sign for it with a *user signing key* or
   * an *app authorization key*, and this app has neither. Every signature came back
   * `401 No valid authorization keys or user signing keys available` — after the account had
   * been funded, at the moment it tried to deploy itself, which is the most expensive possible
   * place to discover it. The wallet existed, the address was real, the STRK was really there,
   * and nothing could ever move it.
   *
   * So the wallet is app-owned and molfi's server signs for it, once it has verified the
   * caller's session. That is custodial, and it is the same trust the rest of the product
   * already asks for — molfi funds the account, runs the keeper and settles the rounds. What
   * matters is that it is **said out loud** rather than implied: `/privacy` names it.
   *
   * The user id still scopes the wallet through the idempotency key, so two people never share
   * an account and one person keeps theirs across devices and reloads.
   *
   * `v2` in the key is deliberate. The first version created owner-scoped wallets, and
   * reusing that key would hand a returning tester back the unsignable wallet they already
   * have instead of one that works.
   */
  const wallet = await privy.wallets().create({
    chain_type: "starknet",
    idempotency_key: `starknet:v2:${caller.userId}`,
  });
  return {
    id: wallet.id,
    address: wallet.address,
    publicKey: wallet.public_key ?? "",
  };
}
