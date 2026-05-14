# Infetch

[![CI](https://github.com/olebm/infetch/actions/workflows/ci.yml/badge.svg)](https://github.com/olebm/infetch/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

Local-first invoice intake for German freelancers — fetches invoices from your mailbox and supplier portals, forwards them to your accountant.

> **Status:** Early access. Used in production by the author. Expect rough edges.

## Why this exists

Freelancers spend hours each month hunting invoices across email, supplier portals, and download links — just to forward them to their accountant. Existing tools (getmyinvoices.com, sevDesk) are cloud-based, expensive, and store your data on someone else's server.

Infetch runs entirely on your machine. It watches your inbox, fetches invoices from supplier portals using AI-recorded browser recipes, and forwards everything to your accountant on a schedule. Your data and credentials never leave your computer.

**Trade-off:** This is a desktop app, not a hosted service. You need to keep it running (or run it in Docker on a home server) for the auto-pilot to work.

## MVP scope (current focus)

This is the **set-and-forget MVP**: scan inbox → extract → forward to accountant. No clicks needed in the happy path.

**In scope (MVP):**
- **IMAP auto-scan** — every 30 minutes, your mailbox is scanned for PDF invoices
- **AI extraction** — Mistral AI reads vendor, date, total, VAT
- **Confidence-based auto-approval** — if all three core fields hit the confidence threshold (default 92%), the invoice goes straight to the export queue. Anything lower lands in review
- **SMTP forwarding** — every 15 minutes, ready invoices are emailed to your accountant (Kontist, Accountable, or a custom address)
- **Manual review UI** — only for low-confidence cases
- **Manual PDF upload** — drop a file when IMAP misses something

**Behind feature flags (not part of MVP, but code is preserved):**
- `ENABLE_PORTALS=true` — Playwright-driven invoice fetching from supplier portals
- `ENABLE_API_INTEGRATIONS=true` — direct API push to lexoffice / sevDesk (instead of SMTP forwarding)
- `ENABLE_COMMUNITY_RECIPES=true` — sync portal recipes from GitHub
- `ENABLE_MISSING_MATRIX=false` — hide the missing-invoice audit matrix

## Install (Docker, recommended)

```bash
git clone https://github.com/olebm/infetch.git
cd infetch
cp .env.example .env
docker-compose up -d
```

Then open http://127.0.0.1:3000 and follow the onboarding wizard.

See [docs/self-hosting.md](docs/self-hosting.md) for backups, DSGVO considerations, and known limitations of containerized credential storage.

## Install (Local Dev)

Requires Node.js 20+ (see `.nvmrc` for the pinned version).

```bash
nvm use
npm install
npm run db:init
npm run dev
```

The app binds to `127.0.0.1:3000` by default. Runtime data is stored under `data/`.

## Configuration

Most settings are configured through the in-app wizard at `/einstellungen`. The wizard auto-detects IMAP/SMTP servers for common providers (Gmail, GMX, Outlook, Hostinger, T-Online, web.de).

For machine-level overrides see [.env.example](.env.example). Credentials (IMAP passwords, portal logins, TOTP secrets) are stored in the OS Keychain on macOS, not in `.env`.

## Architecture

- **Next.js 16** (App Router, Server Actions) + **SQLite** (via better-sqlite3)
- **Playwright** for portal automation
- **Mistral AI** for PDF extraction and portal-recipe recording
- **node-cron** for the in-app auto-pilot (mail scan, missing-check, export-dispatch, portal fetch, community-sync)
- **OS Keychain** for credential storage (macOS native)

All processing is local. Outbound network calls are limited to: your IMAP/SMTP server, the Mistral API (if enabled), and the GitHub raw URL for community-recipe sync.

## Contributing

Three ways to contribute:

1. **Code** — see [CONTRIBUTING.md](CONTRIBUTING.md)
2. **Portal recipes** — if you got a working recipe for a vendor, the in-app "Recipe-Details" drawer has a "Share on GitHub" button. Recipes live in [infetch-recipes](https://github.com/infetch/infetch-recipes)
3. **Translations** — UI is currently German; English is in progress

Bug reports and feature requests via [GitHub Issues](../../issues).

## Security

For sensitive security disclosures, please email **tools@ole-beekmann.de** — do not open a public issue. See [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0-or-later](LICENSE). Network copyleft: if you run a modified version as a service, you must offer the source to your users.

If you want to integrate parts of this project into a closed-source product, please reach out — dual-licensing for specific modules is possible.
