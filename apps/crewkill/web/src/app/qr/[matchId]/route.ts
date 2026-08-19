import QRCode from "qrcode";

/**
 * A QR pointing at a match's verification page.
 *
 * The demo problem this solves: somebody watching over your shoulder cannot check anything.
 * Scanning this puts the audit on their own phone, running in their own browser, against
 * data they fetched themselves — which is a much stronger demonstration than being shown a
 * green tick on somebody else's laptop.
 *
 * Rendered server-side as SVG so it stays crisp at any size and needs no client JavaScript.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ matchId: string }> },
): Promise<Response> {
  const { matchId } = await params;

  if (!/^\d+$/.test(matchId)) {
    return new Response("match id must be digits", { status: 400 });
  }

  // Built from the request's own origin, so a QR generated on localhost points at localhost
  // and one generated in production points at production. Hardcoding a domain here would
  // make every local demo scan to a site that does not have the match.
  const origin = new URL(request.url).origin;
  const target = `${origin}/verify/${matchId}`;

  const svg = await QRCode.toString(target, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
    color: { dark: "#e8ecf5", light: "#0c0e15" },
  });

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // The target never changes for a given match, so this one is safe to cache.
      "cache-control": "public, max-age=3600",
    },
  });
}
