import type { NextConfig } from "next";

/**
 * Dev and production builds keep their output apart.
 *
 * `next build` and `next dev` both default to `.next`, so running a build while a dev server
 * is up rewrites the chunks that server is still serving. Every route then 500s with
 * "Cannot find module './15.js'" — a message that points at nothing, since the file it names
 * is a build artifact rather than anything in the repo. Cost an hour once; two directories
 * cost nothing.
 */
const config: NextConfig = {
  distDir: process.env.NODE_ENV === "production" ? ".next-build" : ".next",
  // The SDK ships TypeScript source so the browser and the contract compile the same pricing
  // code. There is no second implementation to drift.
  transpilePackages: ["@molfi/sdk"],
  eslint: { ignoreDuringBuilds: true },
};

export default config;
