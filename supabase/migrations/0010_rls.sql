-- ─────────────────────────────────────────────────────────────────────────────
-- 0010_rls.sql — Row Level Security für alle org-scoped Tabellen
--
-- Strategie:
--   - service_role / postgres (direkte DB-Verbindung) → bypasst RLS immer.
--   - authenticated (Supabase-Client mit JWT) → RLS greift.
--   - Isolation via auth.uid() → org_members → organization_id-Abgleich.
--   - Nullable organization_id: Zeilen ohne Org-Zuordnung sind global sichtbar.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Hilfsfunktion ─────────────────────────────────────────────────────────────
-- Gibt die Organization-IDs zurück zu denen der aktuelle JWT-Nutzer gehört.
-- Wird in USING-Klauseln inline verwendet (kein separater RPC-Aufruf nötig).

-- ── Users ─────────────────────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Jeder sieht nur seinen eigenen User-Datensatz
CREATE POLICY users_self ON users
  FOR ALL USING (id = auth.uid()::TEXT);

-- ── Organizations ─────────────────────────────────────────────────────────────
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY organizations_members ON organizations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()::TEXT
        AND org_members.organization_id = organizations.id
    )
  );

-- ── Org Members ───────────────────────────────────────────────────────────────
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

-- Mitglieder sehen alle Einträge ihrer eigenen Organisation
CREATE POLICY org_members_own_org ON org_members
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM org_members AS om2
      WHERE om2.user_id = auth.uid()::TEXT
    )
  );

-- ── Vendors ───────────────────────────────────────────────────────────────────
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendors_org ON vendors
  FOR ALL USING (
    organization_id IS NULL OR
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()::TEXT
        AND org_members.organization_id = vendors.organization_id
    )
  );

-- ── Vendor Aliases ────────────────────────────────────────────────────────────
ALTER TABLE vendor_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_aliases_org ON vendor_aliases
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM vendors v
      JOIN org_members om ON om.organization_id = v.organization_id
      WHERE v.id = vendor_aliases.vendor_id
        AND om.user_id = auth.uid()::TEXT
    ) OR
    EXISTS (
      SELECT 1 FROM vendors v
      WHERE v.id = vendor_aliases.vendor_id AND v.organization_id IS NULL
    )
  );

-- ── Credential Refs ───────────────────────────────────────────────────────────
ALTER TABLE credential_refs ENABLE ROW LEVEL SECURITY;

CREATE POLICY credential_refs_org ON credential_refs
  FOR ALL USING (
    organization_id IS NULL OR
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()::TEXT
        AND org_members.organization_id = credential_refs.organization_id
    )
  );

-- ── Mail Accounts ─────────────────────────────────────────────────────────────
ALTER TABLE mail_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY mail_accounts_org ON mail_accounts
  FOR ALL USING (
    organization_id IS NULL OR
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()::TEXT
        AND org_members.organization_id = mail_accounts.organization_id
    )
  );

-- ── Invoices ──────────────────────────────────────────────────────────────────
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY invoices_org ON invoices
  FOR ALL USING (
    organization_id IS NULL OR
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()::TEXT
        AND org_members.organization_id = invoices.organization_id
    )
  );

-- ── Invoice Files ─────────────────────────────────────────────────────────────
ALTER TABLE invoice_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY invoice_files_org ON invoice_files
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM invoices i
      LEFT JOIN org_members om ON om.organization_id = i.organization_id
      WHERE i.id = invoice_files.invoice_id
        AND (i.organization_id IS NULL OR om.user_id = auth.uid()::TEXT)
    )
  );

-- ── Mail Messages ─────────────────────────────────────────────────────────────
-- mail_messages ist über mail_account_id → mail_accounts.organization_id org-gescoped.
ALTER TABLE mail_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY mail_messages_org ON mail_messages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM mail_accounts ma
      LEFT JOIN org_members om ON om.organization_id = ma.organization_id
      WHERE ma.id = mail_messages.mail_account_id
        AND (ma.organization_id IS NULL OR om.user_id = auth.uid()::TEXT)
    )
  );

