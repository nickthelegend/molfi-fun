import "server-only";
import { DRIP_AMOUNT, FAUCET_ADDRESS, faucetConfigured, strkBalance } from "@/lib/faucet";

/**
 * Can a stranger actually get in?
 *
 * A Privy wallet is a keypair; the account it controls does not exist until someone deploys it,
 * and `DEPLOY_ACCOUNT` is paid for by the account being deployed, out of a balance it does not
 * have. The house has to go first, and when the house cannot, nobody new can play — however
 * healthy every other part of the system is.
 *
 * Its own module because two callers need the same answer for different reasons, and they must
 * not drift. `/api/health` reports it alongside the chain, the oracle and the market, for an
 * operator. `/api/door` answers it alone, cheaply and always 200, for the gate.
 *
 * The balance is checked and not just the configuration: a faucet that is configured and empty
 * fails at exactly the same place, with a stranger's login already spent.
 */
export type Door = {
  status: "ok" | "degraded" | "down";
  detail: string;
  address?: string;
  balance?: string;
  drip?: string;
  newAccountsFundable?: number;
};

export async function readDoor(): Promise<Door> {
  if (!faucetConfigured || !FAUCET_ADDRESS) {
    return {
      status: "down",
      detail: "no faucet configured — a new visitor can sign in but cannot be given an account",
    };
  }
  try {
    const balance = await strkBalance(FAUCET_ADDRESS);
    const fundable = Number(balance / DRIP_AMOUNT);
    return {
      // Degraded rather than down: everyone who already has an account keeps trading, and the
      // float may be topped up before the next visitor arrives. Only "no faucet at all" is down.
      status: fundable >= 1 ? "ok" : "degraded",
      address: FAUCET_ADDRESS,
      balance: balance.toString(),
      drip: DRIP_AMOUNT.toString(),
      newAccountsFundable: fundable,
      detail:
        fundable >= 1
          ? `funds ${fundable} more new account(s)`
          : "faucet is configured but too empty to fund one new account",
    };
  } catch (e) {
    return {
      status: "degraded",
      address: FAUCET_ADDRESS,
      detail: `balance unreadable: ${(e as Error).message.slice(0, 100)}`,
    };
  }
}
