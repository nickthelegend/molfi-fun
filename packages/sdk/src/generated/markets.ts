/** GENERATED — do not edit by hand. Produced by `pnpm calibrate` from real tape.
 *
 *  Tables for pairs already listed on chain are COPIED THROUGH unchanged — see FROZEN in
 *  run-calibrate.ts. Re-running this is safe: it can add a pair, it cannot move a
 *  published one out from under the markets already priced against it.
 *
 *  Distributions are MEASURED per round length, not assumed normal. Over fifteen
 *  minutes an asset finishes very close to where it started far more often than a
 *  normal allows, and carries fatter tails than it allows too, so a normal misprices
 *  both ends of every band.
 *
 *  Generated: 2026-09-06T22:41:03.167Z
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
  /** Where the tape came from. Calibration only — never a settlement price. */
  source: string;
  /**
   * Which oracle settles this market.
   *
   * "pragma" is Pragma mainnet's own median, read straight off their aggregator.
   * "molfi" is molfi's median across five independent exchanges, relayed on chain with
   * the true number that answered. Both clear the contract's three-publisher floor; they
   * are not the same trust assumption and the UI says which is which.
   */
  settle: "pragma" | "molfi";
  live: boolean;
  rounds: CalibratedRound[];
}

export const GENERATED_AT = "2026-09-06T22:41:03.167Z";
export const HOUSE_EDGE_BPS = 400n;
export const SIGMA_SHADE = 0.9;
export const ROUND_SECONDS = [900, 3600, 14400] as const;
export const ROUND_KEYS = ["15m", "1h", "4h"] as const;

export const CALIBRATED_MARKETS: CalibratedMarket[] = [
  {
    key: "BTC",
    label: "BTC/USD",
    source: "binance:BTCUSDT 1m",
    settle: "pragma",
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
    settle: "pragma",
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
    settle: "pragma",
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
    settle: "pragma",
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
  {
    key: "SOL",
    label: "SOL/USD",
    source: "binance:SOLUSDT 1m",
    settle: "molfi",
    live: true,
    rounds: [
      {
        seconds: 900,
        sigma1e4: 255675n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 270795n, 504085n, 662885n, 765842n, 835615n, 881995n, 913548n, 934993n, 950620n, 961684n, 970154n, 976385n, 980939n, 984865n, 987778n, 989919n],
      },
      {
        seconds: 3600,
        sigma1e4: 515970n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 275246n, 497558n, 657170n, 764437n, 835119n, 880255n, 913221n, 935370n, 950762n, 961783n, 970401n, 976337n, 981191n, 985003n, 988004n, 990282n],
      },
      {
        seconds: 14400,
        sigma1e4: 1000137n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 274942n, 491435n, 643590n, 745949n, 820611n, 869731n, 904466n, 927349n, 944519n, 957821n, 967943n, 974623n, 979505n, 983546n, 986930n, 989559n],
      },
    ],
  },
  {
    key: "XRP",
    label: "XRP/USD",
    source: "binance:XRPUSDT 1m",
    settle: "molfi",
    live: true,
    rounds: [
      {
        seconds: 900,
        sigma1e4: 215337n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 269329n, 488854n, 647094n, 753099n, 826856n, 875715n, 909806n, 933295n, 950330n, 962649n, 972054n, 978855n, 983370n, 986890n, 989360n, 991241n],
      },
      {
        seconds: 3600,
        sigma1e4: 435511n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 266078n, 482860n, 642231n, 754044n, 828518n, 877292n, 910741n, 934395n, 951332n, 963279n, 972003n, 978421n, 983497n, 987251n, 989983n, 991845n],
      },
      {
        seconds: 14400,
        sigma1e4: 858459n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 282860n, 494548n, 640062n, 743871n, 815632n, 864956n, 903761n, 931593n, 949285n, 961321n, 969925n, 976344n, 981555n, 985625n, 988515n, 990294n],
      },
    ],
  },
  {
    key: "DOGE",
    label: "DOGE/USD",
    source: "binance:DOGEUSDT 1m",
    settle: "molfi",
    live: true,
    rounds: [
      {
        seconds: 900,
        sigma1e4: 231680n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 285265n, 498384n, 653412n, 760353n, 832007n, 881812n, 913992n, 936449n, 952810n, 964260n, 972102n, 978151n, 982656n, 986061n, 988800n, 990942n],
      },
      {
        seconds: 3600,
        sigma1e4: 460332n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 284607n, 501187n, 652451n, 755607n, 828315n, 876086n, 908946n, 931847n, 948552n, 960712n, 969900n, 976346n, 981152n, 985350n, 988361n, 990523n],
      },
      {
        seconds: 14400,
        sigma1e4: 885163n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 260683n, 478809n, 634078n, 733855n, 803210n, 856410n, 895630n, 923057n, 943020n, 958855n, 969809n, 977939n, 983749n, 987307n, 989637n, 991531n],
      },
    ],
  },
  {
    key: "LINK",
    label: "LINK/USD",
    source: "binance:LINKUSDT 1m",
    settle: "molfi",
    live: true,
    rounds: [
      {
        seconds: 900,
        sigma1e4: 257440n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 257531n, 466262n, 626576n, 742546n, 822708n, 875966n, 911947n, 936449n, 953494n, 964839n, 973154n, 979260n, 983939n, 987132n, 989370n, 991386n],
      },
      {
        seconds: 3600,
        sigma1e4: 523211n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 245474n, 460674n, 629917n, 748784n, 826105n, 876452n, 909988n, 933893n, 951100n, 963752n, 972361n, 978788n, 983488n, 987001n, 990002n, 992241n],
      },
      {
        seconds: 14400,
        sigma1e4: 1011550n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 243823n, 450696n, 609213n, 724459n, 808536n, 863273n, 902823n, 931274n, 950087n, 963960n, 973492n, 980327n, 984948n, 987993n, 991299n, 993233n],
      },
    ],
  },
  {
    key: "AVAX",
    label: "AVAX/USD",
    source: "binance:AVAXUSDT 1m",
    settle: "molfi",
    live: true,
    rounds: [
      {
        seconds: 900,
        sigma1e4: 306531n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 277529n, 504442n, 664303n, 772334n, 842030n, 888429n, 919066n, 940047n, 954845n, 964858n, 972353n, 978267n, 982820n, 985955n, 988463n, 990209n],
      },
      {
        seconds: 3600,
        sigma1e4: 619268n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 274484n, 499093n, 656505n, 763289n, 835621n, 884984n, 917709n, 938352n, 952557n, 963250n, 970942n, 976530n, 980554n, 983980n, 986615n, 988699n],
      },
      {
        seconds: 14400,
        sigma1e4: 1220923n,
        minProb1e6: 120000n,
        maxMultiplierBps: 79999n,
        probTable: [0n, 281313n, 496916n, 649758n, 750319n, 816628n, 862703n, 896510n, 921558n, 939820n, 952601n, 961678n, 968919n, 975899n, 981603n, 987249n, 991589n],
      },
    ],
  },
];
