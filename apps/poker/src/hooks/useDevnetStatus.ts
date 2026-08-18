import { useState, useEffect } from 'react';

/**
 * Polls a local devnet to see whether it is up.
 *
 * Pass null to switch it off. The obvious way to disable a polling hook is to hand it a URL
 * that goes nowhere, and this was called with the literal string 'about:blank' on every
 * network except devnet. That does not disable anything: the hook kept running and kept
 * POSTing to a scheme fetch cannot load, once every five seconds for as long as the tab was
 * open, filling the console with failures that looked like the app was broken. A disabled
 * poller has to actually not poll.
 */
export function useDevnetStatus(url: string | null) {
  const [isAlive, setIsAlive] = useState(false);
  const [checking, setChecking] = useState(url !== null);

  useEffect(() => {
    if (url === null) {
      // Not applicable rather than dead. Nothing is polled and nothing is claimed.
      setIsAlive(false);
      setChecking(false);
      return;
    }

    let cancelled = false;

    async function check() {
      try {
        const res = await fetch(url as string, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'starknet_chainId', params: [], id: 1 }),
        });
        if (!cancelled) setIsAlive(res.ok);
      } catch {
        if (!cancelled) setIsAlive(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    check();
    const interval = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [url]);

  return { isAlive, checking };
}
