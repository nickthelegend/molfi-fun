import { ImageResponse } from "next/og";

/**
 * The social preview, drawn rather than shipped as a binary.
 *
 * Generated at request time from the same palette the console uses, so it cannot drift
 * away from the product the way a checked-in PNG does. It says the one thing worth
 * saying in a link preview — that the price is an order book — because that is the
 * claim, and a screenshot of a dark rectangle would not carry it.
 */
export const runtime = "edge";
export const alt = "molfi — a handheld console for taking price-range positions nobody can see";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0b0b0c",
          padding: "72px 80px",
          fontFamily: "monospace",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "#0b0b0b",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <svg width="42" height="42" viewBox="0 0 64 64" fill="none">
              <path
                d="M32 8 L56 32 L32 56 L8 32 Z"
                fill="none"
                stroke="#ff9f0a"
                strokeWidth="9"
                strokeLinejoin="round"
              />
              <circle cx="32" cy="32" r="6" fill="#ff9f0a" />
            </svg>
          </div>
          <div style={{ color: "#ff9f0a", fontSize: 40, letterSpacing: 8, fontWeight: 700 }}>
            MOLFI
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ color: "#ffffff", fontSize: 68, lineHeight: 1.1, fontWeight: 700 }}>
            Take a position nobody can see.
          </div>
          <div style={{ color: "#8a8a8a", fontSize: 31, lineHeight: 1.45 }}>
            Paint a band around the price. If it prints inside at the cutoff,
            you get paid the multiplier.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              color: "#3ddc84",
              fontSize: 23,
              border: "1px solid #24a35a",
              borderRadius: 999,
              padding: "10px 22px",
            }}
          >
            your band and your size stay hidden until you claim
          </div>
          <div style={{ display: "flex", color: "#5c5c5c", fontSize: 23 }}>
            STRK20 privacy pool · Starknet
          </div>
        </div>
      </div>
    ),
    size,
  );
}
