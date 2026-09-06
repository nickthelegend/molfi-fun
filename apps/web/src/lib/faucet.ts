import "server-only";
import { Account, CallData, RpcProvider, hash } from "starknet";
import { NETWORKS } from "@molfi/sdk";
import { NETWORK, RPC_URL, call } from "@/lib/rpc";

/**
 * The account that puts a brand-new Privy wallet on chain.
 *
 * There is a bootstrapping problem at the front door and it has exactly one honest solution.
 * A Privy wallet is a keypair; the account contract that key controls does not exist until
 * someone deploys it, and a `DEPLOY_ACCOUNT` transaction is paid for by the account being
 * deployed — out of a balance it does not have yet. So a visitor's first action cannot be
 * their own. Somebody has to go first, and on a testnet where nobody has STRK, that somebody
 * is the house.
 *
 * `server-only` for the same reason `privy-server.ts` and `dev-wallet.ts` have it: an
 * accidental import from a client component puts a signing key in the browser bundle, and a
 * key that has been served to a browser is a key that has been published.
 *
 * Deliberately **not** the keeper. The keeper holds the bankroll that pays winners, and the
 * failure mode of a drip endpoint is that it drips more than it should — so the account it
 * drips from is a float that can be emptied without the desk defaulting on a settled ticket.
 */

const address = process.env.FAUCET_ADDRESS;
const privateKey = process.env.FAUCET_PRIVATE_KEY;

export const faucetConfigured = Boolean(address && privateKey);
export const FAUCET_ADDRESS = address ?? null;

/**
 * What a new account is given, and why it is this much.
 *
 * Enough to deploy itself, take a position, and claim the payout — three transactions, the
 * middle one carrying a stake. Measured on Sepolia: a deploy costs about 0.05 STRK, an
 * `open_ticket` multicall about 0.25, a claim about 0.16. The smallest stake the desk offers
 * is 1 STRK and the rail goes to 10, so a visitor who can only afford the minimum has been
 * given a demo rather than a game.
 *
 * Twelve covers a ten-STRK position with the fees for its whole life around it. It is testnet
 * money and it is the difference between a judge playing the product and a judge reading
 * about it.
 */
export const DRIP_AMOUNT = 12_000_000_000_000_000_000n; // 12 STRK

/**
 * The balance below which a drip is offered.
 *
 * Not "is it zero". An account that has traded down to 0.2 STRK cannot pay for the claim on
 * the ticket it already holds, which is the worst moment to discover the desk only funds
 * empty accounts. This is above one round-trip's fees so the answer arrives before the
 * account is stuck rather than after.
 */
export const TOP_UP_BELOW = 2_000_000_000_000_000_000n; // 2 STRK

const provider = new RpcProvider({ nodeUrl: RPC_URL });

function faucet(): Account {
  if (!address || !privateKey) throw new Error("no faucet is configured on this deployment");
  return new Account({ provider, address, signer: privateKey });
}

/** STRK held by an address, whether or not an account contract exists there. */
export async function strkBalance(of: string): Promise<bigint> {
  const token = NETWORKS[NETWORK].stakeToken;
  if (!token) throw new Error(`no settlement token is configured for ${NETWORK}`);
  const [lo, hi] = await call(token, hash.getSelectorFromName("balanceOf"), [of]);
  return (BigInt(hi) << 128n) | BigInt(lo);
}

/** Whether an account contract exists at this address yet. */
export async function isDeployed(at: string): Promise<boolean> {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "starknet_getClassHashAt",
        params: ["latest", at],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json()) as { result?: string; error?: { message?: string } };
    if (body.result) return true;
    // "Contract not found" is the answer, not a failure. Anything else is a failure and must
    // not be reported as "not deployed" — that would send a second deploy at a live account.
    if (/not found/i.test(body.error?.message ?? "")) return false;
    throw new Error(body.error?.message ?? "the node would not say whether this is deployed");
  } catch (e) {
    throw new Error(`could not check the account: ${(e as Error).message}`.slice(0, 160));
  }
}

/**
 * Send `DRIP_AMOUNT` STRK to an address, and wait for it to land.
 *
 * Waiting is the point. The caller's next move is a `DEPLOY_ACCOUNT` paid from this balance,
 * and a transaction that has been accepted but not yet included leaves the account looking
 * exactly as empty as it did before. Returning early here means the deploy fails on a
 * balance that is about to arrive, which is the most confusing failure this flow can produce.
 */
export async function drip(to: string): Promise<string> {
  const token = NETWORKS[NETWORK].stakeToken;
  if (!token) throw new Error(`no settlement token is configured for ${NETWORK}`);

  const account = faucet();
  const { transaction_hash } = await account.execute(
    {
      contractAddress: token,
      entrypoint: "transfer",
      calldata: CallData.compile([to, { low: DRIP_AMOUNT, high: 0n }]),
    },
    // Explicit, for the reason written down in `wallet.ts`: left unset, starknet.js downloads
    // three whole blocks to estimate a tip that Starknet does not currently use.
    { tip: 0 },
  );
  await provider.waitForTransaction(transaction_hash);
  return transaction_hash;
}
