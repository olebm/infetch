-- ─────────────────────────────────────────────────────────────────────────────
-- Infetch — Initial Schema (Postgres / Supabase)
-- Erzeugt aus dem SQLite-Schema (schema.ts) — alle ALTER TABLE-Migrationen
-- wurden in die ursprünglichen CREATE TABLE-Statements eingebaut.
--
-- Nicht enthalten:
--   - schema_migrations   (Supabase verwaltet das selbst)
--   - sessions            (ersetzt durch Supabase Auth)
--   - magic_links         (ersetzt durch Supabase Auth)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Users & Organizations ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  name              TEXT,
  email_verified_at TEXT,
  company_name      TEXT,
  vat_id            TEXT,
  created_at        TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at        TEXT NOT NULL DEFAULT (NOW()::TEXT),
  deleted_at        TEXT
);

CREATE TABLE IF NOT EXISTS organizations (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  slug                   TEXT NOT NULL UNIQUE,
  tier                   TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro')),
  owner_user_id          TEXT NOT NULL REFERENCES users(id),
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  created_at             TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at             TEXT NOT NULL DEFAULT (NOW()::TEXT),
  deleted_at             TEXT
);

CREATE TABLE IF NOT EXISTS org_members (
  id              BIGSERIAL PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at      TEXT NOT NULL DEFAULT (NOW()::TEXT),
  UNIQUE(organization_id, user_id)
);

-- ── Vendors ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendors (
  id               BIGSERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  canonical_key    TEXT NOT NULL UNIQUE,
  category         TEXT NOT NULL,
  portal_enabled   INTEGER NOT NULL DEFAULT 1,
  mail_enabled     INTEGER NOT NULL DEFAULT 1,
  manual_enabled   INTEGER NOT NULL DEFAULT 1,
  hidden           INTEGER NOT NULL DEFAULT 0,
  portal_login_url TEXT,
  portal_category  TEXT,
  organization_id  TEXT REFERENCES organizations(id),
  created_at       TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at       TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

CREATE TABLE IF NOT EXISTS vendor_aliases (
  id         BIGSERIAL PRIMARY KEY,
  vendor_id  BIGINT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  alias      TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'contains', 'domain', 'regex')),
  priority   INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
  UNIQUE(vendor_id, alias, match_type)
);

-- ── Credentials & Mail ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS credential_refs (
  id               BIGSERIAL PRIMARY KEY,
  scope            TEXT NOT NULL CHECK (scope IN ('imap', 'smtp', 'portal', 'mistral')),
  owner_id         TEXT,
  label            TEXT NOT NULL,
  secret_store     TEXT NOT NULL CHECK (secret_store IN ('os_keychain', 'env', 'session_only', 'encrypted_db')),
  secret_ref       TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('configured', 'missing', 'invalid', 'locked')),
  last_verified_at TEXT,
  organization_id  TEXT REFERENCES organizations(id),
  created_at       TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at       TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_credential_refs_secret_ref
  ON credential_refs(secret_ref);

