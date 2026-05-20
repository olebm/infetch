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

## Deployment models

Infetch ships in two flavors. Section "Self-hosted limitations" below applies only to the open-source single-user mode; section "Multi-tenant SaaS" applies to the hosted product at `app.infetch.de`.

### Multi-tenant SaaS deployment (`app.infetch.de`)

The hosted product is multi-tenant. Tenant isolation is enforced through several defense layers:

- **`organization_id` on every user-data table.** Invoices, mail accounts, mail messages, credentials, exports, vendors (and their aliases) all carry `organization_id`. Migrations 0010, 0011, 0019, 0020 manage org-scoped RLS policies.
- **Supabase Row-Level Security policies** on all user-data tables. Policies require an `org_members` membership match against `auth.uid()`.
- **Server-side org filters.** Server Actions and API routes that touch user data run on a postgres-superuser connection (via Supavisor) which bypasses RLS — they therefore filter by `organization_id` manually in every query. Defense-in-depth via a `createScopedSql` wrapper migration (Stream D) is in progress; see ESLint allowlist `SQL_CLIENT_ALLOWLIST` in `eslint.config.mjs`.
- **Cross-tenant IDOR regression tests** in `tests/integration/security/cross-tenant-idor.test.ts` and `tests/integration/tenant-isolation*.test.ts` lock in the contract: a user in Org A must never read or modify resources of Org B.

If you find a way to read or modify data across organizations, please report it as described above — that class of bug is highest priority.

### Self-hosted limitations

These design trade-offs apply only when you run Infetch yourself with a single OS user; they are not vulnerabilities in the hosted product:

- **Single-user mode.** The self-hosted reference setup has no concept of multiple tenants. If multiple OS users share the same machine, they share the same data directory unless paths are overridden.
- **Local network exposure.** The app binds to `127.0.0.1:3000` by default. If you change the bind host, anyone on your network can access your invoices.
- **OS Keychain dependency on macOS.** In self-hosted mode credentials are stored via the macOS Keychain. On Linux containers, an env-based fallback is currently planned but not implemented — see [docs/self-hosting.md](docs/self-hosting.md). In the hosted SaaS, credentials live in Supabase Vault (pgsodium).
- **Mistral API exposure.** AI extraction is enabled by default (the product is built around full automation). When it runs, PDF invoices and extracted text are sent to Mistral's servers. You can disable it entirely via `MISTRAL_ENABLED=false` or in `/einstellungen`. Local extraction is always attempted first; Mistral is skipped when the local result is already sufficient. We do not train models on customer data ourselves and do not forward content to third parties for marketing. The Mistral-side training/retention guarantee depends on the active Mistral plan; see [LEGAL_LAWYER_BRIEFING.md](LEGAL_LAWYER_BRIEFING.md) for the documented subprocessor agreement.

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
