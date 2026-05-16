# Security Policy

## Reporting a vulnerability

If you find a security issue, **please do not open a public GitHub issue**.

Email **tools@ole-beekmann.de** with:

- A description of the vulnerability
- Steps to reproduce
- The impact (what an attacker could do)
- (Optional) A suggested fix

You can expect:

- Acknowledgement within 72 hours
- A coordinated disclosure timeline (default: 90 days from acknowledgement)
- Credit in the release notes once a fix is shipped, unless you prefer to remain anonymous

## Scope

In scope:

- The Infetch application (`src/`)
- Database schema and migrations (`src/lib/db/`)
- Credential handling (`src/lib/secrets/`)
- Portal agent and recipe execution (`src/portals/agent/`)
- IMAP/SMTP integration
- Docker image (once published)

Out of scope:

- Vulnerabilities in third-party dependencies (please report those upstream — `npm audit` is run regularly)
- Issues that require physical access to the machine running Infetch
- Issues in browser-extension companions or external tools that integrate with Infetch

## Known limitations

Some of these are documented design trade-offs rather than vulnerabilities. They are listed here so you don't waste time reporting them:

- **Single-user model.** Infetch has no concept of multiple users or tenants. If multiple OS users share the same machine, they share the same data directory unless paths are overridden.
- **Local network exposure.** The app binds to `127.0.0.1:3000` by default. If you change the bind host, anyone on your network can access your invoices.
- **OS Keychain dependency on macOS.** Credentials are stored via the macOS Keychain. On Linux containers, an env-based fallback is currently planned but not implemented — see [docs/self-hosting.md](docs/self-hosting.md).
- **Mistral API exposure.** AI extraction is enabled by default (the product is built around full automation). When it runs, PDF invoices and extracted text are sent to Mistral's servers. You can disable it entirely via `MISTRAL_ENABLED=false` or in `/einstellungen`. Local extraction is always attempted first; Mistral is skipped when the local result is already sufficient.

## Production deployment notes

For self-hosted multi-tenant deployments (e.g. `app.infetch.de`), set:

- `NEXT_PUBLIC_APP_URL` — fully-qualified base URL. Without it, Stripe checkout/portal
  redirects fall back to a Host-header allowlist; explicitly setting this env removes
  any chance of Host-header injection.
- `AI_PROXY_TOKEN` — required in production. Without it the AI extract endpoint
  returns 503 (no anonymous Mistral access on the operator's bill).
- `CRON_SECRET` — required in production for `/api/cron/*` endpoints.
- `STRIPE_WEBHOOK_SECRET`, `SENTRY_WEBHOOK_SECRET` — verify incoming webhooks.
- `ENABLE_TEST_LOGIN` must remain unset (and `NODE_ENV=production` blocks it
  even if accidentally set).

## Supported versions

This is early-access software. Security fixes are applied to the latest `main` branch only. Once we tag a stable `1.0`, we will document a longer support window.

## Data minimization

- **IMAP scanning is attachment-scoped.** The scanner first fetches only the
  `BODYSTRUCTURE` of each INBOX message and downloads the full message body
  *only* for mails that actually contain a PDF attachment. Mails without an
  attachment are never downloaded or parsed. If a server does not return a
  body structure, the scanner falls back to a full fetch so no invoice is lost.
- **Retention.** Mail-scan metadata (`mail_messages`: sender, subject, date) is
  purged after `RETENTION_MAIL_METADATA_MONTHS` (default 12) via the
  `/api/cron/retention` job. Invoices themselves are not auto-deleted.

## Cryptographic notes

- TOTP secrets are stored in the OS Keychain.
- Credentials (IMAP/SMTP passwords, API tokens) are stored in Supabase Vault
  (pgsodium) or the OS Keychain — never in application tables in plaintext.
- **At-rest encryption.** All Storage objects (invoice PDFs, extracted raw
  text, portal sessions) are encrypted with AES-256-GCM before upload. The
  master key lives in Supabase Vault. Objects written before this feature are
  detected by a missing envelope header and read back transparently.
- HTTPS is used for all outbound API calls (Mistral, IMAP/SMTP over TLS).
- We do not implement custom cryptography. Where we need crypto, we use
  battle-tested primitives (`node:crypto` AES-256-GCM, `otplib` for TOTP,
  Supabase Vault/pgsodium, OS-provided TLS).

## Acknowledgments

We will list responsible reporters here as fixes are shipped.