CREATE TABLE IF NOT EXISTS mail_accounts (
  id                BIGSERIAL PRIMARY KEY,
  label             TEXT NOT NULL,
  host              TEXT NOT NULL,
  port              INTEGER NOT NULL,
  secure            INTEGER NOT NULL DEFAULT 1,
  username          TEXT NOT NULL,
  credential_ref_id BIGINT REFERENCES credential_refs(id),
  status            TEXT NOT NULL CHECK (status IN ('configured', 'missing', 'invalid', 'disabled')),
  last_verified_at  TEXT,
  organization_id   TEXT REFERENCES organizations(id),
  created_at        TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at        TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

-- ── Export Targets (referenced by invoices — must exist before invoices) ──────

CREATE TABLE IF NOT EXISTS export_targets (
  id              BIGSERIAL PRIMARY KEY,
  target          TEXT NOT NULL CHECK (target IN ('kontist', 'accountable')),
  label           TEXT NOT NULL,
  recipient_email TEXT,
  enabled         INTEGER NOT NULL DEFAULT 0,
  smtp_slot       TEXT NOT NULL DEFAULT 'primary',
  created_at      TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at      TEXT NOT NULL DEFAULT (NOW()::TEXT),
  UNIQUE(target)
);

-- ── Invoices & Files ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invoices (
  id                         BIGSERIAL PRIMARY KEY,
  vendor_id                  BIGINT REFERENCES vendors(id),
  source                     TEXT NOT NULL CHECK (source IN ('manual', 'mail', 'portal')),
  status                     TEXT NOT NULL CHECK (status IN ('new', 'needs_review', 'ready', 'exported', 'ignored', 'duplicate', 'failed')),
  invoice_number             TEXT,
  invoice_date               TEXT,
  service_period_start       TEXT,
  service_period_end         TEXT,
  amount_gross               REAL,
  amount_net                 REAL,
  vat_amount                 REAL,
  currency                   TEXT,
  confidence                 REAL,
  dedupe_key                 TEXT,
  duplicate_of_invoice_id    BIGINT REFERENCES invoices(id),
  raw_text_path              TEXT,
  external_ref               TEXT,
  external_ref_provider      TEXT,
  external_ref_at            TEXT,
  vat_rate                   REAL,
  doc_type                   TEXT DEFAULT 'invoice',
  is_private                 INTEGER NOT NULL DEFAULT 0,
  preferred_export_target_id BIGINT REFERENCES export_targets(id),
  organization_id            TEXT REFERENCES organizations(id),
  created_at                 TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at                 TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

CREATE INDEX IF NOT EXISTS idx_invoices_status    ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_vendor_id ON invoices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date      ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_org_id    ON invoices(organization_id);

CREATE TABLE IF NOT EXISTS invoice_files (
  id                BIGSERIAL PRIMARY KEY,
  invoice_id        BIGINT REFERENCES invoices(id) ON DELETE SET NULL,
  original_filename TEXT NOT NULL,
  stored_path       TEXT NOT NULL,
  sha256            TEXT NOT NULL UNIQUE,
  size_bytes        INTEGER NOT NULL,
  mime_type         TEXT NOT NULL,
  source_type       TEXT NOT NULL CHECK (source_type IN ('manual', 'mail', 'portal')),
  source_ref_id     TEXT,
  created_at        TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

CREATE TABLE IF NOT EXISTS mail_messages (
  id              BIGSERIAL PRIMARY KEY,
  mail_account_id BIGINT NOT NULL REFERENCES mail_accounts(id),
  mailbox         TEXT NOT NULL,
  uid             INTEGER NOT NULL,
  uidvalidity     TEXT NOT NULL,
  message_id      TEXT,
  from_address    TEXT,
  subject         TEXT,
  date            TEXT,
  seen_at         TEXT,
  processed_at    TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  UNIQUE(mail_account_id, mailbox, uidvalidity, uid)
);

-- ── Portals ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portal_sessions (
  id                  BIGSERIAL PRIMARY KEY,
  vendor_id           BIGINT NOT NULL REFERENCES vendors(id),
  storage_state_path  TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('active', 'login_required', 'two_factor_required', 'failed', 'disabled')),
  last_checked_at     TEXT,
  last_error          TEXT,
  created_at          TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at          TEXT NOT NULL DEFAULT (NOW()::TEXT),
  UNIQUE(vendor_id)
);

CREATE TABLE IF NOT EXISTS portal_recipes (
  id             BIGSERIAL PRIMARY KEY,
  vendor_key     TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  recipe_json    TEXT NOT NULL,
  recorded_by    TEXT NOT NULL DEFAULT 'local',
  recorded_at    TEXT NOT NULL DEFAULT (NOW()::TEXT),
  last_success_at TEXT,
  last_failure_at TEXT,
  failure_count  INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'broken', 'replaced')),
  UNIQUE(vendor_key, version)
);

CREATE INDEX IF NOT EXISTS idx_portal_recipes_vendor_active
  ON portal_recipes(vendor_key, status);

