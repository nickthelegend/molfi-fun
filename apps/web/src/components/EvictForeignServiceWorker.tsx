"use client";

import { useEffect } from "react";

/**
 * Evict any service worker on this origin, because XORR installs none.
 *
 * A service worker is scoped to an origin, not to a project, and `localhost:3000` is
 * the most contended origin in existence. Anything else the viewer has ever run on that
 * port can leave one behind, and it then intercepts XORR's requests forever — including
 * `/_next/static/*`, which means the chunks never arrive, React never hydrates, and the
 * console renders its server-side markup with every control dead. The failure is
 * completely silent: the page looks like it is loading a price, and no error appears
 * anywhere except a handful of ERR_FAILED lines with no URL attached.
 *
 * That is not hypothetical. It happened during development on this machine and cost an
 * hour to find, because every direct check said the server was fine — curl fetched the
 * chunks, the API answered from inside the page, and only the static path failed.
 *
 * Since this app registers no worker and needs none, any worker present is foreign by
 * definition and safe to remove. The caches go with it: a stale worker's cache can keep
 * serving another app's asset for a matching URL long after the worker is gone.
 */
export function EvictForeignServiceWorker() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    void (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        if (regs.length === 0) return;

        await Promise.all(regs.map((r) => r.unregister()));
        if (typeof caches !== "undefined") {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }

        // A worker only stops controlling the page that is already loaded on the next
        // navigation, so the eviction has not taken effect until we reload. Reload once
        // and only once — a worker that reinstalls itself would otherwise loop the page.
        if (navigator.serviceWorker.controller && !sessionStorage.getItem("xorr.sw-evicted")) {
          sessionStorage.setItem("xorr.sw-evicted", "1");
          location.reload();
        }
      } catch {
        // Storage or the SW API can be unavailable in a locked-down context. Nothing
        // here is required for the app to work when no foreign worker exists.
      }
    })();
  }, []);

  return null;
}
