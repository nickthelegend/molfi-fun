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
   * Already reduced — say it again unchanged.
   *
   * `send` catches, reduces, and rethrows as a plain `Error(text)`, and its caller reduces
   * again. Running the JSON heuristics over an English sentence turned a good explanation
   * into "unknown, and the node said nothing readable" — the second pass destroying what the
   * first one found. A message with no JSON and no RPC envelope in it is the answer already.
   */
  const raw = String((e as Error)?.message ?? e);

  // A Cairo revert names itself in a quoted felt, wherever it turns up. That is the whole
  // answer, and it has to be checked before anything decides the text is already reduced.
  const namedEarly = raw.match(/\('([A-Z0-9_]+)'\)/);
  if (namedEarly) return namedEarly[1];

  if (e instanceof Error && !/[{}[\]]/.test(raw) && !raw.startsWith("RPC:")) {
    return collapse(raw);
  }

  /**
   * The node's own error object, taken from the deepest `baseError` rather than the outer
   * one.
   *
   * starknet.js wraps the failure in an `RpcError` whose `message` is the *request* —
   * `RPC: starknet_estimateFee with params {…}` — with a `code` getter beside it. Matching
   * the first `{code, message}` therefore explained a failed relay by quoting the relay.
   * The explanation is always further in, under `baseError`.
   */
  const structured = (() => {
    let node: unknown = e;
    let best: string | null = null;
    for (let depth = 0; depth < 5 && node && typeof node === "object"; depth += 1) {
      const o = node as { code?: unknown; message?: unknown; data?: unknown; baseError?: unknown };
      // A node error, not just anything carrying a `message`: a plain `Error` has one too,
      // and treating it as structured handed its own text straight back as the explanation.
      const isNodeError =
        typeof o.message === "string" &&
        !o.message.startsWith("RPC:") &&
        (o.code !== undefined || o.data !== undefined);
      if (isNodeError) {
        best = `${String(o.message)}${detailOf(o.data)}`;
      }
      node = o.baseError;
    }
    return best;
  })();

  const text = structured ?? raw;

  // A Cairo revert names itself in a quoted felt. That is the whole answer.
  const named = text.match(/\('([A-Z0-9_]+)'\)/);
  if (named) return named[1];
  if (structured) return collapse(structured);

  /**
   * The failure trails the request, so take the LAST `"message"`, not the first.
   *
   * Every earlier one belongs to the transaction we tried to send.
   */
  const messages = [...text.matchAll(/"message"\s*:\s*"([^"]+)"/g)].filter(
    (m) => !m[1].startsWith("RPC:"),
  );
  if (messages.length > 0) {
    const msg = messages[messages.length - 1][1];
    const datas = [...text.matchAll(/"(?:data|execution_error)"\s*:\s*"([^"]+)"/g)];
    const detail = datas.length > 0 ? datas[datas.length - 1][1] : "";
    return collapse(detail ? `${msg} — ${innermost(detail)}` : msg);
  }

  const bare = text.match(
    /(Invalid transaction nonce|Account validation failed|insufficient|exceed balance|max_fee|balance)[^\n"]*/i,
  );
  if (bare) return collapse(bare[0]);

  /**
   * Last resort: a line that is prose, not JSON.
   *
   * The old version took "the longest line that is not the params echo", which happily
   * returned a lone JSON key into the ledger.
   */
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const useful = lines.find(
    (l) => !/^RPC:/.test(l) && !/[{}[\]]/.test(l) && /\s/.test(l) && l.length > 12,
  );
  return collapse(useful ?? "unknown, and the node said nothing readable");
}

/** The `data` field, whatever shape it arrived in, as a suffix or nothing. */
function detailOf(data: unknown): string {
  if (data === undefined || data === null) return "";
  if (typeof data === "string") return ` — ${innermost(data)}`;
  const o = data as { execution_error?: unknown; revert_error?: unknown };
  const inner = o.execution_error ?? o.revert_error;
  if (typeof inner === "string") return ` — ${innermost(inner)}`;
  return ` — ${JSON.stringify(data)}`;
}

/**
 * The innermost cause of a Cairo trace, without the address rubble.
 *
 * `execution_error` is a chain of "Contract address=…, Class hash=…, Selector=…, Nested
 * error: …" frames. Every frame but the last is the call stack; the last one is why.
 */
function innermost(trace: string): string {
  const frames = trace.split(/Nested error:/);
  const last = frames[frames.length - 1];
  const felt = last.match(/\('([^']+)'\)/);
  if (felt) return felt[1];
  return last
    .replace(/Contract address=\s*0x[0-9a-fA-F]+,?/g, "")
    .replace(/Class hash=\s*0x[0-9a-fA-F]+,?/g, "")
    .replace(/Selector=\s*0x[0-9a-fA-F]+,?/g, "")
    .trim();
}

/** One line, no escaped newlines, short enough for a log and a ledger row. */
function collapse(s: string): string {
  return s.replace(/\\n/g, " ").replace(/\s+/g, " ").trim().slice(0, 220);
}