CREATE TABLE IF NOT EXISTS portal_browser_sessions (
  id                  BIGSERIAL PRIMARY KEY,
  vendor_key          TEXT NOT NULL UNIQUE,
  storage_state_path  TEXT NOT NULL,
  expires_at          TEXT,
  last_login_at       TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at          TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

CREATE TABLE IF NOT EXISTS portal_run_logs (
  id              BIGSERIAL PRIMARY KEY,
  vendor_key      TEXT NOT NULL,
  recipe_id       BIGINT REFERENCES portal_recipes(id),
  mode            TEXT NOT NULL CHECK (mode IN ('replay', 'record', 'replay_then_record')),
  status          TEXT NOT NULL CHECK (status IN ('success', 'recipe_broken', 'login_required', 'two_factor', 'captcha', 'no_invoices', 'failed')),
  invoices_found  INTEGER NOT NULL DEFAULT 0,
  duration_ms     INTEGER,
  error_message   TEXT,
  llm_calls       INTEGER NOT NULL DEFAULT 0,
  llm_cost_cents  INTEGER NOT NULL DEFAULT 0,
  started_at      TEXT NOT NULL DEFAULT (NOW()::TEXT),
  finished_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_portal_run_logs_vendor
  ON portal_run_logs(vendor_key, started_at DESC);

-- ── Jobs & Sync ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS jobs (
  id            BIGSERIAL PRIMARY KEY,
  type          TEXT NOT NULL,
  payload_json  TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TEXT NOT NULL DEFAULT (NOW()::TEXT),
  started_at    TEXT,
  finished_at   TEXT
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id           BIGSERIAL PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('full_sync', 'imap_scan', 'missing_check', 'portal_fallback', 'ai_analysis', 'export')),
  status       TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'partial')),
  triggered_by TEXT NOT NULL CHECK (triggered_by IN ('user', 'schedule', 'system')),
  summary_json TEXT NOT NULL DEFAULT '{}',
  started_at   TEXT,
  finished_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

CREATE TABLE IF NOT EXISTS portal_runs (
  id                     BIGSERIAL PRIMARY KEY,
  sync_run_id            BIGINT REFERENCES sync_runs(id),
  job_id                 BIGINT REFERENCES jobs(id),
  vendor_id              BIGINT NOT NULL REFERENCES vendors(id),
  year_month             TEXT NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'not_found', 'failed', 'action_required', 'skipped')),
  reason                 TEXT NOT NULL,
  downloaded_invoice_id  BIGINT REFERENCES invoices(id),
  downloaded_file_path   TEXT,
  started_at             TEXT,
  finished_at            TEXT,
  last_error             TEXT,
  created_at             TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

-- Partial unique index: only one running portal run per vendor+month
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_runs_one_running
  ON portal_runs(vendor_id, year_month)
  WHERE status = 'running';

CREATE TABLE IF NOT EXISTS sync_events (
  id            BIGSERIAL PRIMARY KEY,
  sync_run_id   BIGINT REFERENCES sync_runs(id),
  job_id        BIGINT REFERENCES jobs(id),
  level         TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
  event_type    TEXT NOT NULL,
  vendor_id     BIGINT REFERENCES vendors(id),
  invoice_id    BIGINT REFERENCES invoices(id),
  year_month    TEXT,
  message       TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

CREATE INDEX IF NOT EXISTS idx_sync_events_invoice_id ON sync_events(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sync_events_type       ON sync_events(event_type);

-- ── Vendor Month Status ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendor_month_status (
  id             BIGSERIAL PRIMARY KEY,
  vendor_id      BIGINT NOT NULL REFERENCES vendors(id),
  year_month     TEXT NOT NULL,
  mail_status    TEXT NOT NULL CHECK (mail_status IN ('unchecked', 'found', 'missing', 'error')),
  portal_status  TEXT NOT NULL CHECK (portal_status IN ('not_needed', 'required', 'running', 'found', 'not_found', 'failed', 'disabled')),
  manual_status  TEXT NOT NULL CHECK (manual_status IN ('none', 'imported')),
  final_status   TEXT NOT NULL CHECK (final_status IN ('unchecked', 'found', 'missing', 'action_required')),
  source_used    TEXT NOT NULL CHECK (source_used IN ('none', 'manual', 'mail', 'portal')),
  invoice_id     BIGINT REFERENCES invoices(id),
  last_checked_at TEXT,
  UNIQUE(vendor_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_vms_final_status ON vendor_month_status(final_status);

-- ── AI & Export ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_extractions (
  id             BIGSERIAL PRIMARY KEY,
  invoice_id     BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL CHECK (provider IN ('mistral')),
  model          TEXT,
  prompt_version TEXT NOT NULL,
  input_hash     TEXT NOT NULL,
  output_json    TEXT,
  status         TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'skipped')),
  error          TEXT,
  created_at     TEXT NOT NULL DEFAULT (NOW()::TEXT),
  UNIQUE(invoice_id, provider, prompt_version, input_hash)
);

CREATE INDEX IF NOT EXISTS idx_ai_extractions_invoice_id ON ai_extractions(invoice_id);

CREATE TABLE IF NOT EXISTS exports (
  id               BIGSERIAL PRIMARY KEY,
  invoice_id       BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  export_target_id BIGINT NOT NULL REFERENCES export_targets(id),
  status           TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'sent', 'failed', 'blocked', 'skipped')),
  message_id       TEXT,
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  sent_at          TEXT,
  organization_id  TEXT REFERENCES organizations(id),
  created_at       TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at       TEXT NOT NULL DEFAULT (NOW()::TEXT),
  UNIQUE(invoice_id, export_target_id)
);

