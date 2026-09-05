import Link from "next/link";

// A 404 should say so in the tab, not inherit the home page title.
export const metadata = { title: "Page not found — molfi.fun" };

/**
 * A branded 404 with a way back, rather than the framework's default.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6">
      <p className="font-mono text-sm text-[var(--accent)]">404</p>
      <h1 className="hero-heading mt-4 max-w-[680px] text-5xl font-semibold tracking-tight">Nothing at this address</h1>
      <p className="mt-6 max-w-[680px] text-lg text-[var(--text-dim)]">
        The page you asked for does not exist. The markets do.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/"
          className="fluid rounded-lg bg-white px-3 py-2 text-base font-semibold text-black hover:bg-[var(--accent)]"
        >
          Back to molfi.fun
        </Link>
        <a
          href="/how-it-works"
          className="fluid rounded-lg border border-[var(--line-2)] px-3 py-2 text-base font-semibold text-white hover:bg-[var(--surface)]"
        >Open a position</a>
      </div>
    </main>
  );
}
