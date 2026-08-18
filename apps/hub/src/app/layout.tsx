import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

/**
 * One typeface, per the landing page system.
 *
 * Geist carries everything. Geist Mono appears only where a number needs to line up
 * with the number under it, which is the one case a monospace is doing real work.
 */
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "molfi.fun — staked games settled on Starknet",
  description:
    "Games where privacy is the mechanic, not a feature. Buy in privately, play, and settle onchain where anyone can check the result afterwards.",
  metadataBase: new URL("https://molfi.fun"),
  openGraph: {
    title: "molfi.fun",
    description:
      "Games where privacy is the mechanic, not a feature. Settled onchain, checkable afterwards.",
    url: "https://molfi.fun",
    siteName: "molfi.fun",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "molfi.fun",
    description: "Games where privacy is the mechanic, not a feature.",
  },
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${geistMono.variable} min-h-screen`}>
        {/* Structured data.

            Search and social renderers read this rather than guessing from the prose, and
            the two games are the thing worth surfacing, so they are described as the
            products they are rather than the site being described as one page. Kept in the
            layout so every route carries it. */}
        <script
          type="application/ld+json"
          // The value is a literal built here, not user input, so there is nothing to escape
          // beyond the closing-tag sequence JSON.stringify cannot produce anyway.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "WebSite",
                  "@id": "https://molfi.fun/#website",
                  name: "molfi.fun",
                  url: "https://molfi.fun",
                  description:
                    "Staked games where privacy is the mechanic, settled on Starknet and checkable afterwards.",
                },
                {
                  "@type": "VideoGame",
                  name: "CrewKill",
                  url: "https://crewkill.molfi.fun",
                  genre: "Social deduction",
                  gamePlatform: "Web",
                  numberOfPlayers: { "@type": "QuantitativeValue", value: 6 },
                  description:
                    "Six seats, four rounds, one pot. A seat is a commitment rather than an address, and the settlement can be recomputed by anyone.",
                  isPartOf: { "@id": "https://molfi.fun/#website" },
                },
                {
                  "@type": "VideoGame",
                  name: "Poker",
                  url: "https://poker.molfi.fun",
                  genre: "Card game",
                  gamePlatform: "Web",
                  numberOfPlayers: { "@type": "QuantitativeValue", minValue: 2, maxValue: 9 },
                  description:
                    "Texas Hold'em with no dealer. Players shuffle and deal between themselves and each step is proved rather than trusted.",
                  isPartOf: { "@id": "https://molfi.fun/#website" },
                },
              ],
            }),
          }}
        />
        <a href="#main" className="skip">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
