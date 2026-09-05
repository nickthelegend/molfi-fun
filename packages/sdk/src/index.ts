/**
 * The pricing kernel, the oracle adapter, the desk, and the console geometry.
 *
 * Everything numeric here is integer arithmetic on purpose. The desk quotes from these files
 * and the chain quotes from the Cairo mirror of them, so the number a trader sees before they
 * commit is provably the number they get charged — a float anywhere in that path would make
 * the two disagree in the fourth decimal and nobody would notice until a settlement was
 * contested.
 */

export * from "./pricing.ts";
export * from "./pragma.ts";
// Calibration inputs. HOUSE_EDGE_BPS and SIGMA_SHADE stay behind the generated module's
// names: two live constants with the same name would shadow each other, and the one that
// lost would be the one everyone actually quoted with.
export {
  HORIZONS,
  fetchMinuteCloses,
  returnsOver,
  stdev,
  buildTable,
  fitHorizon,
  type Candle,
  type HorizonFit,
} from "./calibrate.ts";
export * from "./markets.ts";
export * from "./quote.ts";
export * from "./engine.ts";
export * from "./format.ts";
export * from "./console-geometry.ts";
export * from "./networks.ts";
export * from "./positions.ts";
export * from "./trade.ts";
export * from "./decode.ts";
export * from "./audit.ts";
