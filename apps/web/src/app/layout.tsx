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
  title: "molfi — take a position nobody can see",
  description:
    "Range positions on Starknet. Pick a band and how long it has to hold. Your band and your size stay sealed until it settles.",
  applicationName: "molfi",
  // The generated icon.svg / opengraph-image are picked up by convention; naming them
  // here as well would point at files that do not exist as static assets.
  twitter: {
    card: "summary_large_image",
    title: "molfi — take a position nobody can see",
    description: "A prediction market where your order stops being a signal before it is a trade.",
  },
  openGraph: {
    type: "website",
    siteName: "molfi",
    title: "molfi — take a position nobody can see",
    description: "A prediction market where your order stops being a signal before it is a trade.",
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
