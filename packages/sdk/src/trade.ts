/**
 * The calls a trade is made of.
 *
 * These live in the SDK rather than in the web app for the same reason `positions.ts` does:
 * they are the point where the browser and the chain have to agree exactly, and a copy of
 * that agreement in a component file is a copy that can drift. The console imports them, the
 * integration test imports them, and the integration test therefore checks the *same bytes*
 * the console sends rather than a reconstruction of them — which is the only version of that
 * test worth running.
 *
 * Nothing here signs, submits, or touches a wallet. Building a call and sending it are
 * separate concerns, and keeping them separate is what makes the building testable in Node.
 */

import { CallData, type Call } from "starknet";
import {
  commitmentOf,
  commitmentOfDirection,
  u256Parts,
  type DirectionSecret,
  type PositionSecret,
} from "./positions.ts";
import { offsetsOf } from "./pricing.ts";

/** The three contracts a trade touches. */
export interface TradeAddresses {
  pool: string;
  token: string;
  market: string;
}

/**
 * The band's reach, exactly as the contract recomputes it at claim time.
 *
 * `open_position` is told these two ratios and never the band. They are the whole of what the
 * price depends on — the absolute price divides out of `prob_inside` — so the chain can
 * charge correctly while knowing nothing about what the position predicts.
 */
export function reachOf(s: PositionSecret): [bigint, bigint] {
  return offsetsOf((s.bandLow + s.bandHigh) / 2n, s.bandLow, s.bandHigh);
}

/**
 * Approve, then open. Two calls, one transaction.
 *
 * The approve is exact rather than unlimited. An unlimited allowance to a market contract is
 * a standing invitation, and there is no reason to leave one behind for a position that is
 * opened once.
 */
/**
 * Open a direction ticket: approve the stake, then commit to a bit nobody can read.
 *
 * The same two-call shape as `openCalls` and for the same reason — the contract measures what
 * arrived rather than believing the calldata, so the approve is not optional. What differs is
 * everything the contract is told: a round id, a commitment, and a stake. No direction, no
 * reference, no band. The bit lives inside the hash until the ticket is claimed.
 */
export function openDirectionCalls(
  a: TradeAddresses & { upDownMarket: string },
  s: DirectionSecret,
  stake: bigint,
): Call[] {
  return [
    {
      contractAddress: a.token,
      entrypoint: "approve",
      calldata: CallData.compile([a.upDownMarket, ...u256Parts(stake)]),
    },
    {
      contractAddress: a.upDownMarket,
      entrypoint: "open_ticket",
      calldata: CallData.compile([
        s.roundId,
        commitmentOfDirection(s),
        ...u256Parts(stake),
      ]),
    },
  ];
}

/**
 * Claim a settled direction ticket, revealing the bit for the first time.
 *
 * The direction goes on chain here and only here. The contract recomputes the commitment from
 * `(secret, round_id, direction)` and finds nothing if any of the three is wrong — which is
 * also what a stranger guessing looks like, so a wrong guess and a wrong owner are the same
 * answer.
 */
export function claimDirectionCalls(
  a: { upDownMarket: string },
  s: DirectionSecret,
): Call[] {
  return [
    {
      contractAddress: a.upDownMarket,
      entrypoint: "claim_ticket",
      calldata: CallData.compile([s.roundId, s.secret, s.direction === "up" ? 0 : 1]),
    },
  ];
}

export function openCalls(a: TradeAddresses, s: PositionSecret, stake: bigint): Call[] {
  const [lowOff, highOff] = reachOf(s);
  return [
    {
      contractAddress: a.token,
      entrypoint: "approve",
      calldata: CallData.compile([a.market, ...u256Parts(stake)]),
    },
    {
      contractAddress: a.market,
      entrypoint: "open_position",
      calldata: CallData.compile([
        s.marketId,
        commitmentOf(s),
        ...u256Parts(lowOff),
        ...u256Parts(highOff),
        ...u256Parts(stake),
      ]),
    },
  ];
}

/**
 * Claim a settled winning position back to the address that opened it.
 *
 * The transaction where the band becomes public, and the only one. The contract recomputes
 * the commitment from the preimage and the reach from the band, and checks both — so a trader
 * can claim neither a band they did not buy nor a width they did not pay for.
 */
export function claimCalls(a: TradeAddresses, s: PositionSecret): Call[] {
  return [
    {
      contractAddress: a.market,
      entrypoint: "claim_position",
      calldata: CallData.compile([
        s.marketId,
        s.secret,
        ...u256Parts(s.bandLow),
        ...u256Parts(s.bandHigh),
      ]),
    },
  ];
}
