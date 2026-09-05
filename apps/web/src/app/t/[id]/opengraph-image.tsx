import { ImageResponse } from "next/og";
import { createPublicClient, defineChain, http, type Address } from "viem";
import { MARKETS, RangeMarketAbi } from "@molfi/sdk";

/**
 * The card for one ticket, drawn from the chain at request time.
 *
 * The outcome on the card is read from the market contract, not from anything we
 * stored — so a shared link cannot show a result that the chain disagrees with. That is
 * the whole reason this page exists rather than a screenshot.
 */
export const alt = "A XORR range ticket, settled on chain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 143);
const RPC = process.env.RPC_UPSTREAM ?? "https://rpc.monad.xyz";
const RANGE = process.env.NEXT_PUBLIC_RANGE_MARKET as Address | undefined;

const usd = (v: bigint) => `$${(Number(v) / 1e6).toFixed(2)}`;
/** Each market at its own precision; two decimals turns a MON band into "0.03 – 0.03". */
const dpOf = (marketId: string) =>
  MARKETS.find((m) => m.marketId.toLowerCase() === marketId.toLowerCase())?.dp ?? 2;
const px = (v: bigint, dp: number) =>
  (Number(v) / 1e8).toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });

export default async function TicketCard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let t: Awaited<ReturnType<typeof read>> = null;
  async function read() {
    if (!RANGE || !/^\d+$/.test(id)) return null;
    const chain = defineChain({
      id: CHAIN_ID,
      name: "monad",
      nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
      rpcUrls: { default: { http: [RPC] } },
    });
    const pub = createPublicClient({ chain, transport: http(RPC) });
    try {
      const row = await pub.readContract({
        address: RANGE,
        abi: RangeMarketAbi,
        functionName: "getTicket",
        args: [BigInt(id)],
      });
      return row.player === "0x0000000000000000000000000000000000000000" ? null : row;
    } catch {
      return null;
    }
  }
  t = await read();

  const status = t ? (["open", "won", "lost", "void"][t.status] ?? "open") : null;
  const headline = !t
    ? "no such ticket"
    : status === "won"
      ? `+${usd(t.payout - t.stake)}`
      : status === "lost"
        ? `−${usd(t.stake)}`
        : (status ?? "open").toUpperCase();
  const colour = status === "won" ? "#3ddc84" : status === "lost" ? "#e8453c" : "#ffffff";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#141414",
          padding: "72px 80px",
          fontFamily: "monospace",
        }}
      >
        <div style={{ display: "flex", color: "#ff9f0a", fontSize: 34, letterSpacing: 8 }}>
          XORR · TICKET #{id}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ color: colour, fontSize: 104, fontWeight: 700, display: "flex" }}>
            {headline}
          </div>
          {t ? (
            <div style={{ color: "#8a8a8a", fontSize: 30, display: "flex" }}>
              {px(t.low, dpOf(t.marketId))} – {px(t.high, dpOf(t.marketId))} ·{" "}
              {usd(t.stake)} at {(t.multiplierBps / 10_000).toFixed(2)}x
              {t.settledPrice > 0n
                ? ` · printed ${px(t.settledPrice, dpOf(t.marketId))}`
                : ""}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", color: "#5c5c5c", fontSize: 24 }}>
          {t
            ? `settled at block ${t.expiryBlock.toLocaleString()} — read from the contract, not a database`
            : "read from the market contract on chain " + CHAIN_ID}
        </div>
      </div>
    ),
    size,
  );
}
