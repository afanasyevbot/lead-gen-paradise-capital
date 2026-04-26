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
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Loud during CI/Railway builds so source-map upload failures surface in logs.
  silent: !process.env.CI && !process.env.RAILWAY_ENVIRONMENT,
  disableLogger: true,
});
