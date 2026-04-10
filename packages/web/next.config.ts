import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Avoid Turbopack bundling viem/@noble into server chunks (runtime errors in sha3).
  serverExternalPackages: [
    "@poc/buyer",
    "viem",
    "@noble/hashes",
    "@noble/curves",
    "@coinbase/agentkit",
    "@ampersend_ai/ampersend-sdk",
  ],
};

export default nextConfig;
