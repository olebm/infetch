# Infetch — Docker image
#
# Base: node:20-bookworm-slim. Der Portal-Agent (ENABLE_PORTALS=true) braucht einen
# Browser; patchright lädt sein gepatchtes Chromium + die System-Libs im
# `patchright install`-Schritt unten. Für Nicht-Portal-Deploys lässt sich der
# Browser via Build-ARG INSTALL_BROWSER=false weglassen (schlankes Image).

FROM node:20-bookworm-slim

WORKDIR /app

# NEXT_TELEMETRY_DISABLED applies to both build and runtime.
# NODE_ENV is intentionally set AFTER npm ci so that devDependencies
# (tailwindcss, typescript, etc.) are installed — they are required for `next build`.
ENV NEXT_TELEMETRY_DISABLED=1
# SECURITY (INFETCH-274): Browser an einen festen, welt-lesbaren Pfad. Ohne das
# installiert patchright Chromium nach /root/.cache, das der spätere non-root-User
# (anderes $HOME) nicht findet.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Install ALL dependencies (including devDeps needed for the build).
COPY package.json package-lock.json ./
RUN npm ci

# Portal-Agent-Browser: patchrights gepatchtes Chromium + System-Abhängigkeiten.
# Default an (Portale sind das Feature); INSTALL_BROWSER=false überspringt es.
# chmod a+rx: Browser auch für den non-root-User lesbar/ausführbar machen.
ARG INSTALL_BROWSER=true
RUN if [ "$INSTALL_BROWSER" != "false" ]; then \
      npx patchright install --with-deps chromium && \
      chmod -R a+rx /ms-playwright; \
    fi

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

# SECURITY (INFETCH-274): Container nicht als root laufen lassen. Das Base-Image
# bringt den 'node'-User (uid 1000) mit; /app gehört ihm, damit Runtime-Writes
# (./data/invoices, .next/cache) funktionieren.
# HINWEIS Deploy: gemountete Volumes (z. B. Invoice-Storage in Coolify) müssen für
# uid 1000 schreibbar sein, sonst schlägt der Schreibzugriff zur Laufzeit fehl.
RUN chown -R node:node /app
USER node

EXPOSE 3000

# db:init is a lightweight Postgres connection check (idempotent).
CMD ["sh", "-c", "npm run db:init && npx next start -H 0.0.0.0 -p 3000"]
