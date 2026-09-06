/**
 * The market marks, drawn rather than fetched.
 *
 * A coin logo is the one thing on the glass a trader identifies before reading anything, and
 * a coloured disc is not it — BTC and ETH have been the same two shapes for a decade and the
 * eye goes straight to them. These are inline SVG for three reasons that all matter here: the
 * device renders at 19px where a raster mark turns to mush, an external image is a request
 * that can fail and leave a hole in the chassis, and `currentColor` on the field lets one
 * drawing sit on the deck, in the menu and on a share card without three copies.
 *
 * Paths are redrawn from each project's own mark rather than copied out of an icon pack, so
 * the proportions are the official ones and nothing here carries a licence that has to travel
 * with it.
 */

export type CoinKey = "BTC" | "ETH" | "STRK" | "WBTC" | "SOL" | "XRP" | "DOGE" | "LINK" | "AVAX";

/** The brand field each mark sits on, matching `COIN_TONE` on the deck. */
export const COIN_FIELD: Record<CoinKey, string> = {
  BTC: "#f7931a",
  ETH: "#627eea",
  STRK: "#0c0c4f",
  /**
   * Wrapped Bitcoin keeps the ₿ and changes the field.
   *
   * Same asset, different market — so the glyph has to be the one a trader recognises while
   * the disc has to be distinguishable from BTC's at nineteen pixels. Its own brand tone does
   * exactly that: read as Bitcoin, not mistaken for it.
   */
  WBTC: "#f09242",
  /** Each project's own brand field, so the disc is recognised before the glyph is read. */
  SOL: "#000000",
  XRP: "#23292f",
  DOGE: "#c3a634",
  LINK: "#2a5ada",
  AVAX: "#e84142",
};

function Bitcoin() {
  return (
    <>
      <circle cx="16" cy="16" r="16" fill={COIN_FIELD.BTC} />
      {/*
        The ₿ is one glyph and two stems. Drawn as a filled path rather than text so it is
        identical on every machine — a font fallback here would render a capital B.
      */}
      <path
        d="M22.5 14.05c.31-2.07-1.27-3.18-3.43-3.92l.7-2.81-1.71-.43-.68 2.74c-.45-.11-.91-.22-1.37-.32l.69-2.76-1.71-.43-.7 2.81c-.37-.09-.74-.17-1.09-.26v-.01l-2.36-.59-.46 1.83s1.27.29 1.24.31c.69.17.82.63.8 1l-.8 3.2c.05.01.11.03.18.06l-.18-.05-1.12 4.49c-.09.21-.3.53-.79.41.02.03-1.24-.31-1.24-.31l-.85 1.96 2.23.56c.41.1.82.21 1.22.31l-.71 2.84 1.71.43.7-2.81c.47.13.92.24 1.37.35l-.7 2.8 1.71.43.71-2.84c2.92.55 5.11.33 6.04-2.31.75-2.13-.04-3.36-1.58-4.16 1.12-.26 1.96-.99 2.19-2.51zm-3.92 5.5c-.53 2.13-4.12.98-5.28.69l.94-3.76c1.16.29 4.9.86 4.34 3.07zm.53-5.53c-.48 1.94-3.47.95-4.44.71l.85-3.41c.97.24 4.1.69 3.59 2.7z"
        fill="#ffffff"
      />
    </>
  );
}

function Ethereum() {
  return (
    <>
      <circle cx="16" cy="16" r="16" fill={COIN_FIELD.ETH} />
      {/* Two tetrahedra, four faces. The lighter faces are the ones catching the light. */}
      <path d="M16 4.5v8.62l7.29 3.26L16 4.5z" fill="#ffffff" fillOpacity="0.602" />
      <path d="M16 4.5L8.71 16.38 16 13.12V4.5z" fill="#ffffff" />
      <path d="M16 21.97v5.86l7.3-10.1L16 21.97z" fill="#ffffff" fillOpacity="0.602" />
      <path d="M16 27.83v-5.86l-7.29-4.24L16 27.83z" fill="#ffffff" />
      <path d="M16 20.61l7.29-4.23L16 13.13v7.48z" fill="#ffffff" fillOpacity="0.2" />
      <path d="M8.71 16.38L16 20.61v-7.48l-7.29 3.25z" fill="#ffffff" fillOpacity="0.602" />
    </>
  );
}

