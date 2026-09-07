import { NextResponse } from "next/server";
import { hash } from "starknet";
import {
  MARKETS,
  MAX_PRICE_AGE_SECONDS,
  NETWORKS,
  SETTLEMENT_MAX_PRICE_AGE_SECONDS,
  decodePrint,
  freshness,
  pairId,
} from "@molfi/sdk";
import {
  FALLBACK_RPC_URL,
  NETWORK,
  ORACLE_ADDRESS,
  RPC_URL,
  call,
  lastGoodEndpoint,
} from "@/lib/rpc";
import { DRIP_AMOUNT, FAUCET_ADDRESS, faucetConfigured, strkBalance } from "@/lib/faucet";

/**
 * Is this deployment actually working right now?
 *
 * Several things can be true or false independently, and the app fails differently for each:
 * the node can be unreachable, the oracle can go stale or thin while the node is fine, and
 * the market contract can be absent while both of the others are healthy. Collapsing them
 * into one "ok" would hide exactly the distinction worth having, so each is reported on its
 * own with the evidence behind it.
 *
 * Every number here comes from a live call. There is no cached status to go stale.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * "absent" is not "down".
 *
 * A deployment with no molfi contract runs the demo desk and has no market to be down.
 * Reporting that as down makes the endpoint return 503 for a service working exactly as
 * configured, which is a false alarm rather than a signal.
 */
type Part = {
  status: "ok" | "degraded" | "down" | "absent";
  detail?: string;
  [k: string]: unknown;
};

/** Pragma republishes every few minutes; past this the contract will refuse to settle. */
const ORACLE_REFUSES_AFTER_S = 900;
/** Well before the refusal, so a feed that is drifting is visible before it breaks. */
const ORACLE_DEGRADED_AFTER_S = 420;

