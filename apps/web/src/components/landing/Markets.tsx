"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { MARKETS } from "@molfi/sdk";
import { CoinMark } from "@/components/CoinMark";
import { fetchJson } from "@/lib/fetchJson";
import { useGsap } from "./useGsap";

/**
 * Nine markets, at their actual prices, with the oracle behind each one named.
 *
 * Every price on this rail is fetched from `/api/price` — the same route the desk polls — and
 * the card shows nothing at all until its price arrives. A landing page for a product whose
 * pitch is "these are real prices, settled against a real median" cannot put a plausible
 * number in a card and hope; the one thing that would falsify the entire claim is a made-up
 * figure on the page making it.
 *
 * The `settle` badge is the part most pages would flatten. Four of these settle against
 * Pragma's own aggregate; five have no Starknet oracle at all and settle against molfi's
 * median across five independent exchanges. Those are different trust assumptions and the
 * reader is entitled to know which one they are taking.
 */

interface Row {
  key: string;
  label: string;
  symbol: string;
  dp: number;
  settle: "pragma" | "molfi";
  price: string | null;
}

export function Markets() {
  const [rows, setRows] = useState<Row[]>(
    MARKETS.map((m) => ({
      key: m.key,
      label: m.label,
      symbol: m.symbol,
      dp: m.dp,
      settle: m.settle,
      price: null,
    })),
  );

  useEffect(() => {
    let alive = true;
    const read = async () => {
      const next = await Promise.all(
        MARKETS.map(async (m) => {
          try {
            const d = await fetchJson<{ price?: string }>(`/api/price?market=${m.key}`);
            if (!d.price) return null;
            const n = Number(BigInt(d.price)) / 1e8;
            return n.toLocaleString("en-US", {
              minimumFractionDigits: m.dp,
              maximumFractionDigits: m.dp,
            });
          } catch {
            // Unreachable is not zero, and it is not a guess either. The card stays blank.
            return null;
          }
        }),
      );
      if (!alive) return;
      setRows((prev) => prev.map((r, i) => ({ ...r, price: next[i] ?? r.price })));
    };
    void read();
    const id = setInterval(read, 12_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const scope = useGsap(({ gsap, root }) => {
    /**
     * The grid deals itself in, card by card, on a scrubbed trigger.
     *
     * Scrubbed rather than fired-and-forgotten so scrolling back up puts the cards away again —
     * this section is a list of nine near-identical objects, and a one-shot reveal makes the
     * ninth arrive long after the reader has already read it.
     */
    gsap.from("[data-mk=card]", {
      y: 44,
      opacity: 0,
      scale: 0.96,
      duration: 0.5,
      ease: "power2.out",
      stagger: { each: 0.05, from: "start" },
      scrollTrigger: {
        trigger: root,
        start: "top 80%",
        end: "top 30%",
        scrub: 0.5,
      },
    });
  });

  return (
    <section ref={scope} data-mk="root" className="border-t border-white/5 px-5 py-24">
      <div className="mx-auto w-full max-w-[1000px]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-[clamp(1.9rem,5vw,3.2rem)] font-extrabold leading-[1.02] tracking-[-0.02em]">
            Nine markets, live.
          </h2>
          <p className="mono text-[9.5px] leading-relaxed tracking-[0.14em] text-white/30">
            PRICES READ NOW · NOT A SNAPSHOT
          </p>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {rows.map((r) => (
            <motion.div
              key={r.key}
              data-mk="card"
              whileHover={{ y: -4, borderColor: "rgba(255,255,255,0.16)" }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="rounded-[14px] border border-white/6 bg-[#111113] p-3.5"
            >
              <div className="flex items-center gap-2">
                <CoinMark coin={r.key} size={22} />
                <span className="text-[13px] font-bold tracking-tight">{r.symbol}</span>
              </div>
              <div className="tnum mt-2.5 text-[17px] font-bold leading-none text-white">
                {r.price ?? <span className="text-white/20">—</span>}
              </div>
              <div className="mono mt-2 text-[8.5px] tracking-[0.1em] text-white/25">
                {r.settle === "pragma" ? "PRAGMA MEDIAN" : "5-VENUE MEDIAN"}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
