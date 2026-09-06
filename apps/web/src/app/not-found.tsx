import Link from "next/link";

/**
 * The 404, in the console's own language.
 *
 * Next's default is a bare white sans-serif line, and it is reachable from a mistyped market
 * id — which is exactly the URL a sceptic hand-edits while checking whether the verifier is
 * real. Landing on unstyled default chrome at that moment says the thing was assembled from
 * a template; every route out of here is a page that answers with chain data.
 */
export const metadata = {
  title: "molfi — no such page",
};

const DOORS = [
  { href: "/", label: "HOME", sub: "the console" },
  { href: "/privacy", label: "PRIVATE", sub: "what leaks" },
  { href: "/verify", label: "VERIFY", sub: "check a position" },
];

export default function NotFound() {
  return (
    <main className="tiled grid min-h-dvh place-items-center px-5">
      <div className="w-full max-w-[420px] rounded-[22px] bg-card p-6">
        <div className="mono flex items-center gap-2 text-[9.5px] tracking-[0.15em] text-dim">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-[1px] bg-red"
            style={{ boxShadow: "0 0 6px rgba(232,69,60,.8)" }}
          />
          NO SUCH PAGE · 404
        </div>

        <h1 className="mt-3 text-[24px] font-extrabold leading-tight tracking-tight">
          That address is not on this console.
        </h1>
        <p className="mt-3 text-[13px] leading-relaxed text-white/55">
          If you were checking a market, the id has to be one this contract actually listed —
          markets are numbered from one, and <span className="mono text-white/75">/m/&lt;id&gt;</span>{" "}
          lists every one of them with the price it settled at.
        </p>

        <nav className="mt-5 grid grid-cols-2 gap-2">
          {DOORS.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              className="rounded-xl bg-[#181818] px-3 py-3 text-center transition-colors hover:bg-[#212121]"
            >
              <span className="block text-[12px] font-semibold">{d.label}</span>
              <span className="mono mt-0.5 block text-[9px] tracking-wide text-white/35">
                {d.sub}
              </span>
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}