export async function GET() {
  const network = NETWORKS[NETWORK];

  // ---- the node
  //
  // Tried by name so the two endpoints are distinguishable. "Working" and "working on the
  // backup because the configured key is pointed at a network it cannot serve" are very
  // different states, and collapsing them is how a misconfiguration survives to production.
  let chain: Part;
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "starknet_blockNumber" }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await res.json()) as { result?: number; error?: { message?: string } };
    if (typeof body.result !== "number") throw new Error(body.error?.message ?? "no result");
    chain = {
      status: "ok",
      block: body.result,
      chainId: network.chainId,
      network: NETWORK,
      endpoint: "configured",
    };
  } catch (e) {
    const primaryError = (e as Error).message.slice(0, 160);
    if (RPC_URL === FALLBACK_RPC_URL) {
      chain = {
        status: "down",
        detail: primaryError,
        chainId: network.chainId,
        network: NETWORK,
      };
    } else {
      try {
        const res = await fetch(FALLBACK_RPC_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "starknet_blockNumber" }),
          cache: "no-store",
          signal: AbortSignal.timeout(8_000),
        });
        const body = (await res.json()) as { result?: number; error?: { message?: string } };
        if (typeof body.result !== "number") throw new Error(body.error?.message ?? "no result");
        chain = {
          status: "degraded",
          detail: `the configured endpoint refused: ${primaryError}`,
          block: body.result,
          chainId: network.chainId,
          network: NETWORK,
          endpoint: "public fallback",
        };
      } catch (e2) {
        chain = {
          status: "down",
          detail: `configured endpoint: ${primaryError}; fallback: ${(e2 as Error).message.slice(0, 120)}`,
          chainId: network.chainId,
          network: NETWORK,
        };
      }
    }
  }

  // ---- the oracle, measured by reading it rather than by asking whether it is up
  const oracleAddress = ORACLE_ADDRESS;
  const pairs = oracleAddress === null ? [] : await Promise.all(
    MARKETS.map(async (m) => {
      try {
        const raw = await call(oracleAddress, hash.getSelectorFromName("get_data_median"), [
          "0x0",
          "0x" + pairId(m.label).toString(16),
        ]);
        const print = decodePrint(raw);

        // Two questions, two limits, and this route was answering the wrong one.
        //
        // `freshness` defaults to the desk's 600s, which is how old a print may be before
        // molfi will *quote* on it. Settling is the contract's rule and it is 900s, because
        // Pragma publishes every seven to ten minutes and a stricter settlement rule would
        // strand markets that can never resolve. Labelling the 600s answer `settleable` made
        // health report the oracle `down` for a print the chain would have settled against
        // quite happily — the API contradicting the contract, which is the one thing nothing
        // here is allowed to do.
        const now = Math.floor(Date.now() / 1000);
        const settle = freshness(print, now, SETTLEMENT_MAX_PRICE_AGE_SECONDS);
        const quote = freshness(print, now, MAX_PRICE_AGE_SECONDS);
        return {
          pair: m.label,
          ageSeconds: settle.ageSeconds,
          sources: print.sources,
          settleable: settle.fresh,
          /** Whether the desk would sell a band on it, which is a stricter question. */
          quotable: quote.fresh,
          refusal: settle.reason,
        };
      } catch (e) {
        return {
          pair: m.label,
          error: (e as Error).message.slice(0, 100),
          settleable: false,
          quotable: false,
        };
      }
    }),
  );

  const worst = pairs.reduce(
    (n, p) => Math.max(n, typeof p.ageSeconds === "number" ? p.ageSeconds : Infinity),
    0,
  );
  const oracle: Part = oracleAddress === null
    ? { status: "absent", detail: `no oracle is configured for ${NETWORK}` }
    : pairs.every((p) => p.settleable)
    ? worst > ORACLE_DEGRADED_AFTER_S
      ? {
          status: "degraded",
          detail: pairs.every((p) => p.quotable)
            ? `oldest print is ${worst}s; the contract refuses past ${ORACLE_REFUSES_AFTER_S}s`
            : `oldest print is ${worst}s — still settleable, but past the ${MAX_PRICE_AGE_SECONDS}s the desk will quote on`,
          address: oracleAddress,
          pairs,
        }
      : { status: "ok", address: oracleAddress, pairs }
    : {
        status: "down",
        detail: "at least one pair cannot currently be settled against",
        address: oracleAddress,
        pairs,
      };

  // ---- molfi's own contract
  let market: Part = {
    status: "absent",
    detail: `no molfi market contract on ${NETWORK} — the console runs the demo desk`,
  };
  if (network.market) {
    try {
      const [count] = await call(network.market, hash.getSelectorFromName("market_count"));
      market = {
        status: "ok",
        address: network.market,
        markets: Number(BigInt(count)),
      };
    } catch (e) {
      market = {
        status: "down",
        address: network.market,
        detail: (e as Error).message.slice(0, 120),
      };
    }
  }

  // ---- the privacy pool
  let pool: Part = { status: "absent", detail: `no pool configured for ${NETWORK}` };
  if (network.privacyPool) {
    // Reachability, not health: the pool is StarkWare's and molfi has no business judging
    // it. Whether *some* node can see it is the useful signal — a degraded chain is one
    // answering from the fallback, which reads the same chain.
    pool = {
      status: chain.status === "down" ? "down" : "ok",
      address: network.privacyPool,
    };
  }

  // ---- the keeper
  //
  // Reported, and deliberately never able to make this endpoint unhealthy. Settlement is
  // permissionless: a dead keeper means nobody is settling automatically, not that markets
  // cannot settle. Marking the deployment down for it would be claiming a dependency that
  // does not exist.
  let keeper: Part = {
    status: "absent",
    detail: "no keeper configured — settlement is permissionless and anyone may do it",
  };
  if (process.env.KEEPER_URL) {
    try {
      const res = await fetch(`${process.env.KEEPER_URL}/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(6_000),
      });
      const body = (await res.json()) as Record<string, unknown>;
      keeper = {
        status: body.ok ? "ok" : "degraded",
        cycles: body.cycles,
        lagMs: body.lagMs,
        relayed: body.relayed,
        settled: body.settled,
        listed: body.listed,
        detail: body.ok
          ? `last cycle ${body.lagMs}ms ago`
          : `alive but stalled — last cycle ${body.lagMs}ms ago`,
      };
    } catch (e) {
      keeper = {
        status: "degraded",
        detail: `unreachable: ${(e as Error).message.slice(0, 100)}`,
      };
    }
  }

  /**
   * Can a stranger actually get in?
   *
   * Everything above answers "is the desk working", and all of it can be green while the
   * product is unusable by anyone who does not already have an account. That is not a
   * hypothetical: production ran with no `FAUCET_ADDRESS` set, so `/api/wallet/fund` answered
   * 503 to every new visitor, and this endpoint reported `ok: true` throughout. The first
   * person to find out was whoever signed in.
   *
   * A Privy wallet is a keypair; the account it controls does not exist until someone deploys
   * it, and `DEPLOY_ACCOUNT` is paid for by the account being deployed, out of a balance it
   * does not have. So the house has to go first, and if the house cannot, nobody can play. The
   * balance is checked and not just the configuration, because a faucet that is configured and
   * empty fails at exactly the same place with a stranger's login already spent.
   */
  let door: Part = {
    status: "down",
    detail: "no faucet configured — a new visitor can sign in but cannot be given an account",
  };
  if (faucetConfigured && FAUCET_ADDRESS) {
    try {
      const balance = await strkBalance(FAUCET_ADDRESS);
      const enough = balance >= DRIP_AMOUNT;
      door = {
        // Degraded rather than down: existing players still trade, and the drip may be
        // topped up between now and the next visitor. Only "no faucet at all" is down.
        status: enough ? "ok" : "degraded",
        address: FAUCET_ADDRESS,
        balance: balance.toString(),
        drip: DRIP_AMOUNT.toString(),
        newAccountsFundable: Number(balance / DRIP_AMOUNT),
        detail: enough
          ? `funds ${Number(balance / DRIP_AMOUNT)} more new account(s)`
          : "faucet is configured but too empty to fund one new account",
      };
    } catch (e) {
      door = { status: "degraded", address: FAUCET_ADDRESS, detail: `balance unreadable: ${(e as Error).message.slice(0, 100)}` };
    }
  }

  const parts = { chain, oracle, market, pool, keeper, door };
  const answering = lastGoodEndpoint();
  /**
   * Two parts are excluded from the verdict, for two different reasons.
   *
   * The keeper is a convenience and not a dependency — settlement is permissionless, so its
   * death means nobody is settling *automatically*, not that markets cannot settle.
   *
   * The door is excluded because a shut door does not stop this deployment serving: the site
   * renders, markets settle, and everyone who already has an account keeps trading. Flipping
   * the whole endpoint to 503 over an empty faucet would page someone about a site that is up.
   * It is reported in full so that nobody can read `ok: true` as "anyone can play" — and the
   * gate reads this and refuses to send a stranger through a door it knows is shut, which is
   * where that fact actually matters.
   */
  const down = Object.entries(parts).some(
    ([k, p]) => k !== "keeper" && k !== "door" && p.status === "down",
  );

  return NextResponse.json(
    {
      ok: !down,
      at: new Date().toISOString(),
      // Named, not printed: the configured URL may carry an API key.
      answeredBy: answering === RPC_URL ? "configured" : answering ? "public fallback" : null,
      ...parts,
    },
    { status: down ? 503 : 200, headers: { "cache-control": "no-store" } },
  );
}