-- ── Vendor Month Status ───────────────────────────────────────────────────────
ALTER TABLE vendor_month_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_month_status_org ON vendor_month_status
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM vendors v
      LEFT JOIN org_members om ON om.organization_id = v.organization_id
      WHERE v.id = vendor_month_status.vendor_id
        AND (v.organization_id IS NULL OR om.user_id = auth.uid()::TEXT)
    )
  );

-- ── AI Extractions ────────────────────────────────────────────────────────────
ALTER TABLE ai_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_extractions_org ON ai_extractions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM invoices i
      LEFT JOIN org_members om ON om.organization_id = i.organization_id
      WHERE i.id = ai_extractions.invoice_id
        AND (i.organization_id IS NULL OR om.user_id = auth.uid()::TEXT)
    )
  );

-- ── Export Targets ────────────────────────────────────────────────────────────
ALTER TABLE export_targets ENABLE ROW LEVEL SECURITY;

-- Export-Targets haben keine direkte org_id — global sichtbar (admin-only in Praxis)
CREATE POLICY export_targets_authenticated ON export_targets
  FOR ALL USING (auth.uid() IS NOT NULL);

-- ── Exports ───────────────────────────────────────────────────────────────────
ALTER TABLE exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY exports_org ON exports
  FOR ALL USING (
    organization_id IS NULL OR
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()::TEXT
        AND org_members.organization_id = exports.organization_id
    )
  );

-- ── Auto Approval Rules ───────────────────────────────────────────────────────
ALTER TABLE auto_approval_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY auto_approval_rules_org ON auto_approval_rules
  FOR ALL USING (
    vendor_id IS NULL OR
    EXISTS (
      SELECT 1 FROM vendors v
      LEFT JOIN org_members om ON om.organization_id = v.organization_id
      WHERE v.id = auto_approval_rules.vendor_id
        AND (v.organization_id IS NULL OR om.user_id = auth.uid()::TEXT)
    )
  );

-- ── Portal Sessions ───────────────────────────────────────────────────────────
ALTER TABLE portal_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY portal_sessions_org ON portal_sessions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM vendors v
      LEFT JOIN org_members om ON om.organization_id = v.organization_id
      WHERE v.id = portal_sessions.vendor_id
        AND (v.organization_id IS NULL OR om.user_id = auth.uid()::TEXT)
    )
  );

-- ── Portal Runs ───────────────────────────────────────────────────────────────
ALTER TABLE portal_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY portal_runs_org ON portal_runs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM vendors v
      LEFT JOIN org_members om ON om.organization_id = v.organization_id
      WHERE v.id = portal_runs.vendor_id
        AND (v.organization_id IS NULL OR om.user_id = auth.uid()::TEXT)
    )
  );

-- ── Usage Events ──────────────────────────────────────────────────────────────
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY usage_events_org ON usage_events
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()::TEXT
        AND org_members.organization_id = usage_events.organization_id
    )
  );

-- ── Mail Inbound Addresses ────────────────────────────────────────────────────
ALTER TABLE mail_inbound_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY mail_inbound_addresses_org ON mail_inbound_addresses
  FOR ALL USING (
    organization_id IS NULL OR
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()::TEXT
        AND org_members.organization_id = mail_inbound_addresses.organization_id
    )
  );

-- ── System-Tabellen (kein User-Direktzugriff via Client) ─────────────────────
-- Nur service_role / postgres greift auf diese Tabellen zu.
-- RLS ist aktiviert aber keine Policy → authenticated-Rolle kann nicht lesen.

ALTER TABLE jobs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_browser_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_run_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovered_senders ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE encrypted_secrets ENABLE ROW LEVEL SECURITY;

-- ── Grants für authenticated-Rolle ───────────────────────────────────────────
-- Supabase erteilt SELECT/INSERT/UPDATE/DELETE auf public-Schema für authenticated
-- per Default nicht automatisch für eigene Tabellen.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
