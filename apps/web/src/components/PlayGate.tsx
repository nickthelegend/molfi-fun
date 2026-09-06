"use client";

import { PrivyGate } from "@/components/PrivyGate";
import { LiveConsole } from "@/components/LiveConsole";

/**
 * The console, behind the wallet.
 *
 * A thin client component rather than logic in the route, because `PrivyProvider` is a
 * context and the page itself is a server component. Keeping the boundary here means the
 * route stays static and the provider only mounts for the one screen that needs it.
 *
 * It opens straight onto the live desk. There used to be a paper one in front of it — a demo
 * that played with imaginary money and put a GO LIVE key between a visitor and the product.
 * That made sense when reaching the real desk meant installing an extension and finding
 * testnet STRK. It does not now: the gate behind this hands over an account that is already
 * funded and already deployed, so the first thing anyone sees is the real thing, priced by
 * the real contract, settling on a real chain.
 */
export function PlayGate() {
  return <PrivyGate>{(wallet, signer) => <LiveConsole wallet={wallet} signer={signer} />}</PrivyGate>;
}
