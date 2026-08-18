import { useEffect, useState } from 'react';
import { useAccount } from '@starknet-react/core';
import { NETWORK } from '../config';

/** What the app is pointed at, as a chain id, so it can be compared to the wallet's. */
const EXPECTED_CHAIN_ID: Record<string, { hex: string; label: string }> = {
  sepolia: { hex: '0x534e5f5345504f4c4941', label: 'Starknet Sepolia' },
  mainnet: { hex: '0x534e5f4d41494e', label: 'Starknet Mainnet' },
  devnet: { hex: '0x534e5f5345504f4c4941', label: 'local devnet' },
};

function toHex(value: unknown): string | null {
  if (typeof value === 'bigint') return `0x${value.toString(16)}`;
  if (typeof value === 'number') return `0x${value.toString(16)}`;
  if (typeof value === 'string') return value.startsWith('0x') ? value : `0x${value}`;
  return null;
}

/**
 * Says so when the wallet is on a different chain from the table.
 *
 * This is the single most common way a working app looks broken. The wallet connects, the
 * buttons enable, and then every transaction fails with something from deep inside the
 * provider that mentions neither wallet nor network. The user concludes the game is broken.
 *
 * Devnet is deliberately exempt. A local devnet reports the Sepolia chain id, so comparing
 * ids there would flag a correct setup as wrong, and a banner that cries wolf is worse than
 * no banner at all.
 */
export function NetworkBanner() {
  const { account, isConnected } = useAccount();
  const [walletChain, setWalletChain] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!account) {
      setWalletChain(null);
      return;
    }
    (async () => {
      try {
        // Different connectors expose this differently; ask the account, which every one has.
        const id = await (account as unknown as { getChainId?: () => Promise<unknown> })
          .getChainId?.();
        if (!cancelled) setWalletChain(toHex(id));
      } catch {
        // A wallet that will not answer is not evidence of a mismatch, so this stays quiet
        // rather than guessing.
        if (!cancelled) setWalletChain(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account]);

  if (NETWORK === 'devnet') return null;
  if (!isConnected || !walletChain) return null;

  const expected = EXPECTED_CHAIN_ID[NETWORK];
  if (!expected) return null;
  if (walletChain.toLowerCase() === expected.hex.toLowerCase()) return null;

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-500/30 bg-amber-950/40 px-4 py-2 text-center"
    >
      <span className="text-xs font-semibold uppercase tracking-widest text-amber-400">
        Wrong network
      </span>
      <span className="text-xs text-amber-200/70">
        This table is on {expected.label}. Your wallet is on a different chain, so every action
        will fail until you switch it.
      </span>
      <span className="font-mono text-[10px] text-amber-200/40">
        wallet {walletChain.slice(0, 12)}… · expected {expected.hex.slice(0, 12)}…
      </span>
    </div>
  );
}
