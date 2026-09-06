import { NextResponse } from "next/server";
import { callerOf, privy, privyConfigured, walletFor } from "@/lib/privy-server";
import { DEV_WALLET, devSignerEnabled } from "@/lib/dev-wallet";
import {
  DRIP_AMOUNT,
  TOP_UP_BELOW,
  drip,
  faucetConfigured,
  isDeployed,
  strkBalance,
} from "@/lib/faucet";
import { accountAddressFor } from "@/lib/account-address";

/**
 * Get the caller's account ready to trade: funded, and told whether it still needs deploying.
 *
 * The address is **derived here, from the caller's own public key**, and never read from the
 * request. That is the whole security design of this endpoint. A drip route that accepts an
 * address is a faucet anyone can point anywhere and drain in a loop; one that can only ever
 * pay the address belonging to the session making the call can be abused only by someone
 * repeatedly emptying their own wallet, which costs them more in fees than it yields.
 *
 * It does not deploy. It cannot: `DEPLOY_ACCOUNT` is signed by the account's own key, which
 * lives at Privy and is reachable only through the browser's signer. So this endpoint puts
 * the STRK there and reports what remains to be done; the browser does the deploying.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const no = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  if (!faucetConfigured) {
    return no(503, "no faucet is configured on this deployment, so accounts cannot be funded");
  }

  /**
   * Whose account this is, established before anything is spent.
   *
   * Outside production the development wallet stands in when there is no Privy session — the
   * same escape the signing route has, and reachable on the same terms: no session to use
   * instead, not production, and only when the key is set. It is a real, already-deployed
   * account, so it exercises the "already ready" answer rather than the funding path.
   */
  const caller = privyConfigured && privy ? await callerOf(req) : null;

  let publicKey: string;
  if (caller) {
    try {
      publicKey = (await walletFor(caller)).publicKey;
    } catch (e) {
      return no(502, `Privy would not answer: ${(e as Error).message}`.slice(0, 200));
    }
    if (!publicKey) return no(502, "Privy returned a wallet with no public key");
  } else if (devSignerEnabled && DEV_WALLET) {
    publicKey = DEV_WALLET.publicKey;
  } else {
    return no(401, "sign in first — this needs a live Privy session");
  }

  const address = accountAddressFor(publicKey, caller ? null : DEV_WALLET?.address ?? null);

  try {
    const [deployed, balance] = await Promise.all([isDeployed(address), strkBalance(address)]);

    /**
     * Fund when the balance is short, whether or not the account exists yet.
     *
     * Two different moments need this and they are easy to conflate. A brand-new account
     * needs STRK *before* it can deploy itself. An account that has been playing needs STRK
     * again once fees have worn it down — and refusing that because "it is already deployed"
     * strands a trader holding an unclaimable winning ticket.
     */
    if (balance >= TOP_UP_BELOW) {
      return NextResponse.json(
        { address, deployed, balance: balance.toString(), funded: false, txHash: null },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const txHash = await drip(address);
    const after = await strkBalance(address);

    /**
     * The balance is re-read rather than assumed to be `before + DRIP_AMOUNT`.
     *
     * `drip` waits for inclusion, so this is not a race — it is that the browser is about to
     * spend against this number, and a figure this endpoint computed is a claim while a
     * figure it read is a fact. They agree right up until the moment they do not.
     */
    return NextResponse.json(
      {
        address,
        deployed,
        balance: after.toString(),
        funded: true,
        amount: DRIP_AMOUNT.toString(),
        txHash,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return no(502, `could not prepare the account: ${(e as Error).message}`.slice(0, 200));
  }
}
