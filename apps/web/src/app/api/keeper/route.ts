import { NextResponse } from "next/server";

/**
 * What the keeper has actually done.
 *
 * Proxied rather than linked, for two reasons that both matter. The keeper runs on a
 * different host, so a browser calling it directly is a CORS problem and a second origin for
 * a reader to trust. And a keeper that is down should degrade this route, not break the page
 * that embeds it — "the keeper is unreachable" is a fact worth rendering, and it is not the
 * same fact as "the keeper has done nothing".
 *
 * Everything here is a claim the chain can settle: each row carries a transaction hash.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const KEEPER_URL = process.env.KEEPER_URL ?? "";

/** Short, because this sits in front of a page render. A slow keeper must not hang the page. */
const TIMEOUT_MS = 8_000;

async function ask(path: string) {
  const res = await fetch(`${KEEPER_URL}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json();
  return { status: res.status, body };
}

export async function GET(req: Request) {
  if (!KEEPER_URL) {
    return NextResponse.json(
      {
        configured: false,
        reason:
          "No keeper is configured for this deployment. Settlement is permissionless, so " +
          "markets can still be settled by anyone — there is just nobody doing it automatically.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const want = new URL(req.url).searchParams.get("view") ?? "health";
  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit") ?? 25), 200);

  try {
    if (want === "actions") {
      const { body } = await ask(`/actions?limit=${limit}`);
      return NextResponse.json({ configured: true, ...body }, { headers: { "cache-control": "no-store" } });
    }
    if (want === "settled") {
      const { body } = await ask(`/settled?limit=${limit}`);
      return NextResponse.json({ configured: true, ...body }, { headers: { "cache-control": "no-store" } });
    }

    const { status, body } = await ask("/health");
    return NextResponse.json(
      { configured: true, reachable: true, ...body },
      // The keeper's own 503 travels through rather than being flattened to a 200. A proxy
      // that launders a downstream failure is worse than no proxy.
      { status: status === 503 ? 503 : 200, headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      {
        configured: true,
        reachable: false,
        error: (e as Error).message,
        note: "Markets can still be settled by anyone; the keeper is a convenience, not a dependency.",
      },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
