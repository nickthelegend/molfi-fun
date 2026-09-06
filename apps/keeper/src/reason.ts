/**
 * The one line worth reading out of a Starknet failure.
 *
 * Its own module because it needs no configuration, and a function that needs no
 * configuration should not be importable only by code that does — `chain.ts` throws on a
 * missing `MOLFI_MARKET` at import, which made this untestable in isolation. It is the
 * single place an operator's explanation of a failed transaction is decided, so it is worth
 * being able to test it against the shapes the node actually produces.
 */

/**
 * The one line worth reading out of a Starknet revert.
 *
 * A failed call comes back as several hundred characters of nested addresses wrapped around
 * a single quoted felt. Logging the envelope buries the reason; logging the felt loses
 * nothing anyone needs.
 */
export function reason(e: unknown): string {
  /**
   * Read the structured error first, and only fall back to the formatted string.
   *
   * starknet.js prints the *request* before the failure, and that request contains an
   * `invoke_transaction` object with `message`-shaped keys of its own. Regexing the whole
   * blob for the first `"message"` therefore matched the params echo, so a relay that could
   * not pay its fee was recorded in the ledger as `"invoke_transaction": {` — a persisted
   * row an operator cannot act on. The node hands us `{code, message, data}`; use it.
   */
  const structured = (() => {
    let node: unknown = e;
    for (let depth = 0; depth < 4 && node && typeof node === "object"; depth += 1) {
      const o = node as { code?: unknown; message?: unknown; data?: unknown; baseError?: unknown };
      if (typeof o.message === "string" && (o.code !== undefined || o.data !== undefined)) {
        const detail =
          typeof o.data === "string"
            ? o.data
            : o.data === undefined
              ? ""
              : JSON.stringify(o.data);
        return `${o.message}${detail ? ` — ${detail}` : ""}`;
      }
      node = o.baseError;
    }
    return null;
  })();

  const text = structured ?? String((e as Error)?.message ?? e);

  // A Cairo revert names itself in a quoted felt. That is the whole answer.
  const named = text.match(/\('([A-Z0-9_]+)'\)/);
  if (named) return named[1];
  if (structured) return collapse(structured);

  /**
   * The failure trails the request, so take the LAST `"message"`, not the first.
   *
   * Every earlier `"message"` in the blob belongs to the transaction we tried to send.
   */
  const messages = [...text.matchAll(/"message"\s*:\s*"([^"]+)"/g)];
  if (messages.length > 0) {
    const msg = messages[messages.length - 1][1];
    const datas = [...text.matchAll(/"data"\s*:\s*"([^"]+)"/g)];
    const detail = datas.length > 0 ? datas[datas.length - 1][1] : "";
    return collapse(detail ? `${msg} — ${detail}` : msg);
  }

  const bare = text.match(
    /(Invalid transaction nonce|Account validation failed|insufficient|exceed balance|max_fee|balance)[^\n"]*/i,
  );
  if (bare) return collapse(bare[0]);

  /**
   * Last resort: a line that is prose, not JSON.
   *
   * The old version took "the longest line that is not the params echo", which happily
   * returned a lone JSON key. A line has to contain a space and no unbalanced brace to be
   * worth persisting as an explanation.
   */
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const useful = lines.find(
    (l) => !/^RPC:/.test(l) && !/[{}[\]]/.test(l) && /\s/.test(l) && l.length > 12,
  );
  return collapse(useful ?? "unknown, and the node said nothing readable");
}

/** One line, no escaped newlines, short enough for a log and a ledger row. */
function collapse(s: string): string {
  return s.replace(/\\n/g, " ").replace(/\s+/g, " ").trim().slice(0, 220);
}
