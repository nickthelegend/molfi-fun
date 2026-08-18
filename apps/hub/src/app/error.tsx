"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * The page that runs when a page throws.
 *
 * Without this, one bad render on any route replaces the whole site with the framework's
 * default screen, which in production is a blank page and the word "error". A hub whose
 * argument is that you should be able to verify things yourself cannot answer a failure with
 * nothing, so this says what broke, offers the two useful moves, and prints the digest that
 * makes the failure findable in a log.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[hub] route error", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6">
      <p className="font-mono text-sm text-[var(--text-mute)]">Something broke</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">
        This page failed to render
      </h1>
      <p className="mt-4 text-[var(--text-dim)]">
        Most pages here read live data from a Starknet node and from the game servers, so the
        usual cause is one of those not answering. Trying again is worth doing before anything
        else.
      </p>

      {error.digest && (
        <p className="mt-6 font-mono text-xs text-[var(--text-mute)]">
          Reference: {error.digest}
        </p>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="fluid rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-[var(--accent)]"
        >
          Try again
        </button>
        <Link
          href="/"
          className="fluid rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm text-[var(--text-dim)] no-underline hover:border-[var(--line-2)] hover:text-[var(--text)]"
        >
          Back to molfi.fun
        </Link>
      </div>
    </main>
  );
}
