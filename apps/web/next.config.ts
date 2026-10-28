import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Shared workspace packages ship TypeScript source, so Next must compile them.
  transpilePackages: ["@interactive-guitar-lab/music-theory", "@interactive-guitar-lab/audio-analysis"],
  webpack(config) {
    // The engine uses NodeNext-style `.js` specifiers that point at `.ts` files.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
