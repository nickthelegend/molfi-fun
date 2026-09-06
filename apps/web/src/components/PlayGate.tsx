"use client";

import { PrivyGate } from "@/components/PrivyGate";
import { PlayScreen } from "@/components/PlayScreen";

/**
 * The console, behind the wallet.
 *
 * A thin client component rather than logic in the route, because `PrivyProvider` is a
 * context and the page itself is a server component. Keeping the boundary here means the
 * route stays static and the provider only mounts for the one screen that needs it.
 */
export function PlayGate() {
  return <PrivyGate>{(wallet) => <PlayScreen wallet={wallet} />}</PrivyGate>;
}
