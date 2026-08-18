import type { MetadataRoute } from "next";

/**
 * Generated, not a static file, so it cannot drift from the routes that exist.
 */
export default function robots(): MetadataRoute.Robots {
  const base = "https://molfi.fun";
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
