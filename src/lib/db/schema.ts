export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    canonical_key TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    portal_enabled INTEGER NOT NULL DEFAULT 1,
    mail_enabled INTEGER NOT NULL DEFAULT 1,
    manual_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS vendor_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'contains', 'domain', 'regex')),
    priority INTEGER NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vendor_id, alias, match_type)
  )`,
  `CREATE TABLE IF NOT EXISTS credential_refs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL CHECK (scope IN ('imap', 'smtp', 'portal', 'mistral')),
    owner_id TEXT,
    label TEXT NOT NULL,
    secret_store TEXT NOT NULL CHECK (secret_store IN ('os_keychain', 'env', 'session_only')),
    secret_ref TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('configured', 'missing', 'invalid', 'locked')),
    last_verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_credential_refs_secret_ref
    ON credential_refs(secret_ref)`,
  `CREATE TABLE IF NOT EXISTS mail_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    secure INTEGER NOT NULL DEFAULT 1,
    username TEXT NOT NULL,
    credential_ref_id INTEGER REFERENCES credential_refs(id),
    status TEXT NOT NULL CHECK (status IN ('configured', 'missing', 'invalid', 'disabled')),
    last_verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id INTEGER REFERENCES vendors(id),
    source TEXT NOT NULL CHECK (source IN ('manual', 'mail', 'portal')),
    status TEXT NOT NULL CHECK (status IN ('new', 'needs_review', 'ready', 'exported', 'ignored', 'duplicate', 'failed')),
    invoice_number TEXT,
    invoice_date TEXT,
    service_period_start TEXT,
    service_period_end TEXT,
    amount_gross REAL,
    amount_net REAL,
    vat_amount REAL,
    currency TEXT,
    confidence REAL,
    dedupe_key TEXT,
    duplicate_of_invoice_id INTEGER REFERENCES invoices(id),
    raw_text_path TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    original_filename TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    sha256 TEXT NOT NULL UNIQUE,
    size_bytes INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'mail', 'portal')),
    source_ref_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS mail_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mail_account_id INTEGER NOT NULL REFERENCES mail_accounts(id),
    mailbox TEXT NOT NULL,
    uid INTEGER NOT NULL,
    uidvalidity TEXT NOT NULL,
    message_id TEXT,
    from_address TEXT,
    subject TEXT,
    date TEXT,
    seen_at TEXT,
    processed_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    UNIQUE(mail_account_id, mailbox, uidvalidity, uid)
  )`,
  `CREATE TABLE IF NOT EXISTS portal_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id INTEGER NOT NULL REFERENCES vendors(id),
    storage_state_path TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'login_required', 'two_factor_required', 'failed', 'disabled')),
    last_checked_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vendor_id)
  )`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    finished_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('full_sync', 'imap_scan', 'missing_check', 'portal_fallback', 'ai_analysis', 'export')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'partial')),
    triggered_by TEXT NOT NULL CHECK (triggered_by IN ('user', 'schedule', 'system')),
    summary_json TEXT NOT NULL DEFAULT '{}',
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS portal_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_run_id INTEGER REFERENCES sync_runs(id),
    job_id INTEGER REFERENCES jobs(id),
    vendor_id INTEGER NOT NULL REFERENCES vendors(id),
    year_month TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'not_found', 'failed', 'action_required', 'skipped')),
    reason TEXT NOT NULL,
    downloaded_invoice_id INTEGER REFERENCES invoices(id),
    downloaded_file_path TEXT,
    started_at TEXT,
    finished_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_runs_one_running
    ON portal_runs(vendor_id, year_month)
    WHERE status = 'running'`,
  `CREATE TABLE IF NOT EXISTS vendor_month_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id INTEGER NOT NULL REFERENCES vendors(id),
    year_month TEXT NOT NULL,
    mail_status TEXT NOT NULL CHECK (mail_status IN ('unchecked', 'found', 'missing', 'error')),
    portal_status TEXT NOT NULL CHECK (portal_status IN ('not_needed', 'required', 'running', 'found', 'not_found', 'failed', 'disabled')),
    manual_status TEXT NOT NULL CHECK (manual_status IN ('none', 'imported')),
    final_status TEXT NOT NULL CHECK (final_status IN ('unchecked', 'found', 'missing', 'action_required')),
    source_used TEXT NOT NULL CHECK (source_used IN ('none', 'manual', 'mail', 'portal')),
    invoice_id INTEGER REFERENCES invoices(id),
    last_checked_at TEXT,
    UNIQUE(vendor_id, year_month)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_extractions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('mistral')),
    model TEXT,
    prompt_version TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    output_json TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'skipped')),
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(invoice_id, provider, prompt_version, input_hash)
  )`,
  `CREATE TABLE IF NOT EXISTS export_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT NOT NULL CHECK (target IN ('kontist', 'accountable')),
    label TEXT NOT NULL,
    recipient_email TEXT,
    enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(target)
  )`,
  `CREATE TABLE IF NOT EXISTS exports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    export_target_id INTEGER NOT NULL REFERENCES export_targets(id),
    status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'sent', 'failed', 'blocked', 'skipped')),
    message_id TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(invoice_id, export_target_id)
  )`,
  `CREATE TABLE IF NOT EXISTS sync_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_run_id INTEGER REFERENCES sync_runs(id),
    job_id INTEGER REFERENCES jobs(id),
    level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
    event_type TEXT NOT NULL,
    vendor_id INTEGER REFERENCES vendors(id),
    invoice_id INTEGER REFERENCES invoices(id),
    year_month TEXT,
    message TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS discovered_senders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_address TEXT NOT NULL UNIQUE,
    from_domain TEXT NOT NULL,
    display_name TEXT,
    mail_count INTEGER NOT NULL DEFAULT 0,
    pdf_count INTEGER NOT NULL DEFAULT 0,
    imported_count INTEGER NOT NULL DEFAULT 0,
    blocked_count INTEGER NOT NULL DEFAULT 0,
    matched_vendor_id INTEGER REFERENCES vendors(id),
    blocked INTEGER NOT NULL DEFAULT 0,
    blocked_reason TEXT,
    blocked_at TEXT,
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_discovered_senders_blocked
    ON discovered_senders(blocked)`,
  `CREATE INDEX IF NOT EXISTS idx_discovered_senders_domain
    ON discovered_senders(from_domain)`,
  `ALTER TABLE vendors ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE export_targets ADD COLUMN smtp_slot TEXT NOT NULL DEFAULT 'primary'`,
  `CREATE TABLE IF NOT EXISTS portal_recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_key TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    recipe_json TEXT NOT NULL,
    recorded_by TEXT NOT NULL DEFAULT 'local',
    recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_success_at TEXT,
    last_failure_at TEXT,
    failure_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'broken', 'replaced')),
    UNIQUE(vendor_key, version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_portal_recipes_vendor_active
    ON portal_recipes(vendor_key, status)`,
  `CREATE TABLE IF NOT EXISTS portal_browser_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_key TEXT NOT NULL UNIQUE,
    storage_state_path TEXT NOT NULL,
    expires_at TEXT,
    last_login_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS portal_run_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_key TEXT NOT NULL,
    recipe_id INTEGER REFERENCES portal_recipes(id),
    mode TEXT NOT NULL CHECK (mode IN ('replay', 'record', 'replay_then_record')),
    status TEXT NOT NULL CHECK (status IN ('success', 'recipe_broken', 'login_required', 'two_factor', 'captcha', 'no_invoices', 'failed')),
    invoices_found INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    error_message TEXT,
    llm_calls INTEGER NOT NULL DEFAULT 0,
    llm_cost_cents INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_portal_run_logs_vendor
    ON portal_run_logs(vendor_key, started_at DESC)`,
  `ALTER TABLE vendors ADD COLUMN portal_login_url TEXT`,
  `ALTER TABLE vendors ADD COLUMN portal_category TEXT`,
  `CREATE TABLE IF NOT EXISTS auto_approval_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE CASCADE,
    vendor_pattern TEXT,
    max_amount_cents INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (vendor_id IS NOT NULL OR vendor_pattern IS NOT NULL)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_auto_approval_rules_vendor
    ON auto_approval_rules(vendor_id) WHERE vendor_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_auto_approval_rules_enabled
    ON auto_approval_rules(enabled, vendor_id)`,
  `CREATE TABLE IF NOT EXISTS integration_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL CHECK (provider IN ('lexoffice', 'sevdesk', 'datev')),
    label TEXT NOT NULL,
    oauth_token_ref TEXT,
    external_account_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 0,
    last_verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider)
  )`,
  `ALTER TABLE invoices ADD COLUMN external_ref TEXT`,
  `ALTER TABLE invoices ADD COLUMN external_ref_provider TEXT`,
  `ALTER TABLE invoices ADD COLUMN external_ref_at TEXT`,

  // ─────────────────────────────────────────────────────────────
  // SaaS-Foundation (Multi-Tenant)
  // Phase G — Auth, Organisationen, Sessions, Usage-Tracking
  // ─────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    email_verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'power')),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS org_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organization_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    active_organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS magic_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links(email, consumed_at)`,
  `CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_usage_events_org_time
    ON usage_events(organization_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_events_org_type_time
    ON usage_events(organization_id, event_type, created_at)`,

  // Org-Scoping fuer die wichtigsten Kern-Tabellen (nullable bis Migration durch).
  // Bestehende Zeilen werden im DB-Seed der Default-Org zugeordnet.
  `ALTER TABLE invoices ADD COLUMN organization_id TEXT REFERENCES organizations(id)`,
  `ALTER TABLE vendors ADD COLUMN organization_id TEXT REFERENCES organizations(id)`,
  `ALTER TABLE credential_refs ADD COLUMN organization_id TEXT REFERENCES organizations(id)`,
  `ALTER TABLE mail_accounts ADD COLUMN organization_id TEXT REFERENCES organizations(id)`,
  `ALTER TABLE exports ADD COLUMN organization_id TEXT REFERENCES organizations(id)`,

  // ─────────────────────────────────────────────────────────────
  // Resend-Inbound (Vision-Hauptpfad: "Postfach verbinden, fertig")
  // Pro Org eine eingehende Mail-Adresse, die User als
  // Weiterleitungsziel in seinem Mailclient einstellt.
  // IMAP wird optional/Fallback.
  // ─────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mail_inbound_addresses (
    id TEXT PRIMARY KEY,
    organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
    local_part TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_received_at TEXT,
    received_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mail_inbound_org
    ON mail_inbound_addresses(organization_id)
    WHERE deleted_at IS NULL`,

  // ─────────────────────────────────────────────────────────────
  // B6 Review-Detail: USt.-Satz + Beleg-Typ
  // ─────────────────────────────────────────────────────────────
  `ALTER TABLE invoices ADD COLUMN vat_rate REAL`,
  `ALTER TABLE invoices ADD COLUMN doc_type TEXT DEFAULT 'invoice'`,

  // ─────────────────────────────────────────────────────────────
  // Privat-Tab: einzelne Rechnungen als privat markieren
  // ─────────────────────────────────────────────────────────────
  `ALTER TABLE invoices ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0`,

  // ─────────────────────────────────────────────────────────────
  // B6 Empfänger-Dropdown: bevorzugter Export-Empfänger pro Rechnung
  // ─────────────────────────────────────────────────────────────
  `ALTER TABLE invoices ADD COLUMN preferred_export_target_id INTEGER REFERENCES export_targets(id)`,

  // ─────────────────────────────────────────────────────────────
  // Anbieter-Zuordnung: manuelle Kategorie pro Sender (unabhängig vom Vendor-Match)
  // ─────────────────────────────────────────────────────────────
  `ALTER TABLE discovered_senders ADD COLUMN vendor_category TEXT`,

  // ─────────────────────────────────────────────────────────────
  // Profil: Firmenname + USt-ID pro User
  // ─────────────────────────────────────────────────────────────
  `ALTER TABLE users ADD COLUMN company_name TEXT`,
  `ALTER TABLE users ADD COLUMN vat_id TEXT`,

  // ─────────────────────────────────────────────────────────────
  // Pricing: 2-Tier-Modell (Solo / Pro) — 'power' abgelöst
  // ─────────────────────────────────────────────────────────────
  `UPDATE organizations SET tier = 'pro' WHERE tier = 'power'`,

  // ─────────────────────────────────────────────────────────────
  // Performance-Indexes (INFETCH-95)
  // Alle Queries auf invoices filtern nach status, vendor_id,
  // invoice_date und organization_id — ohne Indexes: Full Scans.
  // ─────────────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_invoices_status
    ON invoices(status)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_vendor_id
    ON invoices(vendor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_date
    ON invoices(invoice_date)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_org_id
    ON invoices(organization_id)`,
  `CREATE INDEX IF NOT EXISTS idx_vms_final_status
    ON vendor_month_status(final_status)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_extractions_invoice_id
    ON ai_extractions(invoice_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_events_invoice_id
    ON sync_events(invoice_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_events_type
    ON sync_events(event_type)`,

  // ─────────────────────────────────────────────────────────────
  // Encrypted DB Secret Store (Linux/Docker-Kompatibilität)
  // Fallback wenn kein macOS Keychain verfügbar ist.
  // Ciphertext = AES-256-GCM: {iv_hex}:{authTag_hex}:{ciphertext_hex}
  // ─────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS encrypted_secrets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    secret_ref  TEXT NOT NULL UNIQUE,
    ciphertext  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  // Migration: credential_refs.secret_store CHECK um 'encrypted_db' erweitern.
  // Läuft bei jedem Start (idempotent — kopiert Daten in neue Tabellenversion und benennt um).
  // PRAGMA foreign_keys = OFF ist nötig weil mail_accounts.credential_ref_id darauf zeigt.
  `PRAGMA foreign_keys = OFF;
CREATE TABLE IF NOT EXISTS _credential_refs_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  scope            TEXT NOT NULL CHECK (scope IN ('imap', 'smtp', 'portal', 'mistral')),
  owner_id         TEXT,
  label            TEXT NOT NULL,
  secret_store     TEXT NOT NULL CHECK (secret_store IN ('os_keychain', 'env', 'session_only', 'encrypted_db')),
  secret_ref       TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('configured', 'missing', 'invalid', 'locked')),
  last_verified_at TEXT,
  organization_id  TEXT REFERENCES organizations(id),
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DELETE FROM _credential_refs_new;
INSERT INTO _credential_refs_new
  SELECT id, scope, owner_id, label, secret_store, secret_ref, status,
         last_verified_at, organization_id, created_at, updated_at
  FROM credential_refs;
DROP TABLE credential_refs;
ALTER TABLE _credential_refs_new RENAME TO credential_refs;
CREATE UNIQUE INDEX IF NOT EXISTS idx_credential_refs_secret_ref ON credential_refs(secret_ref);
PRAGMA foreign_keys = ON`,
];
