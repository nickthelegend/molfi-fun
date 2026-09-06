import { ImageResponse } from "next/og";
import { NETWORKS } from "@molfi/sdk";
import { NETWORK, bandIsOnChain } from "@/lib/rpc";

/**
 * The social preview, drawn rather than shipped as a binary.
 *
 * Generated at request time from the same palette the console uses, so it cannot drift
 * away from the product the way a checked-in PNG does. It says the one thing worth
 * saying in a link preview — that the price is an order book — because that is the
 * claim, and a screenshot of a dark rectangle would not carry it.
 */
/**
 * Read the chain, so the card cannot promise what the contract does not keep.
 *
 * `edge` and a request-time read rather than a build-time constant: this is the first and
 * often only thing anyone sees of molfi, and it used to assert "your band and your size stay
 * hidden until you claim" while `/privacy` and `/verify` both carried a red box saying the
 * deployed class stores `band_low` and `band_high` in the clear. The two honest pages
 * retracted the claim and the shareable one kept making it.
 */
export const runtime = "edge";
export const dynamic = "force-dynamic";
export const alt = "molfi — a handheld console for taking price-range positions nobody can see";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const market = NETWORKS[NETWORK].market;
  // null means the class could not be read: unknown is not the same as safe, so an
  // unreadable class gets the cautious line rather than the confident one.
  const bandLeaks = market ? await bandIsOnChain(market) : null;
  const claim = bandLeaks === false
    ? "your band and your size stay hidden until you claim"
    : "your size stays hidden; on the class deployed today, your band does not";
  const tone = bandLeaks === false
    ? { text: "#3ddc84", border: "#24a35a" }
    : { text: "#ff9f0a", border: "#8a5f06" };

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
              color: tone.text,
              fontSize: 23,
              border: `1px solid ${tone.border}`,
              borderRadius: 999,
              padding: "10px 22px",
            }}
          >
            {claim}
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
