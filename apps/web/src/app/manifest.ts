import type { MetadataRoute } from "next";

/**
 * Installable as a console, which is what it is pretending to be.
 *
 * Portrait-locked and standalone: the layout is a handheld device held in one hand, and
 * a browser chrome around it or a landscape rotation both break that illusion for no
 * gain. The colours are the cabinet's own, so the splash and the status bar match the
 * shell rather than flashing white before the app paints.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "XORR — built for fun and money",
    short_name: "XORR",
    description:
      "Paint a band around the price, pick a cutoff a few blocks out, and get paid the " +
      "multiplier if the price prints inside it. The MON price is Kuru's order book, " +
      "read on-chain.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#141414",
    theme_color: "#141414",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
