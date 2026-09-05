import type { MetadataRoute } from "next";

/**
 * Every real route, listed once.
 *
 * Priorities follow what a first-time visitor should land on: the pitch, then the markets.
 * Contracts rank below both deliberately — it is the proof, and proof is what you read
 * second.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://molfi.fun";
  const routes: Array<{ path: string; priority: number; freq: "daily" | "weekly" | "monthly" }> = [
    { path: "/", priority: 1, freq: "weekly" },
    { path: "/how-it-works", priority: 0.8, freq: "weekly" },
    { path: "/privacy", priority: 0.3, freq: "monthly" },
    { path: "/terms", priority: 0.3, freq: "monthly" },
  ];

  return routes.map((route) => ({
    url: `${base}${route.path}`,
    changeFrequency: route.freq,
    priority: route.priority,
  }));
}
