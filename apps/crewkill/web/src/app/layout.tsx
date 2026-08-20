import type { Metadata } from"next";
import { Archivo_Black, JetBrains_Mono } from"next/font/google";
import"./globals.css";

/**
 * Two typefaces, two extremes, nothing in between.
 *
 * Archivo Black carries every structural header at massive scale with negative
 * tracking; JetBrains Mono carries every readout at 13px. The gap between them is
 * the hierarchy, which is what keeps this from reading as a generic dashboard where
 * one sans-serif does all the work at six slightly different sizes.
 */
const display = Archivo_Black({
  weight:"400",
  subsets: ["latin"],
  variable:"--font-display-loaded",
  display:"swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable:"--font-mono-loaded",
  display:"swap",
});

export const metadata: Metadata = {
  title:"CrewKill - molfi.fun",
  metadataBase: new URL("https://crewkill.molfi.fun"),
  openGraph: {
    title: "CrewKill",
    description:
      "Staked social deduction where the privacy is the mechanic. Buy a seat through the STRK20 pool, draw a role nobody can read, and settle onchain.",
    url: "https://crewkill.molfi.fun",
    siteName: "molfi.fun",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "CrewKill",
    description: "Staked social deduction where the privacy is the mechanic.",
  },
  icons: { icon: "/favicon.svg" },
  description:"Buy a seat privately, draw a role nobody can read, vote anonymously, and get paid for being right - settled on-chain through the STRK20 privacy pool.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${mono.variable}`}
      // The script below stamps data-substrate before React hydrates, so the server
      // HTML legitimately differs from the client. Suppressing here is the correct
      // fix for a pre-paint theme script, not a way to hide a real mismatch.
      suppressHydrationWarning
    >
      <head>
        {/*
          Applied before first paint. Reading the stored substrate in an effect instead
          would flash a black console at someone who chose paper, which is exactly the
          kind of detail that makes an interface feel unfinished.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem("crewkill.substrate");if(s==="phosphor"||s==="newsprint"){document.documentElement.dataset.substrate=s}}catch(e){}})()`,
          }}
        />
      </head>
      {/* No hub bar. This is CrewKill, not a directory entry — the link to the rest of the
          house lives in the settings menu, stated once, where it does not compete with the
          game for the top of the screen. */}
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
