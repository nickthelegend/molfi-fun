"use client";

import { motion } from "framer-motion";
import { MAINNET_DEPLOYMENT } from "@molfi/sdk";
import { useGsap } from "./useGsap";

/**
 * What molfi did on Starknet mainnet, with every transaction linked to the explorer.
 *
 * The rest of the page argues that molfi's numbers are real by fetching them. This section
 * argues something narrower and harder: that the contract is deployed on the chain where
 * being wrong costs money, and that a stranger can check it without asking. So it does not
 * paraphrase — it lists the transactions, and each one opens on Starkscan.
 *
 * The list is not authored here. It comes from `deployments/mainnet.json` through a
 * generated module, because a hand-maintained restatement of a chain fact drifts: the
 * submission manifest was hand-maintained, drifted to `sepolia`, and told a checker molfi
 * had never touched mainnet while fourteen finalised transactions sat in the repo.
 *
 * The live product runs on Sepolia deliberately, and this section says so rather than
 * letting a mainnet address imply that a mainnet trade is what the button above does. It
 * also says what is *not* done — the three transactions through the STRK20 pool — because a
 * page that lists only the finished work is the kind of evidence a sceptic discounts
 * entirely.
 */
export function Mainnet() {
  const scope = useGsap(({ gsap, root }) => {
    gsap.from("[data-mainnet=row]", {
      x: -14,
      opacity: 0,
      duration: 0.45,
      ease: "power2.out",
      stagger: 0.025,
      scrollTrigger: { trigger: root, start: "top 78%" },
    });
  });

  const d = MAINNET_DEPLOYMENT;
  const deployed = new Date(d.deployedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  return (
    <section ref={scope} data-mainnet="root" className="border-t border-white/5 px-5 py-24">
      <div className="mx-auto w-full max-w-[1000px]">
        <div className="mono text-[9.5px] tracking-[0.18em] text-amber/70">
          STARKNET · MAINNET · {deployed.toUpperCase()}
        </div>
        <h2 className="mt-3 max-w-[24ch] font-display text-[clamp(1.9rem,5vw,3.2rem)] font-extrabold leading-[1.02] tracking-[-0.02em]">
          It is on the chain where being wrong costs money.
        </h2>
        <p className="mt-3 max-w-[54ch] text-[14px] leading-relaxed text-white/45">
          The market contract is deployed on Starknet mainnet, reading Pragma directly, with{" "}
          {d.markets.length} markets listed and{" "}
          {(Number(BigInt(d.bankrollPerMarket) / 10n ** 16n) / 100).toFixed(0)} STRK of house
          bankroll behind each one so it can take a position rather than refuse it. The{" "}
          {d.skipped.length} pairs Pragma does not carry on mainnet were not listed: a market
          whose oracle cannot be read is one that could take a stake and never resolve.
        </p>

        <a
          href={`${d.explorer}/contract/${d.market}`}
          target="_blank"
          rel="noreferrer"
          className="mono mt-7 block truncate rounded-[14px] border border-amber/20 bg-[#111113] px-4 py-3.5 text-[11px] tracking-[0.04em] text-amber transition-colors hover:border-amber/45"
        >
          {d.market}
        </a>

        <ol className="mt-2.5 overflow-hidden rounded-[14px] border border-white/6 bg-[#111113]">
          {d.transactions.map((t, i) => (
            <li key={t.hash} data-mainnet="row">
              <a
                href={`${d.explorer}/tx/${t.hash}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5 transition-colors last:border-b-0 hover:bg-white/[0.03]"
              >
                <span className="mono tnum w-5 shrink-0 text-[10px] text-white/20">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-white/70">
                  {t.what.charAt(0).toUpperCase() + t.what.slice(1)}
                </span>
                <span className="mono hidden shrink-0 text-[10.5px] text-white/25 sm:block">
                  {t.hash.slice(0, 10)}…{t.hash.slice(-6)}
                </span>
                <span className="mono shrink-0 text-[9px] tracking-[0.12em] text-emerald-400/60">
                  ON L1
                </span>
              </a>
            </li>
          ))}
        </ol>

        <p className="mt-3 text-[11.5px] leading-relaxed text-white/30">
          Every one finalised on Ethereum, not merely accepted on L2. Three transactions{" "}
          <em className="not-italic text-white/45">through the STRK20 pool itself</em> are still
          outstanding — molfi&rsquo;s pool route is built and validated against the deployed
          pool&rsquo;s own compiler, but signing them needs a viewing key, and molfi holds none
          by design.
        </p>

        <div className="mt-6 flex flex-wrap gap-2.5">
          <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
            <a
              href={`${d.explorer}/contract/${d.market}`}
              target="_blank"
              rel="noreferrer"
              className="mono block rounded-full border border-white/8 px-4 py-2 text-[9.5px] tracking-[0.14em] text-white/45 transition-colors hover:border-white/20 hover:text-white/70"
            >
              OPEN ON STARKSCAN
            </a>
          </motion.div>
          <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
            <a
              href="https://github.com/nickthelegend/molfi-fun"
              target="_blank"
              rel="noreferrer"
              className="mono block rounded-full border border-white/8 px-4 py-2 text-[9.5px] tracking-[0.14em] text-white/45 transition-colors hover:border-white/20 hover:text-white/70"
            >
              READ THE SOURCE
            </a>
          </motion.div>
        </div>

        <p className="mono mt-6 text-[9.5px] leading-relaxed tracking-[0.1em] text-white/20">
          THE DESK ABOVE TRADES ON SEPOLIA. MAINNET HOLDS THE CONTRACT, NOT YOUR STAKE.
        </p>
      </div>
    </section>
  );
}
