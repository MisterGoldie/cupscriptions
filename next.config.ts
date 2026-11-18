import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.CUPSCRIPTIONS_MAINNET_PREVIEW === "1" ? ".next-mainnet"
    : process.env.CUPSCRIPTIONS_SEPOLIA_PREVIEW === "1" ? ".next-sepolia" : ".next",
  outputFileTracingExcludes: {
    "/*": ["./.env*", "./.mainnet/**/*", "./.sepolia/**/*", "./.next-mainnet/**/*", "./.next-sepolia/**/*"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ipfs.io",
        pathname: "/ipfs/**",
      },
      {
        protocol: "https",
        hostname: "dweb.link",
        pathname: "/ipfs/**",
      },
      {
        protocol: "https",
        hostname: "cloudflare-ipfs.com",
        pathname: "/ipfs/**",
      },
      {
        protocol: "https",
        hostname: "gateway.pinata.cloud",
        pathname: "/ipfs/**",
      },
    ],
  },
};

export default nextConfig;
