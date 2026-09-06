"use client";

import { useState } from "react";

/**
 * The same read this page made, as a command the reader can run instead of believing us.
 *
 * Everything above is molfi's software telling you molfi is correct. That is worth exactly
 * nothing on its own, and the fix is not a longer explanation — it is one line of curl
 * against a public node nobody here operates, returning the same felts, so a sceptic can
 * compare the number on the screen with the number on the chain in about four seconds.
 *
 * A plain `<a download>` or a fetch would be the obvious way to hand this over and both are
 * worse: the point is that the reader runs it themselves, in their own shell, against an
 * endpoint of their own choosing.
 */
export function CheckItYourself({
  command,
  note,
}: {
  command: string;
  note: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setState("copied");
    } catch {
      // Clipboard access is refused in plenty of ordinary situations — an insecure origin, a
      // permission the reader declined. Saying so beats a button that silently does nothing;
      // the text is selectable either way.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2_400);
  };

  return (
    <div className="mt-3 rounded-2xl bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[14px] font-semibold leading-snug">Check it yourself</p>
        <button
          onClick={() => void copy()}
          className="mono shrink-0 rounded px-2 py-1 text-[10px] tracking-[0.1em] text-amber transition-colors hover:bg-white/8"
        >
          {state === "copied" ? "COPIED" : state === "failed" ? "SELECT IT" : "COPY"}
        </button>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-white/40">{note}</p>

      <pre className="mono mt-3 overflow-x-auto rounded-xl bg-[#0d0d0d] p-3 text-[10px] leading-relaxed text-white/70">
        {command}
      </pre>
    </div>
  );
}
