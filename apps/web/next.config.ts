import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The music-theory package ships TypeScript source, so Next must compile it.
  transpilePackages: ["@interactive-guitar-lab/music-theory"],
  webpack(config) {
    // The engine uses NodeNext-style `.js` specifiers that point at `.ts` files.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
