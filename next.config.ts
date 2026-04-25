import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "playwright"],
  turbopack: {
    resolveAlias: {
      playwright: { browser: "", default: "playwright" },
    },
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  // org/project filled in via SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN env vars
});
