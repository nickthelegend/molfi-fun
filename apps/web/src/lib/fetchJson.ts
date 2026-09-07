"use client";

/**
 * A browser fetch that cannot hang forever.
 *
 * A request that fails is visible: the desk catches it and prints the reason. A request that
 * simply never answers is not — the promise stays pending, no error is ever set, and the
 * console goes on showing the last good price with nothing to say the connection died.
 * Verified in a browser: with the price and market reads hung, the desk sat for thirty
 * seconds displaying a stale mark as though it were live.
 *
 * Stale-but-labelled is a reasonable way to degrade. Stale-and-silent is not, because the
 * number a trader is about to commit against is the one thing on the screen that has to be
 * either current or visibly not.
 *
 * The timeout is deliberately longer than any of these routes needs. It is a floor under
 * pathology, not a latency budget: a slow node should still be allowed to answer.
 */
export async function fetchJson<T>(
  url: string,
  { timeoutMs = 15_000, ...init }: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    // `AbortSignal.timeout` rejects with a TimeoutError, which says nothing useful on its
    // own. Name the route, because "something timed out" is not actionable and the desk
    // shows this string verbatim.
    const timedOut = (e as Error)?.name === "TimeoutError";
    throw new Error(
      timedOut
        ? `${route(url)} did not answer in ${Math.round(timeoutMs / 1000)}s`
        : `${route(url)} is unreachable`,
    );
  }

  /**
   * Prefer the answer the server actually gave over the fact that it said no.
   *
   * Every route in this app refuses with `{ error: "..." }` written for a person —
   * `a commitment is a felt: 0x and up to 64 hex digits`, `sign in first — this needs a live
   * Privy session`. This threw all of that away and produced `api/position/xyz returned 400`,
   * which is the URL and the status code: the two things the reader can neither act on nor
   * understand. The good message was already on the wire; nothing was reading it.
   *
   * The body is read defensively because not every failure comes from this app — a gateway
   * timeout or an edge error is HTML, and `res.json()` on it throws inside the error path,
   * turning a legible 502 into an unhandled parse failure. When there is nothing readable,
   * the old status line is still the honest answer and is used unchanged.
   */
  if (!res.ok) {
    const said = await res
      .clone()
      .json()
      .then((b: unknown) =>
        b && typeof b === "object" && typeof (b as { error?: unknown }).error === "string"
          ? (b as { error: string }).error
          : null,
      )
      .catch(() => null);
    throw new Error(said ?? `${route(url)} returned ${res.status}`);
  }
  return (await res.json()) as T;
}

/** The bit of a URL worth putting in front of a person. */
function route(url: string): string {
  const path = url.split("?")[0];
  return path.startsWith("/api/") ? path.slice(1) : path;
}
