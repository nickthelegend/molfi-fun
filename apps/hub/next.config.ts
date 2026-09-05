import type { NextConfig } from "next";

const config: NextConfig = {
  // The protocol package ships TypeScript source so the browser and the keeper compile the
  // same commitment code — there is no second implementation to drift.
  transpilePackages: ["@molfi/protocol"],
  eslint: { ignoreDuringBuilds: true },
};

export default config;
