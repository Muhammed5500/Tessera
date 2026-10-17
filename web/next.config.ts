import type { NextConfig } from "next";

// Tüm veri tarayıcıda (zincir + agent API) okunduğu için cacheComponents kapalı.
const nextConfig: NextConfig = {
  // Eski sayfalar tek Docs sayfasında birleşti
  async redirects() {
    return [
      { source: "/verify", destination: "/docs#verify", permanent: false },
      { source: "/oracle", destination: "/docs#mcp", permanent: false },
      { source: "/agent", destination: "/docs", permanent: false },
    ];
  },
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
