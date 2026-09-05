import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import { EvictForeignServiceWorker } from "@/components/EvictForeignServiceWorker";
import { OfflineBanner } from "@/components/OfflineBanner";

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

// Chunky, slightly playful display face for headlines and the wordmark.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "XORR — built for fun and money",
  description:
    "Short-dated range tickets on Monad. Pick a band, stack it, and find out three seconds later.",
  applicationName: "XORR",
  // The generated icon.svg / opengraph-image are picked up by convention; naming them
  // here as well would point at files that do not exist as static assets.
  twitter: {
    card: "summary_large_image",
    title: "XORR — built for fun and money",
    description: "Short-dated range tickets that die when the block does.",
  },
  openGraph: {
    type: "website",
    siteName: "XORR",
    title: "XORR — built for fun and money",
    description: "Short-dated range tickets that die when the block does.",
  },
};

export const viewport: Viewport = {
  // Matches --color-ground, so the chrome and the splash are the page, not a shade near it.
  themeColor: "#141414",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexMono.variable} ${display.variable}`}>
      <body className="min-h-dvh antialiased">
        <EvictForeignServiceWorker />
        <OfflineBanner />
        {children}
      </body>
    </html>
  );
}
