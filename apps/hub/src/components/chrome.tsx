import Link from "next/link";

/**
 * The header and footer every page shares.
 *
 * Written once, because chrome is the part a visitor uses to work out whether two URLs
 * belong to the same product, and it fails at that the moment two copies disagree.
 */

/**
 * Only routes that exist.
 *
 * The nav shipped pointing at three pages that had not been built, so every link on the site
 * 404'd. A nav is a promise about what is there; entries get added here as the pages land,
 * not in anticipation of them.
 */
const NAV: Array<{ href: string; label: string }> = [
  { href: "/how-it-works", label: "How it works" },
];

export function SiteHeader({ current }: { current?: string }) {
  return (
    <nav aria-label="Primary" className="sticky top-0 z-50 bg-black/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-6 py-3">
        <Link href="/" className="text-base font-semibold tracking-tight no-underline">
          molfi<span className="text-[var(--accent)]">.fun</span>
        </Link>

        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 sm:gap-x-4">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={current === item.href ? "page" : undefined}
              className="fluid rounded-lg px-2 py-1.5 text-sm no-underline"
              style={{ color: current === item.href ? "var(--text)" : "var(--text-dim)" }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--line)]">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="max-w-[360px]">
            <p className="text-base font-semibold tracking-tight">
              molfi<span className="text-[var(--accent)]">.fun</span>
            </p>
            <p className="mt-2 text-sm text-[var(--text-dim)]">
              Prediction markets where your position is private until it settles. Running on
              Starknet Sepolia with test funds, so you can check the whole thing before it
              costs anything.
            </p>
          </div>

          <div className="flex gap-12">
            <div>
              <p className="text-xs font-medium tracking-wide text-[var(--text-mute)] uppercase">
                Trade
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                <li>
                  <Link href="/how-it-works" className="text-[var(--text-dim)] no-underline hover:text-[var(--text)]">
                    How it works
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-medium tracking-wide text-[var(--text-mute)] uppercase">
                Project
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                <li>
                  <Link href="/privacy" className="text-[var(--text-dim)] no-underline hover:text-[var(--text)]">
                    Privacy
                  </Link>
                </li>
                <li>
                  <Link href="/terms" className="text-[var(--text-dim)] no-underline hover:text-[var(--text)]">
                    Terms
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <p className="mt-10 text-xs text-[var(--text-mute)]">
          Testnet only. Nothing here takes real money.
        </p>
      </div>
    </footer>
  );
}
