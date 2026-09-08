"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { MARKETS } from "@molfi/sdk";
import { NETWORK } from "@/lib/chain";
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
  /** How old the *settlement* feed is, when it is too old to quote on. Null when healthy. */
  staleMinutes: number | null;
}

/** A pair is listable where the oracle it settles against actually publishes. */
const listable = (settle: string) => NETWORK !== "mainnet" || settle === "pragma";

export function Markets() {
  const [rows, setRows] = useState<Row[]>(
    MARKETS.map((m) => ({
      key: m.key,
      label: m.label,
      symbol: m.symbol,
      dp: m.dp,
      settle: m.settle,
      price: null,
      staleMinutes: null,
    })),
  );

  useEffect(() => {
    let alive = true;
    const read = async () => {
      const next = await Promise.all(
        MARKETS.map(async (m) => {
          try {
            const d = await fetchJson<{
              price?: string;
              oracle?: { quotable?: boolean; ageSeconds?: number };
            }>(`/api/price?market=${m.key}`);
            if (!d.price) return null;
            const n = Number(BigInt(d.price)) / 1e8;
            return {
              price: n.toLocaleString("en-US", {
                minimumFractionDigits: m.dp,
                maximumFractionDigits: m.dp,
              }),
              /**
               * The mark moves every twelve seconds; the feed that *settles* it may not.
               *
               * These are two different numbers and the card was quietly conflating them —
               * showing an exchange mark under a label naming the settlement oracle. When the
               * feed falls behind, a market cannot resolve, and a page that keeps ticking a
               * live price over a frozen oracle is the most misleading thing it could do.
               */
              staleMinutes:
                d.oracle && d.oracle.quotable === false && typeof d.oracle.ageSeconds === "number"
                  ? Math.round(d.oracle.ageSeconds / 60)
                  : null,
            };
          } catch {
            // Unreachable is not zero, and it is not a guess either. The card stays blank.
            return null;
          }
        }),
      );
      if (!alive) return;
      setRows((prev) =>
        prev.map((r, i) => ({
          ...r,
          price: next[i]?.price ?? r.price,
          staleMinutes: next[i] ? next[i]!.staleMinutes : r.staleMinutes,
        })),
      );
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

  /**
   * Which pairs this chain can actually settle.
   *
   * Four settle against Pragma, which is on mainnet. Five settle against molfi's own median,
   * relayed on chain — and that relay only exists on Sepolia, because Pragma stopped
   * publishing there. So the same nine pairs are nine tradeable markets on the testnet and
   * four on mainnet, and the page has to say so rather than counting the ones it wishes it had.
   */
  const tradeable = rows.filter((r) => listable(r.settle));

  return (
    <section ref={scope} data-mk="root" className="border-t border-white/5 px-5 py-24">
      <div className="mx-auto w-full max-w-[1000px]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-[clamp(1.9rem,5vw,3.2rem)] font-extrabold leading-[1.02] tracking-[-0.02em]">
            {/*
              Counted, not written down. The heading said "Nine markets, live." on a network
              that lists four of them — the five that settle against molfi's own relayed median
              have no relay on mainnet, so the page was advertising markets nobody could trade.
              A number in prose is a number that goes stale silently.
            */}
            {tradeable.length === MARKETS.length
              ? `${MARKETS.length} markets, live.`
              : `${tradeable.length} markets, live on mainnet.`}
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
              {/*
                Says what it means, rather than naming a source the number did not come from.
                This read `PRAGMA MEDIAN` directly under an exchange mark — so a sceptic who did
                the obvious thing, compare the card against Pragma's on-chain median, found two
                different numbers and a page that looked wrong. The label names where the market
                *settles*; the figure above it is the live mark, which is what "read now" means.
              */}
              <div className="mono mt-2 text-[8.5px] tracking-[0.1em] text-white/25">
                {r.settle === "pragma" ? "SETTLES ON PRAGMA" : "SETTLES ON MOLFI'S MEDIAN"}
              </div>
              {/*
                A pair whose settlement oracle is not on this chain is priced and not listed,
                and the card has to say which. The mark above is a real number either way — it
                comes from molfi's own median across five exchanges — but a card that shows a
                live price and nothing else reads as an invitation to trade something that
                cannot be traded here.
              */}
              {!listable(r.settle) ? (
                <div className="mono mt-1 text-[8.5px] leading-relaxed tracking-[0.1em] text-white/35">
                  PRICED, NOT LISTED HERE · NEEDS MOLFI&rsquo;S RELAY
                </div>
              ) : null}
              {r.staleMinutes !== null ? (
                <div className="mono mt-1 text-[8.5px] tracking-[0.1em] text-amber">
                  FEED {r.staleMinutes}M OLD
                </div>
              ) : null}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
