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

  if (!res.ok) throw new Error(`${route(url)} returned ${res.status}`);
  return (await res.json()) as T;
}

/** The bit of a URL worth putting in front of a person. */
function route(url: string): string {
  const path = url.split("?")[0];
  return path.startsWith("/api/") ? path.slice(1) : path;
}
