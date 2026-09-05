import type { NextConfig } from "next";

const config: NextConfig = {
  // The SDK ships TypeScript source so the browser and the contract compile the same pricing
  // code. There is no second implementation to drift.
  transpilePackages: ["@molfi/sdk"],
  eslint: { ignoreDuringBuilds: true },
};

export default config;