function Starknet() {
  return (
    <>
      <circle cx="16" cy="16" r="16" fill={COIN_FIELD.STRK} />
      {/*
        Starknet's mark: the swept arc with the four-point spark above it. Drawn at the same
        16-unit centre as the coins so it lines up in a row with them.
      */}
      <path
        d="M6.3 18.36c2.7-1.53 5.94-2.35 9.7-2.35 3.77 0 7 .82 9.7 2.35-1.1 3.9-4.98 6.75-9.7 6.75s-8.6-2.85-9.7-6.75z"
        fill="#ffffff"
        fillOpacity="0.92"
      />
      <path
        d="M25.53 11.72l.86-2.13c.05-.12.16-.2.29-.22l2.26-.33-1.63 1.6c-.1.09-.13.23-.1.35l.6 2.2-2-1.08a.34.34 0 00-.35.01l-1.93 1.2.46-2.23a.34.34 0 00-.11-.34l-1.73-1.5 2.28.18c.13 0 .25-.06.31-.17z"
        fill="#ec796b"
      />
    </>
  );
}

function WrappedBitcoin() {
  return (
    <>
      <circle cx="16" cy="16" r="16" fill={COIN_FIELD.WBTC} />
      {/* The ring is what says "wrapped": the same coin, held by something else. */}
      <circle cx="16" cy="16" r="13.2" fill="none" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1.4" />
      <path
        d="M22.5 14.05c.31-2.07-1.27-3.18-3.43-3.92l.7-2.81-1.71-.43-.68 2.74c-.45-.11-.91-.22-1.37-.32l.69-2.76-1.71-.43-.7 2.81c-.37-.09-.74-.17-1.09-.26v-.01l-2.36-.59-.46 1.83s1.27.29 1.24.31c.69.17.82.63.8 1l-.8 3.2c.05.01.11.03.18.06l-.18-.05-1.12 4.49c-.09.21-.3.53-.79.41.02.03-1.24-.31-1.24-.31l-.85 1.96 2.23.56c.41.1.82.21 1.22.31l-.71 2.84 1.71.43.7-2.81c.47.13.92.24 1.37.35l-.7 2.8 1.71.43.71-2.84c2.92.55 5.11.33 6.04-2.31.75-2.13-.04-3.36-1.58-4.16 1.12-.26 1.96-.99 2.19-2.51zm-3.92 5.5c-.53 2.13-4.12.98-5.28.69l.94-3.76c1.16.29 4.9.86 4.34 3.07zm.53-5.53c-.48 1.94-3.47.95-4.44.71l.85-3.41c.97.24 4.1.69 3.59 2.7z"
        fill="#ffffff"
        transform="translate(16 16) scale(0.86) translate(-16 -16)"
      />
    </>
  );
}


function Solana() {
  return (
    <>
      <circle cx="16" cy="16" r="16" fill={COIN_FIELD.SOL} />
      {/*
        Three slanted bars, sheared the same way the wordmark shears them — the middle one
        mirrored, which is the detail that stops it reading as a hamburger menu. The gradient
        is Solana's own purple-to-green and is defined per-instance so two marks on one page
        cannot collide on the id.
      */}
      <defs>
        <linearGradient id="molfi-sol" x1="6" y1="24" x2="26" y2="8" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9945ff" />
          <stop offset="1" stopColor="#14f195" />
        </linearGradient>
      </defs>
      <path d="M9.6 21.3a.7.7 0 01.5-.2h13.2c.3 0 .5.4.3.6l-2.6 2.6a.7.7 0 01-.5.2H7.3c-.3 0-.5-.4-.3-.6z" fill="url(#molfi-sol)" />
      <path d="M9.6 7.5a.7.7 0 01.5-.2h13.2c.3 0 .5.4.3.6l-2.6 2.6a.7.7 0 01-.5.2H7.3c-.3 0-.5-.4-.3-.6z" fill="url(#molfi-sol)" />
      <path d="M21 14.4a.7.7 0 00-.5-.2H7.3c-.3 0-.5.4-.3.6l2.6 2.6a.7.7 0 00.5.2h13.2c.3 0 .5-.4.3-.6z" fill="url(#molfi-sol)" />
    </>
  );
}

function Ripple() {
  return (
    <>
      <circle cx="16" cy="16" r="16" fill={COIN_FIELD.XRP} />
      {/* The X: two strokes that meet at the centre, drawn as outlines rather than a letter. */}
      <path
        d="M21.9 9h3.4l-7.1 7a3.1 3.1 0 01-4.4 0l-7-7h3.4l5.3 5.2c.3.3.7.3 1 0z"
        fill="#ffffff"
      />
      <path
        d="M10.1 23H6.7l7.1-7.1a3.1 3.1 0 014.4 0l7.1 7.1h-3.4l-5.4-5.3a.7.7 0 00-1 0z"
        fill="#ffffff"
      />
    </>
  );
}

function Dogecoin() {
  return (
    <>
      <circle cx="16" cy="16" r="16" fill={COIN_FIELD.DOGE} />
      {/*
        The Ð — a D with a bar through its stem. Drawn rather than typed for the same reason
        the ₿ is: a font fallback would render a plain D and the coin stops being Dogecoin.
      */}
      <path
        d="M12.2 8.4h5.1c4.4 0 7.3 3 7.3 7.6s-2.9 7.6-7.3 7.6h-5.1v-5.9H9.6v-2.6h2.6zm3.3 2.9v3.8h2.2v2.6h-2.2v3.9h1.6c2.6 0 4.2-1.8 4.2-5.2s-1.6-5.1-4.2-5.1z"
        fill="#ffffff"
      />
    </>
  );
}

