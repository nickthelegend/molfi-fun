import { ImageResponse } from "next/og";

/**
 * The card a shared link renders as.
 *
 * A hackathon link gets pasted into Discord and Twitter far more than it gets typed, and a
 * link with no card is a grey rectangle next to twenty projects that have one. Drawn rather
 * than photographed so it stays legible at the size these are actually displayed.
 *
 * No web font is fetched. A font request that fails at build time takes the whole image with
 * it, and the system stack renders this well enough that the trade is not close.
 */
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_TYPE = "image/png";

export function ogImage({
  eyebrow,
  title,
  blurb,
}: {
  eyebrow: string;
  title: string;
  blurb: string;
}) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#000000",
          padding: 72,
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 10, height: 10, borderRadius: 999, background: "#4ec9e8" }} />
          <div style={{ fontSize: 26, color: "#9b9b9b" }}>{eyebrow}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 92,
              fontWeight: 600,
              color: "#ffffff",
              letterSpacing: -2.5,
              lineHeight: 1.05,
            }}
          >
            {title}
          </div>
          <div style={{ marginTop: 26, fontSize: 30, color: "#9b9b9b", maxWidth: 900, lineHeight: 1.4 }}>
            {blurb}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid #272727",
            paddingTop: 28,
          }}
        >
          <div style={{ fontSize: 30, fontWeight: 600, color: "#ffffff", display: "flex" }}>
            molfi<span style={{ color: "#4ec9e8" }}>.fun</span>
          </div>
          <div style={{ fontSize: 24, color: "#6b6b6b" }}>Starknet Sepolia</div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
