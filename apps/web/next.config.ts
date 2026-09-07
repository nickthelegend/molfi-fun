import type { NextConfig } from "next";

/**
 * Local production builds keep their output away from the dev server's.
 *
 * `next build` and `next dev` both default to `.next`, so building while a dev server is up
 * rewrites the chunks it is serving and every route 500s with "Cannot find module
 * './15.js'" — a message naming a file that exists in no repository. Cost an hour once.
 *
 * Only locally. A build host has no dev server to collide with, and a non-default `distDir`
 * is one more thing for its Next.js builder to have to know about — so on CI the output goes
 * where every tool already expects to find it.
 */
const onAHost = Boolean(process.env.VERCEL || process.env.CI);

/**
 * Headers a wallet-signing app has no business shipping without.
 *
 * Production sent exactly one: Vercel's HSTS. Verified by framing the live site — `/play`
 * loaded inside a cross-origin iframe with no refusal, which on a page whose next click leads
 * to signing a transaction is a clickjacking surface, not a theoretical one.
 *
 * `frame-ancestors 'none'` is the modern control and `X-Frame-Options` the one older browsers
 * obey; both are sent because they are read by different agents. Deliberately **not** a full
 * Content-Security-Policy: this app loads Privy's SDK, a WebGL canvas and Next's inline
 * bootstrap, so a script-src policy written without measuring each of them would either break
 * the product or be so permissive it protects nothing. `frame-ancestors` needs none of that
 * measurement — it constrains who may embed molfi, never what molfi may load.
 *
 * `camera=(), microphone=(), geolocation=(), payment=()` because the desk asks for none of
 * them, and a permission never requested is one that cannot be requested by anything injected.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const config: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  distDir: !onAHost && process.env.NODE_ENV === "production" ? ".next-build" : ".next",
  // The SDK ships TypeScript source so the browser and the contract compile the same pricing
  // code. There is no second implementation to drift.
  transpilePackages: ["@molfi/sdk"],
  eslint: { ignoreDuringBuilds: true },
};

export default config;
