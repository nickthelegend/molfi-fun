import { NextResponse } from "next/server";
import {
  MARKETS,
  ROUND_SECONDS,
  parseStrk,
  quoteBand,
  sellableHalfWidths,
} from "@molfi/sdk";

/**
 * What a band costs, priced by the same integer kernel the contract mirrors.
 *
 * Offered as an endpoint so a client in any language can get a quote without reimplementing
 * the pricing — and reimplementing it is the one thing a client must never do. The desk and
 * the chain agree because they run mirrored copies of one kernel, checked against each other
 * by generated vectors; a third implementation would have nothing holding it to either.
 *
 * This is a *quote*, not an offer. The contract prices the band again at open, against the
 * table it holds, and its answer is the one that counts. They agree by construction; if they
 * ever did not, the contract would be right.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Every parameter this route understands.
 *
 * Anything else is refused rather than ignored. A quote is a number someone is about to
 * commit money against, and the failure mode of ignoring an unknown key is the worst kind:
 * `?round=2` looks like it selected the four hour round, the route silently prices the
 * fifteen minute one, and the caller is handed a confident, wrong, perfectly well-formed
 * answer. Refusing costs a caller one error message; ignoring costs them the trade.
 */
const KNOWN_PARAMS = new Set([
  "market",
  "tier",
  "spot",
  "stake",
  "stakeUnits",
  "low",
  "high",
  "halfWidth",
  "halfWidthPct",
]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const unknown = [...url.searchParams.keys()].filter((k) => !KNOWN_PARAMS.has(k));
  if (unknown.length > 0) {
    return bad(
      `unknown parameter${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. This route takes ${[...KNOWN_PARAMS].join(", ")}.`,
      400,
    );
  }
  const key = (url.searchParams.get("market") ?? "BTC").toUpperCase();
  const tier = Number(url.searchParams.get("tier") ?? 0);
  const spotRaw = url.searchParams.get("spot");
  // Two names, never one guessed. `stake` is whole STRK, `stakeUnits` is the raw integer.
  // Inferring the unit from whether the string contains a dot made "stake=10" mean ten wei,
  // and a caller who meant ten STRK got a payout twelve wei large with no error anywhere.
  const stakeStrk = url.searchParams.get("stake");
  const stakeUnits = url.searchParams.get("stakeUnits");

  const market = MARKETS.find((m) => m.key === key);
  if (!market) {
    return bad(`molfi does not list ${key}`, 404);
  }
  if (!Number.isInteger(tier) || tier < 0 || tier >= ROUND_SECONDS.length) {
    return bad(`tier must be 0..${ROUND_SECONDS.length - 1}`, 400);
  }
  if (!spotRaw) {
    return bad("spot is required, in the oracle's 8 decimal fixed point", 400);
  }

  if (stakeStrk && stakeUnits) {
    return bad("give either stake (whole STRK) or stakeUnits (raw), not both", 400);
  }

  let spot: bigint;
  let stake: bigint;
  try {
    spot = BigInt(spotRaw);
    stake = stakeUnits ? BigInt(stakeUnits) : parseStrk(stakeStrk ?? "1");
  } catch {
    return bad("spot must be an integer; stake a decimal STRK amount", 400);
  }
  if (spot <= 0n) return bad("spot must be positive", 400);
  if (stake <= 0n) return bad("stake must be positive", 400);

  const window = sellableHalfWidths(market, tier, spot);

  // A band may be given three ways, and all three are the same band: as two prices, as a
  // symmetric half-width in the kernel's units, or as a percentage. Accepting only one of
  // them pushes the conversion into every caller, which is where it goes wrong.
  const widthRaw = url.searchParams.get("halfWidth");
  const pctRaw = url.searchParams.get("halfWidthPct");
  let low: bigint;
  let high: bigint;
  try {
    if (url.searchParams.get("low") && url.searchParams.get("high")) {
      low = BigInt(url.searchParams.get("low")!);
      high = BigInt(url.searchParams.get("high")!);
    } else if (widthRaw || pctRaw) {
      const width = widthRaw
        ? BigInt(widthRaw)
        : BigInt(Math.round(Number(pctRaw) * 1_000_000));
      const half = (spot * width) / 100_000_000n;
      low = spot - half;
      high = spot + half;
    } else {
      return bad("give either low and high, or halfWidth, or halfWidthPct", 400);
    }
  } catch {
    return bad("the band could not be read as numbers", 400);
  }

  const q = quoteBand(market, tier, spot, low, high, stake);

  return NextResponse.json(
    {
      market: market.key,
      pair: market.label,
      tier,
      roundSeconds: ROUND_SECONDS[tier],
      spot: spot.toString(),
      low: low.toString(),
      high: high.toString(),
      /** Raw token units, always. The `stake` parameter is whole STRK; this is not. */
      stakeUnits: stake.toString(),
      ...(q.ok
        ? {
            ok: true,
            multiplierBps: q.multiplierBps.toString(),
            prob1e6: q.prob1e6.toString(),
            payoutUnits: q.payout.toString(),
          }
        : {
            ok: false,
            // Named, not collapsed into a null. The four refusals need four different
            // responses from a caller: recalibrate, move the band, widen it, narrow it.
            refusal: q.error.kind,
            detail: q.error.detail,
          }),
      window: window
        ? {
            minHalfWidth: window.minHalfWidth1e4.toString(),
            maxHalfWidth: window.maxHalfWidth1e4.toString(),
            minHalfWidthPct: Number(window.minHalfWidth1e4) / 1e6,
            maxHalfWidthPct: Number(window.maxHalfWidth1e4) / 1e6,
          }
        : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

const bad = (error: string, status: number) =>
  NextResponse.json({ ok: false, error }, { status, headers: { "cache-control": "no-store" } });
