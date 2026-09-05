/**
 * Shared protocol facts.
 *
 * Pool and token addresses belong in code rather than app config: they are the same for
 * everyone talking to the same chain, and an app that reads them from an env file can be
 * pointed at the wrong pool by a typo nobody notices until settlement.
 */

export * from "./networks.ts";
