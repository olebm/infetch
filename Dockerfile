# Infetch — Docker image
#
# Base: node:20-bookworm-slim (no Playwright/Chromium since ENABLE_PORTALS=false).
# If you re-enable portals, switch to mcr.microsoft.com/playwright:v1.50.1-jammy
# and add `RUN npx playwright install --with-deps chromium` before the build step.

FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build.
COPY . .
RUN npm run build

EXPOSE 3000

# db:init is a lightweight Postgres connection check (idempotent).
CMD ["sh", "-c", "npm run db:init && npx next start -H 0.0.0.0 -p 3000"]
