"use client";

import { useEffect, useState } from "react";
import { MARKETS, PRAGMA, fmtPrice } from "@molfi/sdk";
import { activeNetwork, explorerContract, shortAddress } from "@/lib/chain";
import type { OracleState } from "@/components/device/OracleStrip";

/**
 * The oracle sheet.
 *
 * XORR put Kuru's order ladder here, because the book was the thing its market was priced
 * against and hiding it would have been hiding the product. molfi's equivalent is Pragma's
 * median: it is the only input that decides whether a band held, and every market settles
 * against it, so it gets the same treatment — shown in full rather than summarised.
 *
 * What is deliberately *not* here: an order book. There is nothing behind a molfi price
 * except publishers agreeing, and drawing a ladder would imply depth that does not exist.
 */

interface Row {
  market: string;
  pair: string;
  mark: string | null;
  oracle: OracleState | null;
  error: string | null;
}

export function Oracle() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      const next = await Promise.all(
        MARKETS.map(async (m): Promise<Row> => {
          try {
            const r = await fetch(`/api/price?market=${m.key}`, { cache: "no-store" });
            const j = (await r.json()) as {
              price?: string;
              oracle?: OracleState | null;
              oracleError?: string | null;
              error?: string;
            };
            if (!r.ok) throw new Error(j.error ?? `price service ${r.status}`);
            return {
              market: m.key,
              pair: m.label,
              mark: j.price ?? null,
              oracle: j.oracle ?? null,
              error: j.oracleError ?? null,
            };
          } catch (e) {
            return {
              market: m.key,
              pair: m.label,
              mark: null,
              oracle: null,
              error: (e as Error).message,
            };
          }
        }),
      );
      if (!stop) {
        setRows(next);
        setLoading(false);
      }
    };
    void load();
    const id = setInterval(load, 15_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  const oracleAddress = PRAGMA[activeNetwork.name === "sepolia" ? "sepolia" : "mainnet"];

  return (
    <div>
      <div className="rounded-2xl bg-[#161616] p-4">
        <span className="label">Settlement oracle</span>
        <p className="mt-2 text-[14px] font-semibold">Pragma · aggregated median</p>
        <p className="mono mt-1 text-[10px] tracking-wide text-white/35">
          {explorerContract(oracleAddress) ? (
            <a
              href={explorerContract(oracleAddress)!}
              target="_blank"
              rel="noreferrer noopener"
              className="text-amber underline"
            >
              {shortAddress(oracleAddress, 10, 6)}
            </a>
          ) : (
            shortAddress(oracleAddress, 10, 6)
          )}{" "}
          · Starknet {activeNetwork.name}
        </p>
        <p className="mt-3 text-[12px] leading-relaxed text-white/45">
          Every molfi market settles against <code>get_data_median</code> on this contract, at
          the first block past the cutoff. The contract refuses a print older than fifteen
          minutes or backed by fewer than three publishers — either one alone would settle
          every position in that market against a number nobody should trust.
        </p>
      </div>

      <div className="mt-3 space-y-2">
        {loading ? (
          <p className="label">reading the chain…</p>
        ) : (
          rows.map((r) => <MarketRow key={r.market} row={r} />)
        )}
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-white/40">
        The price on the deck is a live exchange mark, not this median. Pragma republishes
        every few minutes and a screen frozen for seven of them is unusable — but the mark
        never settles anything, and the drift between the two is printed above so you can see
        exactly how far apart they are before you commit.
      </p>
    </div>
  );
}

function MarketRow({ row }: { row: Row }) {
  const o = row.oracle;
  const driftBps =
    o && row.mark && BigInt(o.price) > 0n
      ? Number(((BigInt(row.mark) - BigInt(o.price)) * 10_000n) / BigInt(o.price))
      : null;

  return (
    <div className="rounded-xl bg-[#161616] p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[14px] font-semibold">{row.pair}</span>
        {o ? (
          <span
            className={`mono text-[10px] tracking-wide ${
              o.quotable ? "text-green" : "text-red"
            }`}
          >
            {o.quotable ? "SETTLEABLE" : "REFUSED"}
          </span>
        ) : (
          <span className="mono text-[10px] text-red">UNREAD</span>
        )}
      </div>

      {o ? (
        <>
          <dl className="mono mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] tracking-wide">
            <Cell k="median" v={fmtPrice(BigInt(o.price), 2)} />
            <Cell k="mark" v={row.mark ? fmtPrice(BigInt(row.mark), 2) : "—"} />
            <Cell
              k="published"
              v={`${o.ageSeconds}s ago`}
              tone={o.ageSeconds > 300 ? "text-amber" : undefined}
            />
            <Cell
              k="publishers"
              v={String(o.sources)}
              tone={o.sources < 3 ? "text-red" : undefined}
            />
            <Cell
              k="drift"
              v={driftBps === null ? "—" : `${driftBps > 0 ? "+" : ""}${driftBps.toFixed(0)} bps`}
              tone={driftBps !== null && Math.abs(driftBps) > 50 ? "text-amber" : undefined}
            />
            <Cell k="decimals" v={String(o.decimals)} />
          </dl>
          {!o.quotable && o.refusal ? (
            <p className="mt-2 text-[11px] leading-relaxed text-red">{o.refusal}</p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-red">
          {row.error ?? "The oracle could not be read."}
        </p>
      )}
    </div>
  );
}

function Cell({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-white/30">{k}</dt>
      <dd className={tone ?? "text-white/70"}>{v}</dd>
    </div>
  );
}
