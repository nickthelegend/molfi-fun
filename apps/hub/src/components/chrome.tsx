import Link from "next/link";

/**
 * The header and footer every hub page shares.
 *
 * Before this, each page carried its own nav markup and they had already drifted. Chrome is
 * exactly the kind of thing that should be written once: it is the part of the page a visitor
 * uses to work out whether two URLs belong to the same product, and it fails at that job the
 * moment two of them disagree.
 */

const NAV: Array<{ href: string; label: string }> = [
  { href: "/crewkill", label: "CrewKill" },
  { href: "/poker", label: "Poker" },
  { href: "/contracts", label: "Contracts" },
  { href: "/deployments", label: "Deployments" },
];

export function SiteHeader({ current }: { current?: string }) {
  return (
    <nav aria-label="Primary" className="sticky top-0 z-50 bg-black/80 backdrop-blur-xl">
      {/* Wraps rather than pushing the page wide.

          Four nav items and the wordmark do not fit on one 380px line, and adding the fourth
          made every hub page scroll sideways by 38px. A second line on a phone is ordinary;
          a horizontally scrolling page is not. */}
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
              style={{
                color: current === item.href ? "var(--text)" : "var(--text-dim)",
              }}
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
          <div className="max-w-[340px]">
            <p className="text-base font-semibold tracking-tight">
              molfi<span className="text-[var(--accent)]">.fun</span>
            </p>
            <p className="mt-2 text-sm text-[var(--text-dim)]">
              Staked games where privacy is the mechanic. Running on Starknet Sepolia, with
              test funds, so you can check the whole thing before it costs anything.
            </p>
          </div>

          <div className="flex gap-12">
            <div>
              <p className="text-xs font-medium tracking-wide text-[var(--text-mute)] uppercase">
                Games
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                <li>
                  <Link href="/crewkill" className="text-[var(--text-dim)] no-underline hover:text-[var(--text)]">
                    CrewKill
                  </Link>
                </li>
                <li>
                  <Link href="/poker" className="text-[var(--text-dim)] no-underline hover:text-[var(--text)]">
                    Poker
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
                  <Link href="/contracts" className="text-[var(--text-dim)] no-underline hover:text-[var(--text)]">
                    Contracts
                  </Link>
                </li>
                <li>
                  <Link href="/deployments" className="text-[var(--text-dim)] no-underline hover:text-[var(--text)]">
                    Deployments
                  </Link>
                </li>
                <li>
                  <Link href="/how-privacy-works" className="text-[var(--text-dim)] no-underline hover:text-[var(--text)]">
                    How privacy works
                  </Link>
                </li>
                <li>
                  <Link href="/balance" className="text-[var(--text-dim)] no-underline hover:text-[var(--text)]">
                    Balance
                  </Link>
                </li>
                <li>
                  <Link href="/press" className="text-[var(--text-dim)] no-underline hover:text-[var(--text)]">
                    Press kit
                  </Link>
                </li>
                <li>
                  <Link href="/status" className="text-[var(--text-dim)] no-underline hover:text-[var(--text)]">
                    Status
                  </Link>
                </li>
                <li>
                  <Link href="/changelog" className="text-[var(--text-dim)] no-underline hover:text-[var(--text)]">
                    Changelog
                  </Link>
                </li>
                <li>
                  <Link href="/api-docs" className="text-[var(--text-dim)] no-underline hover:text-[var(--text)]">
                    API
                  </Link>
                </li>
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
