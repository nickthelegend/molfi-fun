/**
 * The table's own mark.
 *
 * The client shipped wearing the reference project's logo, which made a game running on this
 * hub look like somebody else's demo embedded in it. The cryptography *is* theirs and the
 * credit line below says so plainly — what changes here is whose table you are sitting at.
 *
 * Drawn rather than dropped in as a raster: it stays sharp at any size, needs no asset
 * pipeline, and the suit marks can carry the accent colour that the rest of the table uses.
 */
export function Wordmark() {
  return (
    <div className="flex flex-col items-center select-none">
      <div className="flex items-baseline gap-3">
        {/* Spade and heart flanking the word, set as type rather than decoration. */}
        <span className="text-4xl leading-none text-white/25" aria-hidden>
          ♠
        </span>

        <h1 className="relative text-[68px] leading-[0.85] font-black tracking-[-0.045em] text-white sm:text-[92px]">
          POKER
          {/* A thin rule under the word, the width of the word, so the lockup reads as one
              object instead of a heading with a line near it. */}
          <span
            className="absolute -bottom-2 left-0 h-px w-full"
            style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)" }}
            aria-hidden
          />
        </h1>

        <span className="text-4xl leading-none text-rose-500/40" aria-hidden>
          ♥
        </span>
      </div>

      <p className="mt-5 text-[11px] font-medium uppercase tracking-[0.42em] text-white/45">
        No dealer. No server.
      </p>

      <p className="mt-2 text-[10px] uppercase tracking-[0.2em] text-white/25">
        molfi<span className="text-cyan-400/60">.fun</span>
      </p>
    </div>
  );
}

/**
 * Attribution, kept visible.
 *
 * The mental poker protocol, circuits and contracts are dpinones' work. Rebranding the table
 * without saying so would be taking credit for the hardest part of this, so the credit sits
 * on the screen rather than in a README nobody opens.
 */
export function ProtocolCredit() {
  return (
    <p className="text-[10px] text-white/20">
      Mental poker protocol, circuits and contracts by{" "}
      <a
        href="https://github.com/dpinones/mental-poker"
        target="_blank"
        rel="noreferrer noopener"
        className="text-white/35 underline decoration-white/15 underline-offset-2 hover:text-white/60"
      >
        dpinones/mental-poker
      </a>
    </p>
  );
}
