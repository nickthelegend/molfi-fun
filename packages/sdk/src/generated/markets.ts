/** GENERATED — do not edit by hand. Produced by `pnpm calibrate` from real tape.
 *
 *  **BTC, ETH and STRK carry their originally published tables, not the latest fit.**
 *  Recalibrating them is not a free improvement: forty-nine markets are already listed on
 *  chain against the old numbers, and `create_market` stores the table it was given. Publish
 *  a different one and every one of those markets fails the audit that says "the table the
 *  contract prices with is the one molfi published" — which is the check that makes the
 *  published calibration mean anything. It failed exactly that way when WBTC was first added
 *  and all four pairs were refit at once. A new pair may be added; an existing pair's table
 *  changes only when a new contract is deployed to be listed against it.
 *
 *  Distributions are MEASURED per round length, not assumed normal. Over fifteen
 *  minutes an asset finishes very close to where it started far more often than a
 *  normal allows, and carries fatter tails than it allows too, so a normal misprices
 *  both ends of every band.
 *
 *  Generated: 2026-09-05T14:26:47.716Z
 */

export interface CalibratedRound {
  /** Round length in seconds. Not blocks: the constraint is the oracle, not the chain. */
  seconds: number;
  /** Move size over the round, as a fraction of spot times 1e8. */
  sigma1e4: bigint;
  /** Tightest band the desk will sell, as a probability. Below this the quote runs away. */
  minProb1e6: bigint;
  /** What that tightest band pays, so the ceiling is the floor's exact partner. */
  maxMultiplierBps: bigint;
  /** T(z) = P(|move| <= z*sigma) on z = 0, 0.25 .. 4.00, in 1e6 fixed point. */
  probTable: readonly bigint[];
}

export interface CalibratedMarket {
  key: string;
  /** The Pragma pair label, and the short string the oracle is keyed by. */
  label: string;
  /** Where the tape came from. Calibration only — settlement is always Pragma. */
  source: string;
  live: boolean;
  rounds: CalibratedRound[];
}

export const GENERATED_AT = "2026-09-05T14:26:47.716Z";
export const HOUSE_EDGE_BPS = 400n;
export const SIGMA_SHADE = 0.9;
export const ROUND_SECONDS = [900, 3600, 14400] as const;
export const ROUND_KEYS = ["15m", "1h", "4h"] as const;

export const CALIBRATED_MARKETS: CalibratedMarket[] = [
  {
    key: "BTC",
    label: "BTC/USD",
    source: "binance:BTCUSDT 1m",
    live: true,
    rounds: [
      {
        seconds: 900,
        sigma1e4: 171077n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 300323n, 515844n, 666532n, 767462n, 836637n, 881841n, 912690n, 935108n, 950822n, 962639n, 971041n, 977620n, 982135n, 985386n, 988415n, 990440n],
      },
      {
        seconds: 3600,
        sigma1e4: 336666n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 291160n, 502644n, 655308n, 758541n, 828228n, 876259n, 909583n, 932928n, 948967n, 961446n, 970208n, 976684n, 981664n, 985080n, 987657n, 989761n],
      },
      {
        seconds: 14400,
        sigma1e4: 655862n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 284029n, 487800n, 632937n, 739753n, 815565n, 868658n, 904341n, 927900n, 944789n, 956922n, 966077n, 973792n, 979747n, 984116n, 987722n, 990236n],
      },
    ],
  },
  {
    key: "ETH",
    label: "ETH/USD",
    source: "binance:ETHUSDT 1m",
    live: true,
    rounds: [
      {
        seconds: 900,
        sigma1e4: 227000n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 306294n, 529754n, 680451n, 779260n, 844123n, 886963n, 917349n, 937607n, 952462n, 963450n, 971321n, 977369n, 981874n, 985472n, 987884n, 989678n],
      },
      {
        seconds: 3600,
        sigma1e4: 453275n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 304854n, 526337n, 676250n, 778074n, 842318n, 885756n, 916242n, 936460n, 950753n, 961803n, 970517n, 976655n, 981287n, 984771n, 987367n, 989018n],
      },
      {
        seconds: 14400,
        sigma1e4: 894046n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 301556n, 513805n, 657386n, 755162n, 824304n, 873966n, 908710n, 932164n, 947506n, 958643n, 966019n, 971152n, 975725n, 980143n, 984474n, 987355n],
      },
    ],
  },
  {
    key: "STRK",
    label: "STRK/USD",
    source: "binance:STRKUSDT 1m",
    live: true,
    rounds: [
      {
        seconds: 900,
        sigma1e4: 383219n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 328636n, 415444n, 510838n, 790334n, 816910n, 847268n, 909005n, 939420n, 949163n, 962977n, 974948n, 979675n, 984209n, 987035n, 990411n, 992428n],
      },
      {
        seconds: 3600,
        sigma1e4: 704113n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 225613n, 497443n, 580390n, 746420n, 806833n, 870025n, 903503n, 931760n, 946796n, 965373n, 970141n, 980689n, 983439n, 988574n, 990938n, 992810n],
      },
      {
        seconds: 14400,
        sigma1e4: 1325026n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 229930n, 429109n, 580114n, 695398n, 782492n, 845621n, 889859n, 922399n, 942817n, 959223n, 970621n, 979389n, 985509n, 990149n, 993668n, 996210n],
      },
    ],
  },
  {
    key: "WBTC",
    label: "WBTC/USD",
    source: "binance:WBTCUSDT 1m",
    live: true,
    rounds: [
      {
        seconds: 900,
        sigma1e4: 168572n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 294825n, 510056n, 660705n, 763691n, 831679n, 879294n, 911995n, 934076n, 950166n, 962109n, 970559n, 976974n, 982067n, 985752n, 988405n, 990595n],
      },
      {
        seconds: 3600,
        sigma1e4: 330753n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 287165n, 499344n, 652635n, 756910n, 826906n, 875642n, 908271n, 931973n, 948794n, 961050n, 970083n, 977022n, 981866n, 985389n, 987869n, 990253n],
      },
      {
        seconds: 14400,
        sigma1e4: 645638n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 283701n, 486118n, 631448n, 739588n, 815139n, 868291n, 904167n, 927968n, 944963n, 957260n, 966589n, 974314n, 980124n, 984484n, 988235n, 990632n],
      },
    ],
  }
];
