import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * What a crawler may read, and where the map is.
 *
 * molfi.fun served **no robots.txt and no sitemap.xml at all** — both 404 — while a second,
 * undeployed app in this repo had both. So the shipped site gave crawlers nothing, and the only
 * sitemap that existed pointed at `/markets` and `/contracts`, routes this app has never had.
 *
 * The API is disallowed deliberately. Every route under it is JSON read straight from the chain
 * with `cache-control: no-store`; there is nothing there for a search index, and `/api/price`
 * is rate limited per caller — a crawler looping on it would spend that budget for no one.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: "/api/" }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