-- ── Automation ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auto_approval_rules (
  id              BIGSERIAL PRIMARY KEY,
  vendor_id       BIGINT REFERENCES vendors(id) ON DELETE CASCADE,
  vendor_pattern  TEXT,
  max_amount_cents INTEGER,
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at      TEXT NOT NULL DEFAULT (NOW()::TEXT),
  CHECK (vendor_id IS NOT NULL OR vendor_pattern IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_auto_approval_rules_vendor
  ON auto_approval_rules(vendor_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auto_approval_rules_enabled
  ON auto_approval_rules(enabled, vendor_id);

CREATE TABLE IF NOT EXISTS discovered_senders (
  id                BIGSERIAL PRIMARY KEY,
  from_address      TEXT NOT NULL UNIQUE,
  from_domain       TEXT NOT NULL,
  display_name      TEXT,
  mail_count        INTEGER NOT NULL DEFAULT 0,
  pdf_count         INTEGER NOT NULL DEFAULT 0,
  imported_count    INTEGER NOT NULL DEFAULT 0,
  blocked_count     INTEGER NOT NULL DEFAULT 0,
  matched_vendor_id BIGINT REFERENCES vendors(id),
  blocked           INTEGER NOT NULL DEFAULT 0,
  blocked_reason    TEXT,
  blocked_at        TEXT,
  vendor_category   TEXT,
  first_seen_at     TEXT NOT NULL DEFAULT (NOW()::TEXT),
  last_seen_at      TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at        TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

CREATE INDEX IF NOT EXISTS idx_discovered_senders_blocked
  ON discovered_senders(blocked);
CREATE INDEX IF NOT EXISTS idx_discovered_senders_domain
  ON discovered_senders(from_domain);

-- ── Settings & Misc ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

CREATE TABLE IF NOT EXISTS integration_targets (
  id                   BIGSERIAL PRIMARY KEY,
  provider             TEXT NOT NULL CHECK (provider IN ('lexoffice', 'sevdesk', 'datev')),
  label                TEXT NOT NULL,
  oauth_token_ref      TEXT,
  external_account_id  TEXT,
  enabled              INTEGER NOT NULL DEFAULT 0,
  last_verified_at     TEXT,
  created_at           TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at           TEXT NOT NULL DEFAULT (NOW()::TEXT),
  UNIQUE(provider)
);

CREATE TABLE IF NOT EXISTS usage_events (
  id              BIGSERIAL PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  cost_cents      INTEGER NOT NULL DEFAULT 0,
  metadata_json   TEXT,
  created_at      TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

CREATE INDEX IF NOT EXISTS idx_usage_events_org_time
  ON usage_events(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_org_type_time
  ON usage_events(organization_id, event_type, created_at);

CREATE TABLE IF NOT EXISTS mail_inbound_addresses (
  id              TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  local_part      TEXT NOT NULL UNIQUE,
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_received_at TEXT,
  received_count  INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at      TEXT NOT NULL DEFAULT (NOW()::TEXT),
  deleted_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_mail_inbound_org
  ON mail_inbound_addresses(organization_id)
  WHERE deleted_at IS NULL;

-- ── Secrets Store (Phase 4: wird durch Supabase Vault ersetzt) ────────────────

CREATE TABLE IF NOT EXISTS encrypted_secrets (
  id         BIGSERIAL PRIMARY KEY,
  secret_ref TEXT NOT NULL UNIQUE,
  ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
);
