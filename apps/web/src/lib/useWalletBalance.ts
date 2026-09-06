"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "./fetchJson";

/**
 * What the connected wallet actually holds, polled off the chain.
 *
 * Three states, and keeping them apart is the whole job. `null` means not read yet, a bigint
 * means read, and `error` means the read failed — a wallet holding nothing and a wallet nobody
 * could reach must never render the same, because "0.000 STRK" on a screen where the number is
 * unknown is the most confident kind of lie a desk can tell.
 */
export interface WalletBalance {
  /** Raw units. Null until the first successful read. */
  balance: bigint | null;
  error: string | null;
  /** True while a read is in flight and nothing has landed yet. */
  loading: boolean;
  refresh: () => void;
}

const POLL_MS = 15_000;

export function useWalletBalance(address: string | null | undefined): WalletBalance {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const read = useCallback(async () => {
    if (!address || address === "0x0") return;
    try {
      const d = await fetchJson<{ balance: string }>(
        `/api/balance?address=${encodeURIComponent(address)}`,
      );
      if (!alive.current) return;
      setBalance(BigInt(d.balance));
      setError(null);
    } catch (e) {
      if (!alive.current) return;
      // The route's own sentence. It names itself, so the deck can print it verbatim.
      setError((e as Error).message);
    }
  }, [address]);

  useEffect(() => {
    alive.current = true;
    void read();
    const id = setInterval(() => void read(), POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [read]);

  return { balance, error, loading: balance === null && error === null, refresh: () => void read() };
}
