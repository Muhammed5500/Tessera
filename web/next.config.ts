import type { NextConfig } from "next";

// Tüm veri tarayıcıda (zincir + agent API) okunduğu için cacheComponents kapalı.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
