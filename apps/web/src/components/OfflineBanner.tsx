"use client";

import { useEffect, useState } from "react";

/**
 * Say when the network is gone, because every failure downstream of it looks different.
 *
 * Offline, the desk's own error messages are individually correct and collectively
 * misleading: "no BTC price", "chain unreachable", "book unavailable" read as three
 * separate outages of three separate systems, when the actual fact is one and the
 * reader already knows it. One line at the top costs less attention than three
 * mysteries below.
 *
 * `navigator.onLine` is only trustworthy in one direction — false means definitely no
 * network, true means only that an interface is up — so this drives the banner off the
 * offline/online events rather than treating a true reading as proof of anything.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const down = () => setOffline(true);
    const up = () => setOffline(false);
    if (typeof navigator !== "undefined" && navigator.onLine === false) setOffline(true);
    window.addEventListener("offline", down);
    window.addEventListener("online", up);
    return () => {
      window.removeEventListener("offline", down);
      window.removeEventListener("online", up);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 bg-red px-4 py-2 text-center text-[12px] font-semibold text-white"
    >
      No network. Prices, the book and the chain are all unreachable — the desk will not
      invent any of them, so it shows nothing until you are back.
    </div>
  );
}
