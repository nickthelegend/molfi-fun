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

const config: NextConfig = {
  distDir: !onAHost && process.env.NODE_ENV === "production" ? ".next-build" : ".next",
  // The SDK ships TypeScript source so the browser and the contract compile the same pricing
  // code. There is no second implementation to drift.
  transpilePackages: ["@molfi/sdk"],
  eslint: { ignoreDuringBuilds: true },
};

export default config;
