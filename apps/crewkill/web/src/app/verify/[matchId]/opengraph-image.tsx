import { ImageResponse } from "next/og";
import { auditMatch, type MatchView } from "@crewkill/protocol";

export const alt = "CrewKill match verification";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The card a verification link renders as.
 *
 * A permalink is for sending to somebody, and the whole point is that they can check the
 * result themselves. A card that already shows the verdict and the score gets the claim
 * across in the preview, and the link under it is how they confirm it rather than take it.
 *
 * The verdict is recomputed here, not read from a field, so the card cannot disagree with
 * the page it links to.
 */
export default async function Image({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;

  let match: MatchView | null = null;
  try {
    const base = process.env.KEEPER_URL ?? "http://localhost:8080";
    const res = await fetch(`${base}/api/matches/${matchId}`, { cache: "no-store" });
    if (res.ok) match = (await res.json()) as MatchView;
  } catch {
    // A card that cannot reach the keeper still renders, saying what it does not know.
  }

  const result = match ? auditMatch(match) : null;
  const checked = result?.applicable ?? false;
  const good = checked && result!.failed === 0;

  const headline = !match
    ? "Match unavailable"
    : !checked
      ? `Match ${matchId} has not settled`
      : good
        ? "Checks out"
        : "Does not check out";

  const sub = !match
    ? "This match could not be read from the keeper."
    : !checked
      ? "Its secrets are published only once play is over."
      : `${result!.passed} of ${result!.checks.length} recomputed independently and agreeing with the contract.`;

  const accent = !checked ? "#8a8a8a" : good ? "#4ec9e8" : "#e06c6c";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0c0e15",
          padding: 72,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 10, height: 10, borderRadius: 999, background: accent }} />
          <div style={{ fontSize: 26, color: "#8a8a8a", letterSpacing: 2 }}>
            PERMISSIONLESS AUDIT
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 34, color: "#8a8a8a" }}>{`CrewKill match ${matchId}`}</div>
          <div
            style={{
              fontSize: 92,
              fontWeight: 700,
              color: accent,
              letterSpacing: -2,
              lineHeight: 1.05,
              marginTop: 12,
            }}
          >
            {headline}
          </div>
          <div style={{ marginTop: 22, fontSize: 28, color: "#9b9b9b", maxWidth: 950 }}>{sub}</div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid #23262f",
            paddingTop: 26,
          }}
        >
          <div style={{ fontSize: 26, color: "#fff", display: "flex" }}>
            <span>crewkill</span>
            <span style={{ color: accent }}>.molfi.fun</span>
          </div>
          <div style={{ fontSize: 22, color: "#6b6b6b" }}>recompute it yourself</div>
        </div>
      </div>
    ),
    size,
  );
}
