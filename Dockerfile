# Infetch — Docker image
#
# Base: node:20-bookworm-slim (no Playwright/Chromium since ENABLE_PORTALS=false).
# If you re-enable portals, switch to mcr.microsoft.com/playwright:v1.50.1-jammy
# and add `RUN npx playwright install --with-deps chromium` before the build step.

FROM node:20-bookworm-slim

WORKDIR /app

# NEXT_TELEMETRY_DISABLED applies to both build and runtime.
# NODE_ENV is intentionally set AFTER npm ci so that devDependencies
# (tailwindcss, typescript, etc.) are installed — they are required for `next build`.
ENV NEXT_TELEMETRY_DISABLED=1

# Install ALL dependencies (including devDeps needed for the build).
COPY package.json package-lock.json ./
RUN npm ci

# Sentry Source Maps upload during build (optional — skipped if ARGs not set).
# ARG statt ENV: Werte sind nur während `next build` verfügbar, nicht im finalen Image.
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ARG SENTRY_PROJECT

# Copy source and build.
COPY . .
RUN npm run build

# Switch to production mode for runtime — devDeps are no longer needed.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

EXPOSE 3000

# db:init is a lightweight Postgres connection check (idempotent).
CMD ["sh", "-c", "npm run db:init && npx next start -H 0.0.0.0 -p 3000"]
