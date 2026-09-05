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
  title: "molfi.fun — prediction markets where your position is private",
  description:
    "Pick a price range and stake on it. Your range and size stay sealed until the market settles, so nobody can front run you.",
  metadataBase: new URL("https://molfi.fun"),
  openGraph: {
    title: "molfi.fun",
    description:
      "Prediction markets where your position is private until it settles. Settled onchain.",
    url: "https://molfi.fun",
    siteName: "molfi.fun",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "molfi.fun",
    description: "Prediction markets where your position is private until it settles.",
  },
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${geistMono.variable} min-h-screen`}>
        {/* Structured data.

            Search and social renderers read this rather than guessing from the prose, so the
            product is described as what it is rather than the site being described as one
            page. Kept in the layout so every route carries it. */}
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
                    "Prediction markets where your position stays sealed until settlement, settled on Starknet and checkable afterwards.",
                },
                {
                  "@type": "WebApplication",
                  name: "molfi",
                  url: "https://molfi.fun/markets",
                  applicationCategory: "FinanceApplication",
                  operatingSystem: "Web",
                  description:
                    "Pick a price range and how long it has to hold. Your range and size are recorded as a commitment rather than an address, so nobody can front run or copy a position, and the settlement can be recomputed by anyone afterwards.",
                  isPartOf: { "@id": "https://molfi.fun/#website" },
                  offers: {
                    "@type": "Offer",
                    price: "0",
                    priceCurrency: "USD",
                    description: "Free on Starknet Sepolia testnet.",
                  },
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
