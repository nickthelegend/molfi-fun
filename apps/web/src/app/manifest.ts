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
    name: "molfi — take a position nobody can see",
    short_name: "molfi",
    description:
      "Paint a band around the price, pick how long it has to hold, and get paid the " +
      "multiplier if the price prints inside it. Your band and your size stay hidden " +
      "until you claim.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#141414",
    theme_color: "#141414",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
