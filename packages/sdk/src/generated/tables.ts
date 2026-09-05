/** GENERATED — do not edit by hand. Produced by `pnpm calibrate` from real tape.
 *
 *  Distributions are MEASURED per horizon, not assumed normal. Over fifteen minutes an
 *  asset finishes very close to where it started far more often than a normal allows,
 *  and carries fatter tails than it allows too, so a normal misprices both ends.
 *
 *  Generated: 2026-09-05T13:54:47.368Z
 */

import type { Calibration } from "../quote.ts";

export const GENERATED_AT = "2026-09-05T13:54:47.369Z";
export const HOUSE_EDGE_BPS = 400n;
export const SIGMA_SHADE = 0.9;

export const CALIBRATIONS: Calibration[] = [
  {
    marketKey: "btc",
    horizonKey: "5m",
    sigma1e4: 105352n,
    table: [0n, 376733n, 587990n, 720272n, 803183n, 858371n, 894863n, 921864n, 940067n, 954449n, 964202n, 971813n, 977398n, 981942n, 985212n, 987730n, 989929n],
  },
  {
    marketKey: "btc",
    horizonKey: "15m",
    sigma1e4: 178325n,
    table: [0n, 369779n, 580923n, 714633n, 799682n, 855174n, 893299n, 921146n, 940715n, 955015n, 963815n, 970676n, 976060n, 980721n, 984310n, 986887n, 989202n],
  },
  {
    marketKey: "btc",
    horizonKey: "1h",
    sigma1e4: 364340n,
    table: [0n, 351449n, 590232n, 731565n, 809565n, 860029n, 897565n, 925072n, 942696n, 954290n, 963768n, 970174n, 975768n, 980000n, 983826n, 987101n, 989536n],
  },
  {
    marketKey: "btc",
    horizonKey: "4h",
    sigma1e4: 767092n,
    table: [0n, 389452n, 601399n, 725962n, 802739n, 854312n, 889860n, 917424n, 935897n, 948980n, 957809n, 965326n, 969872n, 975058n, 978642n, 981556n, 984645n],
  },
  {
    marketKey: "eth",
    horizonKey: "5m",
    sigma1e4: 145202n,
    table: [0n, 392939n, 618492n, 750456n, 827579n, 878455n, 912314n, 935089n, 951208n, 962408n, 970337n, 976588n, 981421n, 984575n, 987556n, 989437n, 991492n],
  },
  {
    marketKey: "eth",
    horizonKey: "15m",
    sigma1e4: 245666n,
    table: [0n, 397337n, 619598n, 749341n, 827385n, 877435n, 910812n, 934375n, 950557n, 962773n, 970821n, 976610n, 980750n, 984484n, 987176n, 989318n, 990968n],
  },
  {
    marketKey: "eth",
    horizonKey: "1h",
    sigma1e4: 533395n,
    table: [0n, 415652n, 647652n, 776580n, 849391n, 893652n, 925768n, 947391n, 961971n, 972435n, 979768n, 983739n, 986145n, 987739n, 989217n, 990116n, 990957n],
  },
  {
    marketKey: "eth",
    horizonKey: "4h",
    sigma1e4: 1090942n,
    table: [0n, 428904n, 647145n, 771620n, 853992n, 901136n, 926573n, 943124n, 956702n, 964714n, 967745n, 972115n, 976195n, 979633n, 981002n, 982401n, 984120n],
  },
  {
    marketKey: "strk",
    horizonKey: "5m",
    sigma1e4: 251716n,
    table: [0n, 310722n, 537780n, 694632n, 789119n, 858892n, 899609n, 928896n, 947649n, 961655n, 971061n, 977717n, 982926n, 986601n, 989321n, 991434n, 992823n],
  },
  {
    marketKey: "strk",
    horizonKey: "15m",
    sigma1e4: 432054n,
    table: [0n, 287075n, 527283n, 688667n, 786713n, 852222n, 895035n, 923144n, 944681n, 959618n, 969721n, 977363n, 982863n, 986713n, 990071n, 992242n, 993747n],
  },
  {
    marketKey: "strk",
    horizonKey: "1h",
    sigma1e4: 835136n,
    table: [0n, 274319n, 507507n, 670116n, 770812n, 838899n, 883420n, 913942n, 937217n, 953710n, 966493n, 975072n, 981043n, 985188n, 988174n, 990464n, 991826n],
  },
  {
    marketKey: "strk",
    horizonKey: "4h",
    sigma1e4: 1661768n,
    table: [0n, 262821n, 467483n, 612092n, 720425n, 792016n, 846941n, 887179n, 915559n, 935431n, 955216n, 969610n, 976690n, 984411n, 989510n, 993211n, 996358n],
  },
];
