/**
 * Generates the parity vectors the Cairo library is checked against.
 *
 * The vectors come from here, from the kernel that the desk quotes with, and are pasted into
 * `cairo/tests/test_parity.cairo`. Writing them by hand on the Cairo side would only prove
 * that both sides agree with my arithmetic, which is not the property anyone cares about.
 *
 * Run: pnpm --filter @molfi/sdk parity
 */

import {
  NORMAL_TABLE,
  halfProb,
  payoutFor,
  probInside,
  quote,
  sqrt,
} from "../src/pricing.ts";
import { CALIBRATED_MARKETS } from "../src/generated/markets.ts";

const line = (...xs: (bigint | number)[]) => `(${xs.map((x) => `${x}`).join(", ")})`;

console.log("// sqrt");
const sqrtCases = [0n, 1n, 2n, 3n, 4n, 8n, 9n, 15n, 16n, 99n, 100n, 10_001n, 1_000_000n,
  100_000_000n, 123_456_789n, 999_999_999_999n];
console.log(sqrtCases.map((x) => line(x, sqrt(x))).join(", "));

console.log("\n// half_prob");
const zs = [0n, 2_500n, 5_000n, 3_750n, 10_000n, 20_000n, 39_999n, 40_000n, 100_000n];
console.log(zs.map((z) => line(z, halfProb(NORMAL_TABLE, z))).join(", "));

console.log("\n// prob_inside (spot, low, high, sigma, prob)");
const probCases: Array<[bigint, bigint, bigint, bigint]> = [
  [100_000n, 99_000n, 101_000n, 500_000n],
  [100_000n, 95_000n, 105_000n, 500_000n],
  [100_000n, 90_000n, 110_000n, 500_000n],
  [50_000n, 49_500n, 50_500n, 250_000n],
];
console.log(
  probCases
    .map(([s, l, h, g]) => line(s, l, h, g, probInside(NORMAL_TABLE, s, l, h, g)))
    .join(", "),
);

console.log("\n// quote (spot, low, high, sigma, edge, multiplierBps)");
const quoteCases: Array<[bigint, bigint, bigint, bigint, bigint]> = [
  [100_000n, 99_000n, 101_000n, 500_000n, 300n],
  [100_000n, 95_000n, 105_000n, 500_000n, 300n],
  [100_000n, 90_000n, 110_000n, 500_000n, 0n],
];
console.log(
  quoteCases
    .map(([s, l, h, g, e]) => line(s, l, h, g, e, quote(NORMAL_TABLE, s, l, h, g, e).multiplierBps))
    .join(", "),
);

console.log("\n// payout (stake, multiplierBps, payout)");
const payCases: Array<[bigint, bigint]> = [
  [1_000n, 20_000n], [1_000n, 10_000n], [3n, 15_000n], [7n, 33_333n], [1_000_000n, 623_393n],
];
console.log(payCases.map(([s, m]) => line(s, m, payoutFor(s, m))).join(", "));

/**
 * The vector that matters most: the shipped BTC 15m calibration, priced by the kernel.
 *
 * Everything above is checked against the normal table, which is a fixture. Production never
 * quotes with it — the contract carries the measured table for each market — so a parity
 * suite that only exercises the normal one proves the two implementations agree about a table
 * neither of them uses. These are the numbers a real quote is made of.
 */
const btc = CALIBRATED_MARKETS.find((m) => m.key === "BTC");
const btc15m = btc?.rounds[0];
if (!btc15m) throw new Error("BTC 15m calibration missing — regenerate the tables first");

console.log("\n// calibrated quote, BTC 15m (halfWidth, prob1e6, multiplierBps)");
console.log(`// sigma_1e4 = ${btc15m.sigma1e4}`);
const spot = 11_000_000_000_000n; // $110,000 at Pragma's 8 decimals
console.log(
  [10n, 25n, 50n, 100n, 200n]
    .map((bps) => {
      const half = (spot * bps) / 10_000n;
      const q = quote(btc15m.probTable, spot, spot - half, spot + half, btc15m.sigma1e4, 400n);
      return line(half, q.prob1e6, q.multiplierBps);
    })
    .join(", "),
);
console.log(`// spot = ${spot}, table = [${btc15m.probTable.join(", ")}]`);
