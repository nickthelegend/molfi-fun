import type { MetadataRoute } from "next";

/**
 * Every real route, listed once.
 *
 * Priorities are set by what a first-time visitor should land on, which is the home page and
 * then the two games. The contracts page ranks below those deliberately: it is the proof, and
 * proof is what you read second.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://molfi.fun";
  const routes: Array<{ path: string; priority: number; freq: "daily" | "weekly" | "monthly" }> = [
    { path: "/", priority: 1, freq: "weekly" },
    { path: "/crewkill", priority: 0.9, freq: "weekly" },
    { path: "/poker", priority: 0.9, freq: "weekly" },
    { path: "/contracts", priority: 0.7, freq: "daily" },
    { path: "/deployments", priority: 0.6, freq: "daily" },
    { path: "/api-docs", priority: 0.5, freq: "monthly" },
    { path: "/detective-pool", priority: 0.6, freq: "monthly" },
    { path: "/changelog", priority: 0.4, freq: "weekly" },
    { path: "/privacy", priority: 0.3, freq: "monthly" },
    { path: "/terms", priority: 0.3, freq: "monthly" },
  ];

  return routes.map((route) => ({
    url: `${base}${route.path}`,
    changeFrequency: route.freq,
    priority: route.priority,
  }));
}
