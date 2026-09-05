import { NextResponse } from "next/server";
import {
  CALIBRATED_MARKETS,
  GENERATED_AT,
  HOUSE_EDGE_BPS,
  MARKETS,
  MAX_MULTIPLIER_BPS,
  MIN_MULTIPLIER_BPS,
  MAX_PRICE_AGE,
  MIN_SOURCES,
  NETWORKS,
  PRICE_DECIMALS,
  ROUND_KEYS,
  ROUND_SECONDS,
  STAKE_DECIMALS,
  roundLabel,
} from "@molfi/sdk";
import { NETWORK } from "@/lib/rpc";

/**
 * Everything a client needs before it can render anything.
 *
 * Addresses, the markets molfi lists, the round lengths, the units, and the rules the
 * contract enforces. A UI that hardcodes any of these will be wrong on some network or after
 * some redeploy, and wrong quietly — a stale token address does not error, it just points at
 * the wrong token.
 *
 * Deliberately includes the probability tables. They are the thing that decides every
 * multiplier, and publishing them is what makes a quote checkable rather than a claim; a
 * calibration that only the operator can see is not a disclosure.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const network = NETWORKS[NETWORK];

  return NextResponse.json(
    {
      network: NETWORK,
      chainId: network.chainId,
      explorer: network.explorer || null,

      contracts: {
        /** molfi's anonymizer. Null until it is deployed here. */
        market: network.market,
        /** The STRK20 privacy pool. Every private action goes through it. */
        pool: network.privacyPool,
        /** The settlement token. */
        token: network.stakeToken,
        /** Pragma's aggregator, which settles every market. */
        oracle: network.oracle,
      },

      units: {
        /** Pragma normalises spot medians to this many decimals. */
        priceDecimals: PRICE_DECIMALS,
        /** STRK is an 18 decimal token; every stake and payout is in these units. */
        stakeDecimals: STAKE_DECIMALS,
        /** Band half-widths are a fraction of spot times this. */
        widthScale: "100000000",
        /** Probabilities are 1e6 fixed point; multipliers are basis points. */
        probScale: "1000000",
        bpsScale: 10_000,
      },

      rules: {
        houseEdgeBps: Number(HOUSE_EDGE_BPS),
        /** The desk's floor and ceiling. The contract's own floor is 1.0001x. */
        minMultiplierBps: Number(MIN_MULTIPLIER_BPS),
        maxMultiplierBps: Number(MAX_MULTIPLIER_BPS),
        /** A settling print older than this is refused. */
        maxPriceAgeSeconds: MAX_PRICE_AGE,
        /** A median backed by fewer publishers than this is refused. */
        minPublishers: MIN_SOURCES,
        /** No round may be shorter than one oracle publish interval. */
        minRoundSeconds: Math.min(...ROUND_SECONDS),
      },

      rounds: ROUND_SECONDS.map((seconds, tier) => ({
        tier,
        key: ROUND_KEYS[tier],
        seconds,
        label: roundLabel(tier),
      })),

      markets: MARKETS.map((m) => ({
        key: m.key,
        pair: m.label,
        symbol: m.symbol,
        /** Display decimals. Two renders STRK's whole price as "0.02". */
        dp: m.dp,
        /** The pair label as the felt the contract stores. */
        pairId: m.pairId.toString(),
        /** Where the tape came from. Calibration and the live mark only — never settlement. */
        source: m.source,
        rounds: m.rounds.map((r, tier) => ({
          tier,
          seconds: r.seconds,
          sigma1e4: r.sigma1e4.toString(),
          minProb1e6: r.minProb1e6.toString(),
          maxMultiplierBps: r.maxMultiplierBps.toString(),
          probTable: r.probTable.map(String),
        })),
      })),

      calibration: {
        generatedAt: GENERATED_AT,
        markets: CALIBRATED_MARKETS.length,
        note:
          "Measured per round length on real minute closes, not assumed normal. Sigma is " +
          "shaded below measured so the model quotes a chance at or above the real one; " +
          "the spread that buys is disclosed rather than hidden.",
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
