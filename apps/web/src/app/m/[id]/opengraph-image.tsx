import { ImageResponse } from "next/og";
import { MARKETS, NETWORKS, auditMarket, decodeMarket, decodeTable, fmtPrice } from "@molfi/sdk";
import { hash } from "starknet";
import { NETWORK, call } from "@/lib/rpc";

/**
 * A link preview that is the receipt, not an advert for one.
 *
 * A settled molfi market is a claim anybody can recompute, and the share of it should carry
 * the recomputed answer: the pair, the price it settled at, how many independent publishers
 * stood behind that print, and whether every audit check passed. Drawn per market at request
 * time from the same read `/m/<id>` makes, so the picture cannot say something the page does
 * not — the failure mode of a checked-in image.
 *
 * A market that cannot be read still produces a card. A social crawler getting a 500 shows
 * nothing at all, which is a worse answer than "this one could not be read".
 */
export const alt = "A settled molfi market, recomputed from published data";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const DIM = "#8a8a8a";

async function read(id: number) {
  const address = NETWORKS[NETWORK].market;
  if (!address || !Number.isFinite(id) || id < 1) return null;
  try {
    // Both reads, because the audit's pricing check needs the stored table and reporting it
    // as unrunnable on a card whose whole point is "every check passed" would be a shrug.
    const [raw, table] = await Promise.all([
      call(address, hash.getSelectorFromName("get_market"), ["0x" + id.toString(16)]),
      call(address, hash.getSelectorFromName("get_table"), ["0x" + id.toString(16)]),
    ]);
    const market = decodeMarket(id, raw);
    // A market that was never listed reads back as all zeroes rather than reverting, and an
    // audit of all zeroes reports failed checks. The card said "2 CHECKS FAILED" about a
    // market that does not exist, which is an accusation rather than an answer.
    if (market.cutoffAt === 0) return null;
    market.table = decodeTable(table);
    return market;
  } catch {
    return null;
  }
}

function Stat({ k, v, tone = "#ffffff" }: { k: string; v: string; tone?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", color: DIM, fontSize: 21, letterSpacing: 3 }}>{k}</div>
      <div style={{ display: "flex", color: tone, fontSize: 40, fontWeight: 700 }}>{v}</div>
    </div>
  );
}

export default async function MarketOpengraphImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const market = await read(Number(id));
  const audit = market ? auditMarket(market) : null;
  const dp = MARKETS.find((m) => m.label === market?.pair)?.dp ?? 2;

  const failed = audit ? audit.checks.filter((c) => c.verdict === "failed").length : 0;
  const unchecked = audit ? audit.checks.filter((c) => c.verdict === "unchecked").length : 0;
  const verdict = !audit
    ? { text: "NO SUCH MARKET", tone: "#8a8a8a" }
    : failed > 0
      ? { text: `${failed} CHECK${failed > 1 ? "S" : ""} FAILED`, tone: "#e8453c" }
      : unchecked > 0
        ? { text: `EVERY CHECK THAT COULD RUN PASSED`, tone: "#ff9f0a" }
        : { text: "EVERY CHECK PASSED", tone: "#3ddc84" };

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0b0b0c",
          padding: "68px 80px",
          fontFamily: "monospace",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="38" height="38" viewBox="0 0 64 64" fill="none">
            <path
              d="M32 8 L56 32 L32 56 L8 32 Z"
              fill="none"
              stroke="#ff9f0a"
              strokeWidth="9"
              strokeLinejoin="round"
            />
            <circle cx="32" cy="32" r="6" fill="#ff9f0a" />
          </svg>
          <div style={{ display: "flex", color: "#ff9f0a", fontSize: 30, letterSpacing: 7 }}>
            MOLFI
          </div>
          <div style={{ display: "flex", color: DIM, fontSize: 24, letterSpacing: 3 }}>
            MARKET #{id} · STARKNET {NETWORK.toUpperCase()}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", color: DIM, fontSize: 26, letterSpacing: 4 }}>
            {market ? market.pair : "NOT ON THIS CONTRACT"}
          </div>
          <div style={{ display: "flex", color: "#ffffff", fontSize: 96, fontWeight: 700 }}>
            {!market ? "—" : market.isSettled ? fmtPrice(market.settledPrice, dp) : "STILL OPEN"}
          </div>
          <div style={{ display: "flex", color: verdict.tone, fontSize: 28, letterSpacing: 3 }}>
            {verdict.text}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 64 }}>
          <Stat
            k="PUBLISHERS"
            v={market && market.isSettled ? String(market.settledSources) : "—"}
          />
          <Stat
            k="PRINT AGE"
            v={
              // `settledAt` is when the print was published; `settledBlockAt` is the block
              // that settled against it. Age is the gap, in that order — the other way round
              // this card printed "-341s".
              market && market.isSettled && market.settledBlockAt > 0
                ? `${Math.max(0, market.settledBlockAt - market.settledAt)}s`
                : "—"
            }
          />
          <Stat k="ROUND" v={market ? `${Math.round(market.roundSeconds / 60)}m` : "—"} />
          {/* An invitation to recompute a market that was never listed is an invitation to
              nothing; that card points at /live instead, which does exist. */}
          <div style={{ display: "flex", marginLeft: "auto", color: "#5c5c5c", fontSize: 22 }}>
            {market ? `recompute it yourself · molfi.fun/m/${id}` : "every market · molfi.fun/live"}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
