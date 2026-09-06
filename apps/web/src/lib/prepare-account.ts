"use client";

import { Account, CallData, RpcProvider, type SignerInterface } from "starknet";
import { OZ_ACCOUNT_CLASS, accountAddressFor } from "@/lib/account-address";
import { RPC_URL } from "@/lib/chain";

/**
 * Getting a brand-new wallet ready to actually play.
 *
 * Signing in gives a visitor a keypair. It does not give them an account: on Starknet the
 * thing that holds tokens and sends transactions is a deployed contract, and until it exists
 * the address is a prediction. Everything downstream — the balance strip, the quote, the fire
 * key — reads correctly against that prediction and then fails at the first signature, which
 * is the worst possible place to discover the account was never there. The old behaviour was
 * exactly this: the gate handed over a counterfactual, empty account and the console found out
 * on the user's behalf.
 *
 * Two steps, in this order, and the order is forced. The deployment fee is paid by the account
 * being deployed, so it has to hold STRK before it can exist. Funding is the server's job
 * because it involves a key the browser must never see; deploying is the browser's job because
 * it is signed by the account's own key, which lives at Privy and is reachable only through
 * the signer. Neither side can do the other's half.
 */

/**
 * Three stages, and no fourth one for funding.
 *
 * Funding happens inside `preparing`: the server decides whether it is needed and does it in
 * the same request, so the browser never reaches a moment where "funding" is true and
 * "checking" is not. A stage that can never be emitted is a stage that lies about the flow to
 * whoever reads this next.
 */
export type PrepareStage = "preparing" | "deploying" | "ready";

export interface Prepared {
  address: string;
  balance: bigint;
  /** The funding transaction, when one was needed. Null when the account already had STRK. */
  fundedTx: string | null;
  /** The deployment transaction, when one was needed. Null when the account already existed. */
  deployTx: string | null;
}

interface FundResponse {
  address?: string;
  deployed?: boolean;
  balance?: string;
  funded?: boolean;
  txHash?: string | null;
  error?: string;
}

/**
 * Ask the server to fund this session's account, then deploy it if it is not there yet.
 *
 * `onStage` exists because this takes real time — a funding transaction and a deployment,
 * each waiting for inclusion — and a screen that says nothing for twenty seconds is
 * indistinguishable from one that has hung. It reports what is happening, not a spinner.
 */
export async function prepareAccount(
  publicKey: string,
  signer: SignerInterface,
  auth: { accessToken: () => Promise<string | null>; identityToken: () => string | null },
  onStage: (stage: PrepareStage) => void,
  /** Set for a wallet whose account is already on chain at an address of its own. */
  deployedAt?: string | null,
): Promise<Prepared> {
  onStage("preparing");

  const accessToken = await auth.accessToken().catch(() => null);
  const idToken = auth.identityToken();
  const res = await fetch("/api/wallet/fund", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(idToken ? { "x-privy-id-token": idToken } : {}),
    },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as FundResponse;
  if (!res.ok) throw new Error(body.error ?? `the funding service answered ${res.status}`);

  const address = body.address ?? accountAddressFor(publicKey, deployedAt ?? null);
  const balance = BigInt(body.balance ?? "0");
  const fundedTx = body.funded ? body.txHash ?? null : null;

  if (body.deployed) return { address, balance, fundedTx, deployTx: null };

  /**
   * An account with nothing in it cannot pay to exist.
   *
   * Worth its own sentence rather than letting `deployAccount` fail: the node's answer to
   * this is a validation error about resource bounds, which reads as a bug in molfi rather
   * than as an empty wallet.
   */
  if (balance === 0n) {
    throw new Error("the faucet is empty — nothing could be sent to your account");
  }

  onStage("deploying");
  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const account = new Account({ provider, address, signer });

  const { transaction_hash } = await account.deployAccount(
    {
      classHash: OZ_ACCOUNT_CLASS,
      constructorCalldata: CallData.compile({ publicKey }),
      /**
       * Salt is the public key, matching `accountAddressFor` exactly.
       *
       * If this and the derivation disagree, the deployment succeeds — at a *different*
       * address from the one that was just funded, leaving the STRK stranded at an account
       * that will now never exist. The two have to be read together, which is why the class
       * and the derivation live in one file and this is the only other place naming them.
       */
      addressSalt: publicKey,
      contractAddress: address,
    },
    // Explicit tip, for the reason in `wallet.ts`: otherwise starknet.js downloads three whole
    // blocks to compute a number Starknet does not currently use, on the critical path.
    { tip: 0 },
  );
  await provider.waitForTransaction(transaction_hash);

  onStage("ready");
  return { address, balance, fundedTx, deployTx: transaction_hash };
}
