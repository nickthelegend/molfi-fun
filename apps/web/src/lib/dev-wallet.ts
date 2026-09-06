import "server-only";

/**
 * A Starknet key for development, held only on the server.
 *
 * molfi's front door is a wallet, which makes the whole product unreachable to anything that
 * cannot complete an email round trip or install a browser extension — including every
 * automated check of the thing the app actually does. This is the way in for those.
 *
 * `server-only` for the same reason `privy-server.ts` has it: the one mistake here that
 * cannot be walked back is an accidental import from a client component, which would put a
 * signing key in the browser bundle. The signing route reads this and answers with a
 * signature; the key itself never appears in a response.
 *
 * The account is a throwaway Sepolia one holding test STRK, deliberately **not** the keeper —
 * so the worst this key can do is lose its own play money, rather than empty the bankroll the
 * desk pays winners from.
 */

const address = process.env.DEV_WALLET_ADDRESS;
const publicKey = process.env.DEV_WALLET_PUBLIC_KEY;
const privateKey = process.env.DEV_WALLET_PRIVATE_KEY;

export interface DevWallet {
  address: string;
  publicKey: string;
  privateKey: string;
}

/**
 * Null in production, whatever the environment says.
 *
 * Two independent conditions, because either alone is one mistake away from failing: the
 * variables are not set on any deployment, **and** a production build refuses them if they
 * ever are. A leaked staging config should not be able to turn a real deploy into one that
 * signs for anybody who asks.
 */
export const DEV_WALLET: DevWallet | null =
  process.env.NODE_ENV !== "production" && address && publicKey && privateKey
    ? { address, publicKey, privateKey }
    : null;

export const devSignerEnabled = DEV_WALLET !== null;
