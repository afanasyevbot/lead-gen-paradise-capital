FROM node:20-slim AS base

# Install Playwright system dependencies
RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libwayland-client0 \
    fonts-liberation fonts-noto-color-emoji \
    ca-certificates wget curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Dependencies ──────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# Install Playwright browsers (Chromium only)
RUN npx playwright install chromium

# ── Build ─────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Sentry source-map upload runs at build time. Declare ARGs so Railway passes
# the service variables into the build, then promote to ENV so the @sentry/nextjs
# plugin invoked by `next build` can read them and upload sourcemaps.
ARG SENTRY_DSN
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_AUTH_TOKEN
ENV SENTRY_DSN=$SENTRY_DSN \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT \
    SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN

ENV NEXT_TELEMETRY_DISABLED=1

# Capture the Railway commit SHA as the Sentry release tag so build-time
# source-map upload and runtime error reports tag the same release.
ARG RAILWAY_GIT_COMMIT_SHA
ENV SENTRY_RELEASE=$RAILWAY_GIT_COMMIT_SHA

RUN npm run build

# Source-map upload via sentry-cli (bundler-agnostic; works with Turbopack,
# which @sentry/nextjs's webpack plugin doesn't). Skipped automatically when
# auth/org/project aren't set so local Docker builds keep working.
RUN if [ -n "$SENTRY_AUTH_TOKEN" ] && [ -n "$SENTRY_ORG" ] && [ -n "$SENTRY_PROJECT" ] && [ -n "$SENTRY_RELEASE" ]; then \
      npx --yes @sentry/cli@latest sourcemaps inject .next && \
      npx --yes @sentry/cli@latest sourcemaps upload --release="$SENTRY_RELEASE" .next && \
      npx --yes @sentry/cli@latest releases finalize "$SENTRY_RELEASE"; \
    else \
      echo "Sentry vars missing — skipping source-map upload"; \
    fi

# ── Production ────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

# Forward Sentry runtime config so the SDK tags errors with the same release
# we just uploaded source maps for. DSN is required at runtime to send events.
ARG SENTRY_DSN
ARG RAILWAY_GIT_COMMIT_SHA
ENV SENTRY_DSN=$SENTRY_DSN \
    SENTRY_RELEASE=$RAILWAY_GIT_COMMIT_SHA

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy standalone build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy standalone cron/admin scripts (used by the weekly-report Railway cron
# service — does not affect the main app's start command).
COPY --from=builder /app/scripts ./scripts

# Copy Playwright browsers from deps stage
COPY --from=deps /root/.cache/ms-playwright /root/.cache/ms-playwright

# Copy node_modules for better-sqlite3 native bindings + playwright
COPY --from=deps /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=deps /app/node_modules/bindings ./node_modules/bindings
COPY --from=deps /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
COPY --from=deps /app/node_modules/playwright ./node_modules/playwright
COPY --from=deps /app/node_modules/playwright-core ./node_modules/playwright-core

# Data directory — mount a persistent volume here
RUN mkdir -p /data
ENV DATABASE_PATH=/data/paradise_leads.db

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
