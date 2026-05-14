# Invoice Agent — Docker image
#
# Self-hosting trade-offs:
#   - This image uses the Playwright runtime so the portal-agent can drive Chromium.
#   - The macOS Keychain is not available in Linux containers. Until a libsecret /
#     env-encrypted fallback is implemented, configure secrets via env vars (Mistral
#     API key) and accept that IMAP/SMTP credentials cannot be stored persistently.
#   - Single-stage build keeps the image straightforward at the cost of size.

FROM mcr.microsoft.com/playwright:v1.50.1-jammy

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

# Runtime data lives here — mount a volume to persist across container restarts.
RUN mkdir -p data/invoices data/raw-text data/sessions data/ai-cache data/logs \
    && chown -R pwuser:pwuser /app

USER pwuser

EXPOSE 3000

# init-db is idempotent and only seeds if tables are missing.
CMD ["sh", "-c", "npm run db:init && npx next start -H 0.0.0.0 -p 3000"]