function Chainlink() {
  return (
    <>
      <circle cx="16" cy="16" r="16" fill={COIN_FIELD.LINK} />
      {/* The hexagon, drawn as an outline the way the brand does — solid reads as a stop sign. */}
      <path
        d="M16 6.2l-2.6 1.5-7 4.1-2.6 1.5v5.4l2.6 1.5 7.1 4.1 2.6 1.5 2.6-1.5 7-4.1 2.6-1.5v-5.4l-2.6-1.5-7-4.1zm-7 12.3v-5l4.4-2.5 4.3-2.5 4.4 2.5 4.3 2.5v5l-4.3 2.5-4.4 2.5-4.3-2.5z"
        fill="#ffffff"
      />
    </>
  );
}

function Avalanche() {
  return (
    <>
      <circle cx="16" cy="16" r="16" fill={COIN_FIELD.AVAX} />
      {/* The A: one large peak and the small notch beside it. */}
      <path
        d="M19.6 21.8h3.9c.5 0 .9 0 1.1-.2.3-.1.5-.4.6-.7.1-.3 0-.7-.3-1.2l-4.6-8c-.3-.5-.5-.7-.8-.9a1.3 1.3 0 00-1.3 0c-.3.2-.5.4-.8.9l-1 1.7a1 1 0 000 1l3.6 6.3c.3.5.5.7.8.9.2.1.5.2.8.2zm-9.5 0h3.7c.5 0 .8 0 1.1-.2.3-.1.5-.4.6-.7.2-.3.1-.7-.2-1.2l-1.9-3.2a1.4 1.4 0 00-.8-.7 1.3 1.3 0 00-1.2 0c-.3.2-.5.4-.8.9l-1.9 3.2c-.3.5-.3.9-.2 1.2.1.3.3.5.6.7.2.1.5.2 1 .2z"
        fill="#ffffff"
      />
    </>
  );
}

const MARKS: Record<CoinKey, () => React.ReactElement> = {
  BTC: Bitcoin,
  ETH: Ethereum,
  STRK: Starknet,
  WBTC: WrappedBitcoin,
  SOL: Solana,
  XRP: Ripple,
  DOGE: Dogecoin,
  LINK: Chainlink,
  AVAX: Avalanche,
};

/**
 * One market's mark at any size.
 *
 * `size` is the rendered edge in pixels; the drawing is a 32-unit square scaled to it, so the
 * 19px disc on the deck and the 44px one in the menu are the same artwork rather than two.
 */
export function CoinMark({
  coin,
  size = 20,
  className,
}: {
  coin: string;
  size?: number;
  className?: string;
}) {
  const key = (coin.split("/")[0].toUpperCase() as CoinKey) in MARKS
    ? (coin.split("/")[0].toUpperCase() as CoinKey)
    : null;
  const Mark = key ? MARKS[key] : null;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden
      focusable="false"
      // The disc is lit from the same direction as everything else on the chassis, so it
      // reads as a token sitting on the deck rather than a sticker on top of it.
      style={{ borderRadius: "50%", boxShadow: "inset 0 -1px 3px rgba(0,0,0,0.55)" }}
    >
      {Mark ? (
        <Mark />
      ) : (
        /* A market molfi does not have a mark for still gets a disc and its initial, never a
           blank hole where a logo should be. */
        <>
          <circle cx="16" cy="16" r="16" fill="#2e3138" />
          <text
            x="16"
            y="21.5"
            textAnchor="middle"
            fontSize="15"
            fontWeight="700"
            fill="rgba(255,255,255,.72)"
            fontFamily="ui-monospace, monospace"
          >
            {coin.slice(0, 1).toUpperCase()}
          </text>
        </>
      )}
    </svg>
  );
}

/**
 * The Starknet wordmark's spark alone, for the network badge.
 *
 * Separate from the STRK coin because they mean different things: the coin is a market you
 * can take a position on, the spark is the chain the position settles on.
 */
export function StarknetSpark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <path
        d="M2.6 19.1c3.4-2 7.5-3.06 12.3-3.06 4.8 0 8.9 1.06 12.3 3.06-1.4 5.1-6.3 8.8-12.3 8.8S4 24.2 2.6 19.1z"
        fill="currentColor"
      />
      <path
        d="M26.4 8.9l1.1-2.7 2.9-.42-2.1 2.05.77 2.82-2.56-1.39-2.48 1.54.6-2.86-2.23-1.93 2.93.23z"
        fill="#ec796b"
      />
    </svg>
  );
}
