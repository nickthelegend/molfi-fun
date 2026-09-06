import Link from "next/link";
import { NETWORKS } from "@molfi/sdk";
import { NETWORK } from "@/lib/rpc";

/**
 * A market id this contract never listed.
 *
 * Route-scoped so the copy can be about markets rather than about pages, while the response
 * still carries a 404. It used to answer 200 with this same text — which reads correctly to
 * a person and lies to everything else: a crawler indexes a market that does not exist, and
 * an uptime check cannot tell a mistyped id from a working page.
 */
export default function MarketNotFound() {
  return (
    <main className="tiled grid min-h-dvh place-items-center px-5">
      <div className="w-full max-w-[420px] rounded-[22px] bg-card p-6 text-center">
        <div className="mono flex items-center justify-center gap-2 text-[9.5px] tracking-[0.15em] text-dim">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-[1px] bg-red"
            style={{ boxShadow: "0 0 6px rgba(232,69,60,.8)" }}
          />
          NO SUCH MARKET · 404
        </div>

        <p className="mt-3 text-[15px] font-semibold">That market is not on this contract</p>
        <p className="mt-3 text-[13px] leading-relaxed text-white/50">
          {NETWORKS[NETWORK].market
            ? "Markets are numbered from one, in the order they were listed. /live lists every one of them with the price it settled at."
            : `molfi's market contract is not deployed on ${NETWORK} yet, so there is nothing to verify.`}
        </p>

        <div className="mt-5 flex gap-2">
          <Link
            href="/live"
            className="flex-1 rounded-full bg-amber-2 py-3 text-[13px] font-extrabold text-black"
          >
            EVERY MARKET
          </Link>
          <Link
            href="/verify"
            className="flex-1 rounded-full bg-[#181818] py-3 text-[13px] font-semibold"
          >
            A POSITION
          </Link>
        </div>
      </div>
    </main>
  );
}
