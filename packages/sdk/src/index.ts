/**
 * The pricing kernel and the console geometry.
 *
 * Everything here is integer arithmetic on purpose. The desk quotes from this file and the
 * chain quotes from the Cairo mirror of it, so the number a trader sees before they commit
 * is provably the number they get charged — a float anywhere in that path would make the two
 * disagree in the fourth decimal and nobody would notice until a settlement was contested.
 */

export * from "./pricing.ts";
export * from "./termstructure.ts";
export * from "./engine.ts";
export * from "./markets.ts";
export * from "./format.ts";
export * from "./console-geometry.ts";
export * from "./pragma.ts";
