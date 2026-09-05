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
export const alt = "XORR — a handheld console for trading price ranges on Monad";
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
          background: "#141414",
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
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ width: 12, height: 12, borderRadius: 4, background: "#ff9f0a" }} />
              <div style={{ width: 12, height: 12, borderRadius: 4, background: "#ff9f0a" }} />
            </div>
            <div style={{ width: 36, height: 9, borderRadius: 5, background: "#ff9f0a" }} />
          </div>
          <div style={{ color: "#ff9f0a", fontSize: 46, letterSpacing: 10, fontWeight: 700 }}>
            XORR
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ color: "#ffffff", fontSize: 68, lineHeight: 1.1, fontWeight: 700 }}>
            Built for fun and money.
          </div>
          <div style={{ color: "#8a8a8a", fontSize: 31, lineHeight: 1.45 }}>
            Paint a band around the price. If it prints inside at the cutoff block,
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
            the MON price is Kuru&apos;s order book, read on-chain
          </div>
          <div style={{ display: "flex", color: "#5c5c5c", fontSize: 23 }}>
            300ms blocks · Monad
          </div>
        </div>
      </div>
    ),
    size,
  );
}
