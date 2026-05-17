# Infetch — Core Architecture

Everything needed to port the core functionality to a new project.

---

## Table of Contents

1. [Overview](#overview)
2. [Tech Stack](#tech-stack)
3. [Database Schema](#database-schema)
4. [Environment Variables](#environment-variables)
5. [Authentication & Session](#authentication--session)
6. [Routing & Middleware](#routing--middleware)
7. [Core Flows](#core-flows)
   - [Mail Scanning](#mail-scanning)
   - [Invoice Import Pipeline](#invoice-import-pipeline)
   - [Vendor Matching](#vendor-matching)
   - [AI Extraction](#ai-extraction)
   - [Auto-Approval Engine](#auto-approval-engine)
   - [Export Pipeline](#export-pipeline)
   - [Auto-Transfer (API Integrations)](#auto-transfer)
8. [Credential & Secret Store](#credential--secret-store)
9. [Tier & Quota System](#tier--quota-system)
10. [Onboarding Flow](#onboarding-flow)
11. [Security Model (Multi-Tenancy)](#security-model)
12. [Mail Provider Configuration](#mail-provider-configuration)
13. [Background Automation](#background-automation)
14. [File Structure Reference](#file-structure-reference)
15. [Critical Implementation Notes](#critical-implementation-notes)

---

## Overview

Infetch is a multi-tenant SaaS that:
1. Connects to a user's IMAP mailbox
2. Scans incoming emails for PDF invoice attachments
3. Extracts structured data (vendor, amount, date) via regex + LLM
4. Matches PDFs to known vendors
5. Auto-approves high-confidence invoices
6. Forwards invoices via SMTP to accounting targets (Kontist, Accountable, Lexoffice, sevDesk)

**Key design decisions:**
- Next.js 16 App Router — server actions for all mutations, no separate API layer for the main app
- Supabase for auth (magic link) + Postgres (direct SQL, no ORM) + Storage (PDF files)
- Row-Level Security on all tables; backend uses service_role (RLS bypassed, explicit org scoping)
- Secrets stored in Supabase Vault (pgsodium) or macOS Keychain — never in the DB in plaintext

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack dev) |
| Language | TypeScript 5.7 |
| Database | PostgreSQL via Supabase (`postgres` tagged-template client) |
| Auth | Supabase Auth (magic link / OTP), `@supabase/ssr` cookie sessions |
| File Storage | Supabase Storage (S3-compatible) |
| Secret Storage | Supabase Vault (pgsodium) + macOS Keychain fallback |
| IMAP | imapflow 1.0 |
| SMTP | nodemailer 8 |
| Email Parsing | mailparser |
| PDF Text | pdf-parse, pdfjs-dist |
| AI Extraction | Mistral (`mistral-small-latest`) |
| Billing | Stripe |
| Scheduling | node-cron |
| Styling | Tailwind CSS |
| Notifications | Brevo (transactional email) |
| Error Tracking | Sentry |
| Testing | Vitest + Playwright |

---

## Database Schema

### Tables (defined in migration 0001)

```sql
-- Users & Organisations
users (id UUID PK, email TEXT UNIQUE, name TEXT, supabase_uid UUID UNIQUE,
       created_at, updated_at)

organizations (id UUID PK, name TEXT, tier TEXT DEFAULT 'free'
               CHECK(tier IN ('free','pro','business')),
               stripe_customer_id TEXT,
               stripe_event_ts BIGINT,  -- anti-replay for webhook ordering
               created_at, updated_at)

org_members (id BIGSERIAL PK, user_id UUID → users, organization_id UUID → organizations,
             role TEXT DEFAULT 'member' CHECK(role IN ('owner','member','viewer')),
             created_at)
```

```sql
-- Vendor Domain Model
vendors (id BIGSERIAL PK, name TEXT NOT NULL, canonical_key TEXT UNIQUE NOT NULL,
         website TEXT, logo_url TEXT, hidden BOOLEAN DEFAULT FALSE,
         organization_id UUID → organizations,  -- NULL = global seed
         created_at, updated_at)

vendor_aliases (id BIGSERIAL PK, vendor_id BIGINT → vendors, alias TEXT NOT NULL,
                match_type TEXT CHECK(match_type IN ('exact','contains','domain','regex')),
                priority INTEGER DEFAULT 100,  -- lower = higher priority
                created_at)
-- INDEX: (alias, match_type)
```

```sql
-- Mail Infrastructure
mail_accounts (id BIGSERIAL PK, label TEXT NOT NULL,
               host TEXT, port INTEGER, secure BOOLEAN,
               username TEXT, credential_ref_id BIGINT → credential_refs,
               status TEXT DEFAULT 'pending' CHECK(status IN ('pending','configured','invalid')),
               last_verified_at TIMESTAMPTZ,
               organization_id UUID → organizations,
               created_at, updated_at)
-- UNIQUE: (organization_id, label) WHERE org IS NOT NULL

mail_messages (id BIGSERIAL PK, mail_account_id BIGINT → mail_accounts,
               mailbox TEXT DEFAULT 'INBOX', uid BIGINT NOT NULL,
               uidvalidity BIGINT, message_id TEXT,
               subject TEXT, sender_email TEXT, sender_domain TEXT,
               received_at TIMESTAMPTZ, processed_at TIMESTAMPTZ,
               created_at)
-- UNIQUE: (mail_account_id, mailbox, uid, uidvalidity)
```

```sql
-- Invoice Core
invoices (id BIGSERIAL PK, vendor_id BIGINT → vendors,
          invoice_number TEXT, invoice_date DATE,
          amount_net NUMERIC(12,2), amount_gross NUMERIC(12,2), amount_vat NUMERIC(12,2),
          currency TEXT DEFAULT 'EUR',
          status TEXT DEFAULT 'new'
            CHECK(status IN ('new','needs_review','ready','exported','ignored','duplicate','failed')),
          source_type TEXT CHECK(source_type IN ('manual','mail','portal')),
          source_ref_id TEXT,   -- mail_message.id or portal_session.id
          dedup_key TEXT UNIQUE,  -- SHA256 of PDF for deduplication
          confidence NUMERIC(4,3),  -- 0.000–1.000
          ai_extraction_id BIGINT → ai_extractions,
          external_ref TEXT,         -- Lexoffice doc id, sevDesk voucher id, etc.
          external_ref_provider TEXT,
          is_private BOOLEAN DEFAULT FALSE,
          organization_id UUID → organizations,
          raw_text_path TEXT,   -- Supabase Storage key for extracted text
          created_at, updated_at)
-- INDEX: (organization_id, created_at DESC) for quota queries

invoice_files (id BIGSERIAL PK, invoice_id BIGINT → invoices,
               original_filename TEXT, stored_path TEXT,  -- Supabase Storage key
               mime_type TEXT, size_bytes BIGINT,
               sha256 TEXT UNIQUE,  -- deduplication key
               created_at)
```

```sql
-- Discovered Senders (auto-learning from IMAP)
discovered_senders (id BIGSERIAL PK, organization_id UUID → organizations,
                    from_address TEXT NOT NULL, from_domain TEXT NOT NULL,
                    display_name TEXT,
                    mail_count INTEGER DEFAULT 0,
                    pdf_count INTEGER DEFAULT 0,
                    invoice_count INTEGER DEFAULT 0,
                    blocked BOOLEAN DEFAULT FALSE,
                    vendor_id BIGINT → vendors,
                    matched_vendor_name TEXT,
                    first_seen_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ,
                    created_at, updated_at)
-- UNIQUE: (organization_id, from_address)
```

```sql
-- AI & Extraction
ai_extractions (id BIGSERIAL PK, invoice_id BIGINT → invoices,
                input_hash TEXT,   -- SHA256 of prompt input for caching
                model TEXT, prompt_version TEXT,
                raw_response JSONB,
                vendor_name TEXT, invoice_number TEXT, invoice_date TEXT,
                amount_net NUMERIC, amount_gross NUMERIC, amount_vat NUMERIC, currency TEXT,
                confidence NUMERIC(4,3),
                field_confidences JSONB,  -- {vendor: 0.95, date: 0.90, amount: 0.88}
                needs_review BOOLEAN,
                tokens_used INTEGER, cost_cents INTEGER,
                created_at)
```

```sql
-- Export & Accounting
export_targets (id BIGSERIAL PK, organization_id UUID → organizations,
                target TEXT CHECK(target IN ('kontist','accountable')),
                label TEXT, recipient_email TEXT,
                smtp_slot TEXT DEFAULT 'primary',
                enabled BOOLEAN DEFAULT TRUE,
                created_at, updated_at)
-- UNIQUE: (organization_id, target)

exports (id BIGSERIAL PK, invoice_id BIGINT → invoices,
         export_target_id BIGINT → export_targets,
         status TEXT DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
         error_message TEXT,
         sent_at TIMESTAMPTZ, created_at, updated_at)

integration_targets (id BIGSERIAL PK, organization_id UUID → organizations,
                     provider TEXT CHECK(provider IN ('lexoffice','sevdesk','datev','xero','candis')),
                     label TEXT, enabled BOOLEAN DEFAULT FALSE,
                     external_account_id TEXT,
                     last_verified_at TIMESTAMPTZ,
                     created_at, updated_at)
-- UNIQUE: (organization_id, provider)
```

```sql
-- Credentials
credential_refs (id BIGSERIAL PK, scope TEXT NOT NULL, owner_id TEXT DEFAULT 'primary',
                 organization_id UUID → organizations,
                 secret_ref TEXT UNIQUE NOT NULL,  -- Vault/Keychain key
                 label TEXT,
                 status TEXT DEFAULT 'pending' CHECK(status IN ('pending','configured','invalid')),
                 last_verified_at TIMESTAMPTZ,
                 created_at, updated_at)
```

```sql
-- Auto-Approval
auto_approval_rules (id BIGSERIAL PK, organization_id UUID → organizations,
                     vendor_id BIGINT → vendors,
                     vendor_pattern TEXT,   -- fallback LIKE match on vendor name
                     max_amount_cents INTEGER,  -- approve if amount ≤ this
                     confidence_threshold NUMERIC(4,3) DEFAULT 0.90,
                     enabled BOOLEAN DEFAULT TRUE,
                     created_at, updated_at)

vendor_month_status (id BIGSERIAL PK, vendor_id BIGINT → vendors,
                     organization_id UUID → organizations,
                     year INTEGER, month INTEGER,
                     status TEXT,     -- 'ok','missing','late','on_schedule'
                     source TEXT,     -- 'mail','portal','manual'
                     invoice_count INTEGER DEFAULT 0,
                     created_at, updated_at)
-- UNIQUE: (vendor_id, organization_id, year, month)
```

```sql
-- Sync & Audit
sync_runs (id BIGSERIAL PK, run_type TEXT, status TEXT,
           started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ,
           messages_seen INTEGER, messages_processed INTEGER,
           invoices_imported INTEGER, invoices_failed INTEGER,
           organization_id UUID, created_at)

sync_events (id BIGSERIAL PK, sync_run_id BIGINT → sync_runs,
             level TEXT CHECK(level IN ('info','warning','error')),
             event_type TEXT, message TEXT, metadata JSONB,
             organization_id UUID, created_at)

settings (id BIGSERIAL PK, organization_id UUID → organizations,
          key TEXT NOT NULL, value JSONB,
          created_at, updated_at)
-- UNIQUE: (organization_id, key)
```

```sql
-- Stripe Idempotency
stripe_processed_events (id BIGSERIAL PK, event_id TEXT UNIQUE,
                          processed_at TIMESTAMPTZ DEFAULT NOW())
-- Webhook events purged after 30 days
```

### Key Migrations

| Migration | Purpose |
|---|---|
| 0002 | Enable `pgsodium` extension (Supabase Vault) |
| 0010 | Row-Level Security on all 25 tables |
| 0011 | **SECURITY**: Remove NULL org-id bypass from credential_refs, mail_accounts, invoices, exports |
| 0012 | UNIQUE (org_id, label) on mail_accounts — prevent cross-org label collision |
| 0013 | **SECURITY**: Scope export_targets per org (was globally shared) |
| 0016 | Stripe idempotency table |
| 0017 | Convert integration_targets.enabled: INTEGER → BOOLEAN |
| 0018 | Add stripe_event_ts to prevent out-of-order webhook replay |

---

## Environment Variables

All config is centralised in `src/lib/config/env.ts` as a single `appConfig` object.

```bash
# ── Storage paths (server-side, relative to cwd) ──────────────────────────
INVOICE_STORAGE_PATH=./data/invoices      # PDF binary cache
RAW_TEXT_STORAGE_PATH=./data/raw-text     # Extracted invoice text
PORTAL_STORAGE_PATH=./data/sessions       # Playwright browser state
AI_CACHE_STORAGE_PATH=./data/ai-cache     # Mistral response cache
SYNC_MONTHS_BACK=6                        # IMAP lookback months (Pro/Business)

# ── Supabase ───────────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=                # Bypasses RLS — keep secret

# ── Mistral AI ─────────────────────────────────────────────────────────────
MISTRAL_API_KEY=
MISTRAL_ENABLED=true
MISTRAL_MODEL=mistral-small-latest
MISTRAL_SEND_PDF_BINARY=false             # Send raw PDF vs extracted text

# ── Stripe Billing ─────────────────────────────────────────────────────────
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PRICE_ID_PRO=
NEXT_PUBLIC_STRIPE_PRICE_ID_BUSINESS=

# ── Brevo (transactional email) ────────────────────────────────────────────
BREVO_API_KEY=
BREVO_FROM_EMAIL=noreply@yourdomain.com
BREVO_FROM_NAME=YourApp

# ── Sentry ─────────────────────────────────────────────────────────────────
SENTRY_DSN=
SENTRY_WEBHOOK_SECRET=
NEXT_PUBLIC_SENTRY_DSN=

# ── Feature Flags ──────────────────────────────────────────────────────────
ENABLE_PORTALS=false                      # Browser automation / portal agent
ENABLE_INBOUND_MAIL=false                 # Inbound email forwarding
ENABLE_API_INTEGRATIONS=false             # Lexoffice / sevDesk auto-push
ENABLE_COMMUNITY_RECIPES=false            # Shared portal recipes

# ── Automation ─────────────────────────────────────────────────────────────
AUTO_PILOT_ENABLED=true
AUTO_APPROVE_CONFIDENCE=0.90              # Threshold for auto-approval (0–1)
SELF_PROVISION_MIN_IMPORTS=3              # Imports before creating approval rule
SELF_PROVISION_AMOUNT_MULTIPLIER=1.5      # Rule max = historical max × multiplier
CLEANUP_IGNORED_AFTER_DAYS=30             # Delete files for ignored invoices
STUCK_ESCALATION_AFTER_DAYS=30           # Escalate old needs_review → ignored

# ── Cron Jobs ──────────────────────────────────────────────────────────────
CRON_SECRET=                              # Bearer token for /api/cron/* endpoints

# ── Misc ───────────────────────────────────────────────────────────────────
INVOICE_AGENT_TIER=free                   # Override org tier (dev/test only)
NEXT_PUBLIC_APP_URL=https://app.yourdomain.com
NEXT_PUBLIC_LANDING_URL=https://yourdomain.com
```

---

## Authentication & Session

**Magic link flow** (Supabase Auth):

1. User enters email on `/login` → `supabase.auth.signInWithOtp({ email })`
2. Supabase sends magic link → user clicks → redirected to `/auth/callback?code=xxx`
3. Callback handler exchanges code: `supabase.auth.exchangeCodeForSession(code)`
4. **New user detection**: Query `users` table by email
   - **Not found** → `createUserWithDefaultOrg()` (creates user + org + seeds export targets)
   - **Invited** (metadata has `invited_org_id`) → `createUserAndJoinOrg()` (joins existing org)
   - **Existing** → no-op, redirect to next param
5. New users redirect directly to `/onboarding`; existing users to `next` or `/`

**Session management**: `@supabase/ssr` stores JWT in cookies. `updateSupabaseSession()` runs in proxy middleware on every request to refresh tokens.

**Server-side auth helpers** (`src/lib/auth/current.ts`):
```typescript
getCurrentAuth()     // → { user, organization } | null — never throws
requireCurrentAuth() // → { user, organization } — throws redirect to /login
```

**Critical**: `redirect()` from `next/navigation` throws `NEXT_REDIRECT`. Never call `requireCurrentAuth()` inside a `try/catch` block.

---

## Routing & Middleware

Next.js 16 uses `src/proxy.ts` (not `middleware.ts`).

**Hostname routing:**
```
yourdomain.com        → /landingpage (rewrite)
app.yourdomain.com    → full app
localhost / *.vercel  → full app
```

**Auth gate**: Every app path except:
- `/login`, `/auth/*`, `/api/test/*`, `/onboarding*`, `/api/stripe/webhook`, `/api/cron/*`

**Reverse proxy / Docker**: Use `x-forwarded-host` and `x-forwarded-proto` headers — never `request.url` (points to `http://0.0.0.0:3000` internally):
```typescript
const proto    = request.headers.get("x-forwarded-proto") ?? "https";
const hostname = request.headers.get("x-forwarded-host")  ?? request.nextUrl.hostname;
const loginUrl = new URL(`${proto}://${hostname}/login`);
```

**App layout gate** (`src/app/(app)/layout.tsx`): Redirects to `/onboarding` if no `Primary IMAP` mail_account exists for the org.

---

## Core Flows

### Mail Scanning

**Entry point**: `runPrimaryImapScan()` in `src/mail/mail-scanner.ts`

**Trigger**: Every 5 min via node-cron, or manual via settings button.

```
1. Acquire PostgreSQL advisory lock (prevents concurrent scans)
2. Determine lookback window:
   - Free: first day of current month
   - Pro/Business: today − SYNC_MONTHS_BACK months
3. For each configured mail_account (primary, secondary):
   a. PHASE 1 — Fetch BODYSTRUCTURE only (no content, bandwidth-efficient)
      Filter UIDs to those with PDF-capable MIME types
   b. PHASE 2 — Full fetch (envelope + source) for qualifying UIDs only
   c. For each message:
      - Parse attachments (mailparser)
      - Upsert mail_messages (idempotent via UNIQUE uid+mailbox)
      - Skip if already processed_at
      - Check sender block list
      - For each PDF attachment → importPdfBuffer()
      - Check monthly quota (stop importing if exceeded, don't mark processed)
4. Release advisory lock
5. Write sync_run record with counts
```

**Idempotency guarantee**: If quota is hit mid-scan, those messages are NOT marked as processed, so they'll be picked up next month with fresh quota.

### Invoice Import Pipeline

**Entry point**: `importPdfBuffer(input)` in `src/invoices/import-pipeline.ts`

```
Input: { buffer, originalFilename, sourceType, organizationId, ... }

1. VALIDATE
   - PDF magic bytes (not just extension check)
   - Max 20 MB
   - Org monthly invoice quota (getMonthlyImportCount)
   - Org storage quota (getStorageUsageBytes + fileSizeBytes)
   → If near limit: send upgrade nudge email (rate-limited, 1× per 7 days)

2. DEDUPLICATE
   - SHA256(buffer) → check invoice_files.sha256 unique index
   → If exists: return { status: "duplicate", invoiceId, fileId }

3. EXTRACT TEXT (local, pdfjs)
   - Extract text from PDF pages
   - Calculate local confidence score:
     - Vendor matched → +0.90 (domain/exact) or +0.72 (contains)
     - Invoice date found → +0.03
     - Amount found → +0.03
     - Invoice number → +0.02
     - Text length > 50 chars → +0.02
     - Extraction error → −0.20
   - Clamp to [0.000, 0.980]

4. MATCH VENDOR
   - matchVendor([filename, extractedText]) → { vendorId, vendorName, confidence }

5. JUNK FILTER
   - Check filename against known non-invoice patterns
   → If junk: force status="ignored", skip AI

6. DETERMINE INITIAL STATUS
   - All core fields (vendor + date + amount) → "ready"
   - Otherwise → "needs_review"

7. STORE FILES (Supabase Storage)
   - PDF → invoices/[orgId]/[vendorKey]/[year-month]/[filename]
   - Text → raw-text/[sha256].txt
   (Rollback: delete both if DB insert fails)

8. INSERT DB (transaction)
   - invoices row (status, confidence, source_type, ...)
   - invoice_files row (sha256, stored_path, size_bytes)
   - UPSERT vendor_month_status (track monthly sourcing per vendor)

9. AI EXTRACTION (Mistral)
   - Skip if: junk, no text (<20 chars), or local extraction already sufficient
   - runInvoiceAiExtraction(invoiceId, extractedText, preExtractedFields)
   - Updates invoice: vendor, date, amounts, confidence, ai_extraction_id
   - Re-evaluates status

10. AUTO-APPROVAL
    - evaluateAutoApproval(extraction, resolved)
    → If approved: update status="ready"

11. AUTO-TRANSFER (if ENABLE_API_INTEGRATIONS)
    - If status="ready" + integration_targets.enabled
    → Push to Lexoffice/sevDesk, store external_ref, status="exported"

12. NOTIFY
    - If final status="needs_review" → email org owner

Return: { ok: true, status, invoiceId, fileId, message }
```

### Vendor Matching

**Entry point**: `matchVendor(signals)` in `src/vendors/matcher.ts`

```typescript
// signals: array of strings to search in (filename, extracted text)
// Returns: { vendorId, vendorName, canonicalKey, confidence }
```

**Algorithm:**
```
1. Join all signals, lowercase
2. Query all vendor_aliases ORDER BY priority ASC, length(alias) DESC
3. For each alias:
   - exact:    word-boundary token match → confidence 0.90
   - contains: substring match           → confidence 0.72
   - domain:   substring match           → confidence 0.90
   - regex:    RegExp test               → confidence 0.72
4. Best match: highest confidence first, priority as tie-breaker
```

**Vendor aliases** are learned automatically from manual corrections (`src/vendors/auto-alias.ts`) — when a user manually assigns a vendor, the sender domain is saved as a new alias.

### AI Extraction

**Entry point**: `runInvoiceAiExtraction()` in `src/ai/extract-invoice.ts`

**Input caching**: SHA256(prompt_input) → check ai_extractions for existing result (avoid duplicate API calls).

**Prompt**: Sends extracted text (or raw PDF binary if `MISTRAL_SEND_PDF_BINARY=true`) with structured output schema:
```typescript
{
  vendor_name: string,
  invoice_number: string,
  invoice_date: string,      // ISO 8601
  amount_net: number,
  amount_gross: number,
  amount_vat: number,
  currency: string,
  confidence: number,        // 0–1 overall
  field_confidences: {       // per-field breakdown
    vendor: number,
    date: number,
    amount: number,
    invoice_number: number
  },
  needs_review: boolean      // AI flags uncertainty
}
```

**Cost tracking**: Tokens used + estimated cents stored in ai_extractions.

### Auto-Approval Engine

**Entry point**: `evaluateAutoApproval()` in `src/lib/automation/auto-approval.ts`

```
Two approval paths:

PATH 1 — High Confidence (Auto-Pilot):
  Requirements:
  - All core fields present (vendor + date + amount)
  - AI did not flag needs_review=true
  - Per-field confidences OR overall confidence ≥ threshold (default 0.90)
  Result: { autoApproved: true, via: "high_confidence" }

PATH 2 — Per-Vendor Rule:
  Requirements:
  - Per-field confidences ≥ 0.95
  - Matching auto_approval_rule (by vendor_id OR vendor_pattern LIKE name)
  - amount ≤ rule.max_amount_cents
  Result: { autoApproved: true, via: "rule", ruleId }

Both paths: update invoice status → "ready"
```

**Self-provisioning rules** (`src/lib/automation/self-provisioning.ts`): After `SELF_PROVISION_MIN_IMPORTS` (default 3) successful imports from the same vendor, automatically creates an auto_approval_rule with:
- `max_amount_cents = max_historical_amount × SELF_PROVISION_AMOUNT_MULTIPLIER`

### Export Pipeline

**Entry point**: `dispatchPendingExports()` in `src/exports/export-pipeline.ts`

**Triggered**: Every 5 min by cron, or manual dispatch button.

```
PHASE 1 — Enqueue:
  INSERT INTO exports (invoice_id, export_target_id, status='pending')
  SELECT invoices ready for export, cross-joined with enabled export_targets
  WHERE invoices.organization_id = export_targets.organization_id  ← CRITICAL: same org only

PHASE 2 — Dispatch:
  For each pending export:
  1. Tier check: canExport(orgId) → Pro/Business only
  2. Download PDF from Supabase Storage
  3. sendInvoiceMail(options) via SMTP
     - From: SMTP slot account (primary or secondary)
     - To: export_target.recipient_email
     - Subject: "Rechnung [vendor] · [date] · [amount]"
     - Attachment: PDF
  4. UPDATE exports.status = 'sent', exports.sent_at = NOW()
  5. UPDATE invoices.status = 'exported'
```

**Export targets** (default setup in onboarding):
- Kontist: `receipts@kontist.com`
- Accountable: `expenses@accountable.eu`
- Lexoffice: user-specific `inbox.lexware.email` address
- sevDesk: `autobox@sevdesk.email`

### Auto-Transfer

**API integrations** (separate from SMTP export): Direct API push to Lexoffice or sevDesk.

**Entry point**: `attemptAutoTransfer()` in `src/lib/automation/auto-transfer.ts`

```
Conditions:
- ENABLE_API_INTEGRATIONS=true
- invoice.status = 'ready'
- No prior external_ref (idempotent)
- integration_targets row enabled for org

Process:
1. Load invoice + files
2. Download PDF from Supabase Storage
3. Push to provider API:
   - Lexoffice: POST /v1/vouchers/files/upload
   - sevDesk: POST /Contact (temp file) → POST /Voucher
4. Store external_ref + external_ref_provider on invoice
5. UPDATE invoice.status = 'exported'
6. Log sync_event
```

---

## Credential & Secret Store

**Scopes**: `imap | smtp | portal | mistral | totp | lexoffice | sevdesk | datev`

**Secret ref construction**:
```
"invoice-agent:{scope}:{sha256(scope:orgId?:ownerId).slice(0,16)}"
```

**Storage priority**:
1. macOS Keychain (if available)
2. Supabase Vault (`pgsodium.create_key` + `vault.secrets`)
3. Env var override (MISTRAL_API_KEY only)

**Core API** (`src/lib/secrets/credential-store.ts`):
```typescript
saveCredentialSecret({ scope, ownerId?, organizationId?, label, secret })
readCredentialSecret({ scope, ownerId?, organizationId? })
deleteCredentialSecret({ scope, ownerId?, organizationId? })
hasConfiguredCredential(scope, ownerId?, organizationId?)
updateCredentialVerificationStatus({ scope, ownerId?, organizationId?, status })
```

**credential_refs** table tracks metadata (status, last_verified_at) separately from the secret value itself.

---

## Tier & Quota System

**Tiers**: `free | pro | business`

| Limit | Free | Pro | Business |
|---|---|---|---|
| Invoices / month | 15 | 150 | ∞ |
| Mail accounts | 1 | 3 | ∞ |
| Team members | 1 | 3 | ∞ |
| Storage | 500 MB | 2 GB | 50 GB |
| Export to accounting | ✗ | ✓ | ✓ |
| Retroactive 12m scan | ✗ | ✓ | ✓ |
| Bulk ZIP download | ✗ | ✓ | ✓ |
| Price / month | €0 | €19 | €49 |

**Quota enforcement** (`src/lib/tier.ts`):
```typescript
canImportInvoice(orgId)   // blocking check at import time
canStoreFile(orgId, size) // blocking check at upload time
canExport(orgId)          // blocking check at dispatch time
isNearInvoiceLimit(orgId) // triggers upgrade nudge email at ≥80%
```

**IMAP lookback** is also tier-gated:
- Free: `DATE_TRUNC('month', NOW())` — current month only
- Pro/Business: `NOW() - INTERVAL 'N months'` — last N months

**Stripe webhook ordering** (migration 0018): `stripe_event_ts` (Unix seconds) stored on org. Only apply Stripe events with timestamp > last applied — prevents out-of-order downgrade replay.

---

## Onboarding Flow

Three-step wizard (`src/components/onboarding/onboarding-wizard.tsx`):

**Step 1 — Postfach (Mailbox)**
- User enters IMAP email
- Live provider detection on keystroke → auto-fills IMAP/SMTP server settings
- Known consumer domains → green badge, no config needed
- Unknown domain → backend picker (Google Workspace, M365, IONOS, Strato, Zoho)
- Totally unknown → manual server fields
- "Weiter" button tests IMAP + SMTP connection before advancing:
  - `testMailConnectionAction()` tests both protocols in parallel
  - Only advances on `✓ IMAP · ✓ SMTP`
  - Shows error detail on failure (normalised messages)

**Step 2 — Buchhaltung (Accounting)**
- Choose accounting target (Kontist, Accountable, Lexoffice, sevDesk, custom)
- Enter recipient email

**Step 3 — Bestätigung (Confirmation)**
- Summary: mailbox + recipient
- "Setup abschließen" → `completeOnboardingAction()` server action:
  1. Save IMAP credentials to Vault
  2. Upsert `mail_accounts` (Primary IMAP)
  3. Save SMTP credentials
  4. Save smtp_settings JSON
  5. Upsert `export_targets`
  6. Fire `runPrimaryImapScan()` (fire-and-forget)
  7. Redirect to `/onboarding/erstabruf`

**Post-onboarding (Erstabruf)**
- Verifies IMAP + SMTP connection against saved credentials (`verifyOnboardingConnectionAction`)
- On success: animated scan progress (4 steps)
- On failure: error screen with "Postfach neu einrichten" link
- After scan completes: shows discovered senders for business/private classification

**State persistence**: `sessionStorage` saves wizard state across accidental refreshes. Passwords are never persisted.

**Guard**: App layout redirects to `/onboarding` if no `Primary IMAP` mail_account exists. Onboarding page redirects to `/` if already configured.

---

## Security Model

### Row-Level Security (RLS)

All 25 tables have RLS enabled. Pattern for org-scoped tables:

```sql
-- SELECT: only org members can see rows
CREATE POLICY "org_members_select" ON invoices
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM org_members
      WHERE user_id = auth.uid()
    )
  );
```

**Backend bypasses RLS** by using `service_role` Supabase client. All queries in server actions must explicitly scope to `organization_id`.

### Critical Security Fixes

**Cross-tenant reads** (migration 0011): Never use `WHERE org_id = $1 OR org_id IS NULL` on sensitive tables. NULL org rows are only for global vendor seed data.

**Cross-tenant export** (migration 0013): export_targets must be org-scoped. Previously global rows meant all orgs shared the same Kontist email.

**Cross-tenant overwrite** (migration 0012): `UNIQUE(org_id, label)` on mail_accounts prevents a second onboarding run from overwriting another org's "Primary IMAP" row.

**Advisory lock** for scan: `pg_try_advisory_lock()` prevents concurrent IMAP scans across multiple server instances.

### Multi-Tenant Pattern in Server Actions

```typescript
// Always get org from auth, never from request params
const auth = await requireCurrentAuth();
const orgId = auth.organization?.id;
if (!orgId) return { status: "error", message: "No active organization" };

// Scope all queries explicitly
await sql`
  UPDATE mail_accounts
  SET status = 'configured'
  WHERE id = ${id}
    AND organization_id = ${orgId}  ← explicit, even with service_role
`;
```

---

## Mail Provider Configuration

`src/lib/mail-providers.ts` is the single source for all provider data.

```typescript
type MailProvider = {
  id: string;
  name: string;
  domain: string;          // for logo display
  domains: string[];       // for auto-detection
  hint?: string;           // UX warning (app password required, etc.)
  appPasswordUrl?: string; // link to provider's app-password page
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
};
```

**Consumer providers** (auto-detected from email domain):
Gmail, Outlook, iCloud, Yahoo, GMX, web.de, Telekom, Mailbox.org, Fastmail, Posteo, IONOS, Strato, Freenet, Zoho Mail, Proton Mail

**Backends** (manual selection for custom domains):
Google Workspace, Microsoft 365, IONOS Hosting, Strato Hosting, Zoho Mail

**Auto-detection**: `getProviderFromEmail(email)` — used in both UI (live detection) and backend actions (fallback when no manual server fields provided).

**Special case — Proton Mail**: Requires the Proton Mail Bridge app (local IMAP proxy). Server points to `127.0.0.1:1143` / `1025`. UI shows a 3-step guide to install and configure the Bridge.

---

## Background Automation

**Scheduler** (`src/lib/auto-pilot.ts`): node-cron tasks:

| Schedule | Task |
|---|---|
| Every 5 min | IMAP scan + export dispatch |
| Daily 03:00 | Missing invoice check |
| Daily 04:00 | Stuck invoice escalation (needs_review → ignored after N days) |
| Daily 05:00 | Cleanup ignored invoice files (free disk space) |
| Daily 06:00 | Self-provisioning (create approval rules after N successful imports) |
| Weekly Mon 07:00 | Weekly digest email |
| Monthly 1st 08:00 | Monthly report email |
| Monthly 1st 09:00 | Retention cleanup |

**Cron API routes** (`/api/cron/*`): For Vercel/Coolify scheduled invocations. Protected by `CRON_SECRET` bearer token.

**Self-healing loops:**
- `src/lib/automation/alias-backfill.ts` — learns vendor aliases from manual corrections
- `src/lib/automation/reactivation-check.ts` — re-enables auto-pilot if it was paused
- `src/lib/automation/reeval-queue.ts` — re-runs AI on failed extractions

---

## File Structure Reference

```
src/
├── app/
│   ├── (app)/                    # Authenticated routes
│   │   ├── layout.tsx            # Auth gate + mail-invalid banner
│   │   ├── page.tsx              # Dashboard
│   │   ├── audit/                # Invoice inbox + detail
│   │   ├── einstellungen/        # Settings + server actions
│   │   ├── konto/                # Account / billing
│   │   └── senders/              # Discovered senders
│   ├── auth/callback/route.ts    # Magic link exchange + user creation
│   ├── onboarding/
│   │   ├── page.tsx              # Already-onboarded redirect
│   │   ├── actions.ts            # completeOnboardingAction + verifyOnboardingConnectionAction
│   │   └── erstabruf/            # Post-onboarding scan + sender review
│   ├── api/
│   │   ├── cron/                 # Scheduled job endpoints
│   │   ├── stripe/               # Checkout, portal, webhook
│   │   └── export/download       # ZIP download
│   └── login/                    # Magic link form
│
├── components/
│   ├── credentials/
│   │   ├── mailbox-connect-content.tsx   # Live provider detection + test gate
│   │   └── mailbox-connect-card.tsx      # Settings modal wrapper
│   ├── onboarding/
│   │   └── onboarding-wizard.tsx         # 3-step wizard with connection test
│   ├── dashboard/                        # KPI cards, scan status
│   ├── invoice-inbox/                    # Invoice list + import
│   ├── invoice-review/                   # PDF viewer + edit form
│   ├── einstellungen/                    # Settings sections
│   └── status/
│       └── mail-invalid-banner.tsx       # Red banner when IMAP broken
│
├── mail/
│   ├── mail-scanner.ts           # IMAP scan loop (main entry)
│   ├── imap-client.ts            # ImapFlow wrapper + verifyImapAccountConnection
│   ├── smtp-client.ts            # Nodemailer wrapper + verifySmtpAccountConnection
│   ├── smtp-settings.ts          # JSON settings store for SMTP config
│   ├── attachment-extractor.ts   # Extract PDFs from parsed email
│   └── connection-test.ts        # testMailConnectionAction (raw credential test)
│
├── invoices/
│   ├── import-pipeline.ts        # Main PDF → DB pipeline
│   ├── parser.ts                 # Regex field extraction
│   ├── local-extractor.ts        # PDF text extraction
│   ├── pdf-validation.ts         # File validation
│   ├── missing-check.ts          # Expected invoice detection
│   └── review.ts                 # Manual review updates
│
├── vendors/
│   ├── matcher.ts                # Signal → vendor match
│   ├── auto-alias.ts             # Learn aliases from corrections
│   └── seed.ts                   # Initial vendor list
│
├── ai/
│   ├── extract-invoice.ts        # Mistral extraction + caching
│   ├── mistral-client.ts         # API client
│   └── schemas.ts                # Zod response schemas
│
├── exports/
│   └── export-pipeline.ts        # Enqueue + dispatch exports
│
├── senders/
│   └── discovered-senders.ts     # Sender tracking + block/unblock
│
├── lib/
│   ├── config/env.ts             # All env vars → appConfig object
│   ├── db/
│   │   ├── client.ts             # Postgres client (service_role)
│   │   ├── queries.ts            # All read queries
│   │   ├── events.ts             # Audit log (recordSyncEvent)
│   │   ├── settings-store.ts     # JSON key-value in settings table
│   │   └── advisory-lock.ts      # Distributed lock primitive
│   ├── auth/
│   │   ├── current.ts            # getCurrentAuth / requireCurrentAuth
│   │   └── session.ts            # User/org/session helpers
│   ├── secrets/
│   │   └── credential-store.ts   # Vault/Keychain abstraction
│   ├── automation/               # Background jobs
│   ├── integrations/
│   │   ├── lexoffice-client.ts
│   │   └── sevdesk-client.ts
│   ├── mail-providers.ts         # Provider config (single source of truth)
│   ├── tier.ts                   # Quota limits + enforcement
│   ├── stripe.ts                 # Stripe API helpers
│   ├── rate-limit.ts             # Per-IP rate limiter
│   └── auto-pilot.ts             # node-cron scheduler
│
└── proxy.ts                      # Next.js 16 middleware (routing + auth guard)
```

---

## Critical Implementation Notes

### 1. `redirect()` inside try/catch kills the redirect

`redirect()` from `next/navigation` throws `NEXT_REDIRECT`. If called inside a `try/catch`, the error is swallowed and the redirect never happens. Always hoist auth/guard checks before `try`:

```typescript
// ✓ CORRECT
const auth = await requireCurrentAuth();
try {
  // ... safe async work
} catch { ... }

// ✗ WRONG — redirect() will be caught and swallowed
try {
  const auth = await requireCurrentAuth(); // throws NEXT_REDIRECT
} catch { ... }
```

### 2. Always scope queries to organizationId with service_role

The service_role client bypasses RLS. Every write must include `WHERE organization_id = ${orgId}`:

```typescript
// ✓ CORRECT
await sql`UPDATE invoices SET status = 'exported' WHERE id = ${id} AND organization_id = ${orgId}`;

// ✗ WRONG — any org's invoice could be exported
await sql`UPDATE invoices SET status = 'exported' WHERE id = ${id}`;
```

### 3. Don't COALESCE nullable booleans with integers

PostgreSQL `COALESCE(bool_col, 0) = 0` is a type error. Use:
```sql
-- ✓
WHERE is_private IS NOT TRUE   -- matches FALSE and NULL
WHERE is_private IS TRUE       -- matches only TRUE

-- ✗ Type error in Postgres
WHERE COALESCE(is_private, 0) = 0
```

### 4. Advisory lock for scan idempotency

Before any long-running scan, acquire a named Postgres advisory lock:
```typescript
const locked = await sql`SELECT pg_try_advisory_lock(hashtext('imap-scan'))`;
if (!locked[0].pg_try_advisory_lock) return; // another instance is running
try { /* scan */ }
finally { await sql`SELECT pg_advisory_unlock(hashtext('imap-scan'))`; }
```

### 5. SHA256 deduplication for PDFs

Store SHA256 of the PDF buffer in `invoice_files.sha256 UNIQUE`. Before importing:
```typescript
const hash = createHash('sha256').update(buffer).digest('hex');
const existing = await sql`SELECT id FROM invoice_files WHERE sha256 = ${hash}`;
if (existing.length) return { status: 'duplicate', fileId: existing[0].id };
```

### 6. Quota check must not block retries

When quota is hit mid-scan, do NOT mark mail_messages.processed_at. The message will be retried next month with fresh quota. Only mark processed after successful import or intentional skip (junk filter, blocked sender).

### 7. Stripe webhook ordering

On subscription changes, always check `stripe_event_ts` before applying:
```typescript
await sql`
  UPDATE organizations SET tier = ${newTier}, stripe_event_ts = ${eventTimestamp}
  WHERE id = ${orgId} AND (stripe_event_ts IS NULL OR stripe_event_ts < ${eventTimestamp})
`;
// If 0 rows updated: stale event, skip
```

### 8. Export target isolation (critical security fix)

When enqueuing exports, the JOIN between invoices and export_targets MUST be within the same org:
```sql
WHERE invoices.organization_id = export_targets.organization_id
```
Without this, a single "global" export target row would forward all orgs' invoices to the same recipient.

### 9. Connection test before saving credentials

Never save IMAP/SMTP credentials without first testing them:
```typescript
// Test both protocols in parallel
const [imap, smtp] = await Promise.all([
  testImap(host, port, secure, user, pass),
  testSmtp(smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass),
]);
if (!imap.ok || !smtp.ok) throw new Error('Connection failed');
// Only then: saveCredentialSecret(...)
```

### 10. Vendor confidence tie-breaking

When two vendor aliases match the same text with equal confidence, break ties by priority (lower number = higher priority). Do NOT let a weaker match with lower priority number override a stronger match with higher priority number — apply confidence check first.

---

*Generated from production codebase. All migration SQL, env vars, and algorithms reflect the actual implementation.*
