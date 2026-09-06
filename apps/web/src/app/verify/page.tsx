import Link from "next/link";
import { NETWORKS } from "@molfi/sdk";
import { NETWORK, bandIsOnChain } from "@/lib/rpc";
import { Observer } from "@/components/Observer";
import { marketAddress } from "@/lib/market-reads";

/**
 * Check one position, from outside, with nothing.
 *
 * `/m/<id>` recomputes a market. This is the other half: a stranger with a commitment and no
 * wallet, asking the chain what it will tell them. It is the page that makes the privacy
 * claim falsifiable rather than merely stated — including, right now, where the claim fails.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "molfi — check a position",
  description:
    "Paste any position commitment and read what the deployed contract reveals about it, and what it does not. No wallet, no account.",
};

export default async function VerifyPage() {
  const address = marketAddress();
  const bandOnChain = address ? await bandIsOnChain(address) : null;

  return (
    <main className="tiled min-h-dvh px-5 py-10">
      <div className="mx-auto w-full max-w-[620px]">
        <header className="rounded-[22px] bg-card p-6">
          <div className="label">molfi · check a position · Starknet {NETWORK}</div>
          <h1 className="mt-2 text-[26px] font-extrabold leading-tight tracking-tight">
            A privacy claim you cannot check is a slogan.
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-white/55">
            Every position on molfi is stored under a commitment, and every commitment is
            public. This page reads one straight off the deployed contract and lays out what
            an observer learns from it — so the claim on{" "}
            <Link href="/privacy" className="text-amber underline">
              /privacy
            </Link>{" "}
            can be tested rather than believed.
          </p>
          <p className="mono mt-3 text-[10px] leading-relaxed tracking-wide text-white/30">
            CONTRACT {address ?? "not deployed on this network"}
          </p>
        </header>

        {bandOnChain ? (
          <section className="mt-3 rounded-[22px] border border-red/40 bg-card p-6">
            <div className="mono flex items-center gap-2 text-[9.5px] tracking-[0.15em] text-red">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-[1px] bg-red"
                style={{ boxShadow: "0 0 6px rgba(232,69,60,.8)" }}
              />
              ON THIS CLASS, THE BAND IS ONE OF THE THINGS REVEALED
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-white/55">
              The class deployed at the address above stores{" "}
              <code className="text-white/70">band_low</code> and{" "}
              <code className="text-white/70">band_high</code> in every position. The contract
              in the repository stores a pair of reach ratios instead and never the band, and
              it has not been deployed. Read from the deployed ABI just now — this box goes
              away by itself when that changes.
            </p>
          </section>
        ) : null}

        <Observer bandOnChain={bandOnChain} />

        <section className="mt-3 rounded-[22px] bg-card p-6">
          <div className="label">where to find a commitment</div>
          <p className="mt-2 text-[13px] leading-relaxed text-white/55">
            Every open emits <code className="text-white/70">PositionOpened</code> with the
            market id and the commitment as indexed keys, so they can be listed straight from
            the chain with no help from molfi:
          </p>
          <pre className="mono mt-3 overflow-x-auto rounded-xl bg-[#0d0d0d] p-3 text-[10px] leading-relaxed text-white/70">
{`curl -s ${NETWORKS[NETWORK].rpcUrl} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getEvents","params":[{
        "from_block":{"block_number":0},"to_block":"latest",
        "address":"${address ?? "0x…"}","chunk_size":50}]}'`}
          </pre>
          <p className="mt-3 text-[13px] leading-relaxed text-white/55">
            That is the same list anyone watching this market already has. It is why the band
            being in storage matters, and why the totals on{" "}
            <Link href="/live" className="text-amber underline">
              /live
            </Link>{" "}
            are public on purpose while the positions behind them are not.
          </p>
        </section>

        <nav className="mt-3 grid grid-cols-3 gap-2">
          {[
            { href: "/privacy", label: "What leaks" },
            { href: "/live", label: "Every market" },
            { href: "/play", label: "The console" },
          ].map((d) => (
            <Link
              key={d.href}
              href={d.href}
              className="rounded-xl bg-[#181818] px-3 py-3 text-center text-[12px] font-semibold transition-colors hover:bg-[#212121]"
            >
              {d.label}
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}
