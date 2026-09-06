/** GENERATED — do not edit by hand. Produced by `pnpm calibrate` from real tape.
 *
 *  Distributions are MEASURED per round length, not assumed normal. Over fifteen
 *  minutes an asset finishes very close to where it started far more often than a
 *  normal allows, and carries fatter tails than it allows too, so a normal misprices
 *  both ends of every band.
 *
 *  Generated: 2026-09-06T14:44:44.101Z
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

export const GENERATED_AT = "2026-09-06T14:44:44.101Z";
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
        sigma1e4: 167242n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 298760n, 513761n, 664728n, 765900n, 834775n, 880702n, 912188n, 934713n, 950446n, 962311n, 970627n, 977176n, 981951n, 985366n, 988087n, 990382n],
      },
      {
        seconds: 3600,
        sigma1e4: 330372n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 289819n, 501438n, 655038n, 758174n, 827784n, 875815n, 908936n, 932127n, 948369n, 960905n, 969774n, 976867n, 981760n, 985437n, 987869n, 990041n],
      },
      {
        seconds: 14400,
        sigma1e4: 646581n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 283005n, 487693n, 631951n, 738341n, 814298n, 868320n, 904940n, 927968n, 945031n, 957183n, 966802n, 974304n, 980278n, 984609n, 988177n, 990565n],
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
        sigma1e4: 222150n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 304249n, 527449n, 678522n, 778720n, 843197n, 885882n, 916375n, 937308n, 951903n, 962813n, 970810n, 976935n, 981643n, 985125n, 987653n, 989466n],
      },
      {
        seconds: 3600,
        sigma1e4: 443939n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 303233n, 524783n, 675323n, 777060n, 842000n, 885717n, 916387n, 936779n, 951158n, 961774n, 970305n, 976636n, 981094n, 984655n, 987358n, 989211n],
      },
      {
        seconds: 14400,
        sigma1e4: 875841n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 299720n, 511959n, 654853n, 753983n, 823511n, 873511n, 908092n, 932144n, 947815n, 959271n, 967024n, 972225n, 976701n, 980713n, 984609n, 987713n],
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
        sigma1e4: 377148n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 330999n, 421184n, 506478n, 793257n, 819013n, 844181n, 905310n, 941571n, 948276n, 962774n, 974475n, 979328n, 984402n, 986601n, 990218n, 992630n],
      },
      {
        seconds: 3600,
        sigma1e4: 692480n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 224638n, 475227n, 583362n, 740089n, 797780n, 868191n, 904922n, 930979n, 947732n, 963559n, 970614n, 980979n, 983575n, 988786n, 991006n, 993341n],
      },
      {
        seconds: 14400,
        sigma1e4: 1308176n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 221278n, 424652n, 580443n, 697602n, 784890n, 848318n, 890884n, 920766n, 942372n, 959503n, 970476n, 979060n, 984928n, 989201n, 992749n, 995756n],
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
  },
];
