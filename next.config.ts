import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "playwright"],
  turbopack: {
    resolveAlias: {
      playwright: { browser: "", default: "playwright" },
    },
  },
};

export default nextConfig;
