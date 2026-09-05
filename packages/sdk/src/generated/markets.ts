/** GENERATED FILE - do not edit by hand.
 *  Produced by `pnpm calibrate` from real market tape.
 *  Generated: 2026-09-03T02:42:37.375Z
 *
 *  Distributions are MEASURED per round length, not assumed normal.
 */

export interface CalibratedRound {
  blocks: number;
  seconds: number;
  sigma1e4: bigint;
  minProb1e6: bigint;
  maxMultiplierBps: bigint;
  probTable: readonly bigint[];
}

export interface CalibratedMarket {
  key: string;
  label: string;
  marketId: `0x${string}`;
  source: string;
  live: boolean;
  note?: string;
  rounds: CalibratedRound[];
}

export const GENERATED_AT = "2026-09-03T02:42:37.375Z";
export const HOUSE_EDGE_BPS = 400n;
export const ROUND_BLOCKS = [10, 33, 100, 333, 1000, 3000] as const;
export const ROUND_SECONDS = [3, 10, 30, 100, 300, 900] as const;

export const CALIBRATED_MARKETS: CalibratedMarket[] = [
  {
    key: "BTC",
    label: "BTC-USD",
    marketId: "0xb39c402b9bd8428ba7a4cc2d1aca1432756cddeb60941a9175541a819095269e",
    source: "binance:BTCUSDT 1s",
    live: true,
    rounds: [
      {
        blocks: 10,
        seconds: 3,
        sigma1e4: 3573n,
        minProb1e6: 370084n,
        maxMultiplierBps: 25940n,
        probTable: [350084n, 705193n, 753769n, 800670n, 840871n, 871022n, 899497n, 919598n, 938023n, 953099n, 963149n, 973199n, 978224n, 983250n, 986600n, 989950n, 991625n],
      },
      {
        blocks: 33,
        seconds: 10,
        sigma1e4: 11161n,
        minProb1e6: 192881n,
        maxMultiplierBps: 49772n,
        probTable: [172881n, 450847n, 579661n, 684746n, 766102n, 830508n, 877966n, 915254n, 942373n, 959322n, 972881n, 979661n, 986441n, 993220n, 996610n, 1000000n, 1000000n],
      },
      {
        blocks: 100,
        seconds: 30,
        sigma1e4: 21535n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [36585n, 280488n, 463415n, 609756n, 719512n, 804878n, 865854n, 914634n, 951220n, 975610n, 987805n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 333,
        seconds: 100,
        sigma1e4: 39095n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 222222n, 416667n, 583333n, 694444n, 805556n, 861111n, 916667n, 944444n, 972222n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 1000,
        seconds: 300,
        sigma1e4: 78207n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 222222n, 416667n, 583333n, 694444n, 805556n, 861111n, 916667n, 972222n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 3000,
        seconds: 900,
        sigma1e4: 134221n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 166667n, 361111n, 555556n, 694444n, 777778n, 888889n, 944444n, 972222n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
    ],
  },
  {
    key: "ETH",
    label: "ETH-USD",
    marketId: "0x2430f68ea2e8d4151992bb7fc3a4c472087a6149bf7e0232704396162ab7c1f7",
    source: "binance:ETHUSDT 1s",
    live: true,
    rounds: [
      {
        blocks: 10,
        seconds: 3,
        sigma1e4: 5448n,
        minProb1e6: 346633n,
        maxMultiplierBps: 27695n,
        probTable: [326633n, 631491n, 693467n, 758794n, 810720n, 857621n, 892797n, 921273n, 944724n, 959799n, 969849n, 978224n, 983250n, 986600n, 989950n, 991625n, 994975n],
      },
      {
        blocks: 33,
        seconds: 10,
        sigma1e4: 16524n,
        minProb1e6: 135254n,
        maxMultiplierBps: 70978n,
        probTable: [115254n, 362712n, 522034n, 657627n, 752542n, 823729n, 877966n, 918644n, 942373n, 962712n, 976271n, 986441n, 993220n, 996610n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 100,
        seconds: 30,
        sigma1e4: 29511n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [12195n, 256098n, 426829n, 585366n, 707317n, 804878n, 878049n, 914634n, 951220n, 975610n, 987805n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 333,
        seconds: 100,
        sigma1e4: 51540n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 222222n, 388889n, 555556n, 694444n, 777778n, 861111n, 916667n, 944444n, 972222n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 1000,
        seconds: 300,
        sigma1e4: 101222n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 194444n, 416667n, 555556n, 694444n, 805556n, 888889n, 916667n, 972222n, 972222n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 3000,
        seconds: 900,
        sigma1e4: 178456n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 222222n, 416667n, 611111n, 722222n, 805556n, 888889n, 916667n, 972222n, 972222n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
    ],
  },
  {
    key: "MON",
    label: "MON-USD",
    marketId: "0x92bcb7355458a976a0b6be05319d37cc66bc1792624ca67226af747c1de28f62",
    source: "kuru:MON-AUSD (mark only)",
    live: false,
    note: "PAPER ONLY. Kuru MON-AUSD is too thin to calibrate a distribution against (24h volume ~185, no public candle history). Shape borrowed from ETH with a 2.5x sigma; re-mark from real fills before enabling live money.",
    rounds: [
      {
        blocks: 10,
        seconds: 3,
        sigma1e4: 13620n,
        minProb1e6: 346633n,
        maxMultiplierBps: 27695n,
        probTable: [326633n, 631491n, 693467n, 758794n, 810720n, 857621n, 892797n, 921273n, 944724n, 959799n, 969849n, 978224n, 983250n, 986600n, 989950n, 991625n, 994975n],
      },
      {
        blocks: 33,
        seconds: 10,
        sigma1e4: 41310n,
        minProb1e6: 135254n,
        maxMultiplierBps: 70978n,
        probTable: [115254n, 362712n, 522034n, 657627n, 752542n, 823729n, 877966n, 918644n, 942373n, 962712n, 976271n, 986441n, 993220n, 996610n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 100,
        seconds: 30,
        sigma1e4: 73778n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [12195n, 256098n, 426829n, 585366n, 707317n, 804878n, 878049n, 914634n, 951220n, 975610n, 987805n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 333,
        seconds: 100,
        sigma1e4: 128850n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 222222n, 388889n, 555556n, 694444n, 777778n, 861111n, 916667n, 944444n, 972222n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 1000,
        seconds: 300,
        sigma1e4: 253055n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 194444n, 416667n, 555556n, 694444n, 805556n, 888889n, 916667n, 972222n, 972222n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
      {
        blocks: 3000,
        seconds: 900,
        sigma1e4: 446140n,
        minProb1e6: 125000n,
        maxMultiplierBps: 76800n,
        probTable: [0n, 222222n, 416667n, 611111n, 722222n, 805556n, 888889n, 916667n, 972222n, 972222n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n, 1000000n],
      },
    ],
  },
];

export const marketByKey = (k: string) => CALIBRATED_MARKETS.find((m) => m.key === k);
