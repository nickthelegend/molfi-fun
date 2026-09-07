/**
 * The canonical public origin, in one place.
 *
 * robots.txt, the sitemap and the social card all have to agree on it, and a hardcoded string
 * in three files is three chances to disagree after a domain change. Overridable so a preview
 * deployment does not advertise production's URLs as its own.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://molfi.fun").replace(/\/$/, "");
