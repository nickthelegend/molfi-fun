import { auditMatch, type MatchView } from "@crewkill/protocol";
import { API_URL } from "@/lib/api";

/**
 * A verification badge, as SVG.
 *
 * The audit is only worth something if it travels. A README or a tournament page can embed
 * this and it will say what is true at the moment somebody loads it, recomputed server-side
 * from the match's published data rather than baked in when the image was made.
 *
 * That is the difference from a normal status badge: this one is not reporting a stored
 * boolean, it is running the check.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ matchId: string }> },
): Promise<Response> {
  const { matchId } = await params;

  if (!/^\d+$/.test(matchId)) {
    return svg("match", "invalid", "#e06c6c");
  }

  let match: MatchView | null = null;
  try {
    const res = await fetch(`${API_URL}/api/matches/${matchId}`, { cache: "no-store" });
    if (res.ok) match = (await res.json()) as MatchView;
  } catch {
    // Falls through to the unreachable badge below.
  }

  if (!match) return svg(`match ${matchId}`, "unreachable", "#8a8a8a");

  const result = auditMatch(match);
  if (!result.applicable) return svg(`match ${matchId}`, "not settled", "#8a8a8a");

  return result.failed === 0
    ? svg(`match ${matchId}`, `${result.passed}/${result.checks.length} verified`, "#3fb950")
    : svg(`match ${matchId}`, `${result.failed} failed`, "#e06c6c");
}

/**
 * Drawn rather than fetched from a badge service.
 *
 * A third party rendering this badge should not have to trust anything but this endpoint,
 * and pulling the image from somewhere else would quietly add a party to that list.
 */
function svg(label: string, value: string, colour: string): Response {
  // 6.6px per character at 11px monospace is close enough to keep the pill snug either side.
  const labelWidth = Math.round(label.length * 6.6) + 18;
  const valueWidth = Math.round(value.length * 6.6) + 18;
  const total = labelWidth + valueWidth;

  const body = `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#24292f"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${colour}"/>
  </g>
  <g fill="#fff" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="11">
    <text x="${labelWidth / 2}" y="14" text-anchor="middle">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14" text-anchor="middle">${value}</text>
  </g>
</svg>`;

  return new Response(body, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // Recomputed per request. A cached badge would be reporting a past check as a present one.
      "cache-control": "no-store, max-age=0",
    },
  });
}
