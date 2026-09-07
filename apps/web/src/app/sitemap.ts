import type { MetadataRoute } from "next";
import { hash } from "starknet";
import { NETWORKS } from "@molfi/sdk";
import { NETWORK, call } from "@/lib/rpc";
import { SITE_URL } from "@/lib/site";

/**
 * The routes this app actually has, plus every market anyone can check.
 *
 * The only sitemap in this repo lived in an app that is not deployed, and it advertised
 * `/markets` and `/contracts` — routes molfi.fun has never served. A sitemap that lists 404s is
 * worse than none: it is a confident, machine-readable claim that is wrong.
 *
 * The market pages are the interesting half. Each `/m/<id>` is a permanent, wallet-free record
 * of a settled market with every check recomputed — the thing the product asks to be judged on —
 * so they belong in the index rather than only the five static pages.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const stat: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1, lastModified: now },
    { url: `${SITE_URL}/play`, changeFrequency: "daily", priority: 0.9, lastModified: now },
    { url: `${SITE_URL}/verify`, changeFrequency: "weekly", priority: 0.8, lastModified: now },
    { url: `${SITE_URL}/privacy`, changeFrequency: "weekly", priority: 0.7, lastModified: now },
    { url: `${SITE_URL}/keeper`, changeFrequency: "daily", priority: 0.5, lastModified: now },
  ];

  /**
   * Best effort, and never fatal.
   *
   * A sitemap that throws is a 500 on a route crawlers fetch unattended. If the chain cannot be
   * read right now the five static routes are still a correct sitemap, just a smaller one.
   */
  try {
    const address = NETWORKS[NETWORK].market;
    if (!address) return stat;
    const [count] = await call(address, hash.getSelectorFromName("market_count"));
    const markets = Number(BigInt(count));
    for (let id = 1; id <= markets; id += 1) {
      stat.push({ url: `${SITE_URL}/m/${id}`, changeFrequency: "monthly", priority: 0.4, lastModified: now });
    }
  } catch {
    /* the static routes are still correct */
  }
  return stat;
}
