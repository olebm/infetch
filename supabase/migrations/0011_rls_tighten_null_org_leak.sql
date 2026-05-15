-- ─────────────────────────────────────────────────────────────────────────────
-- 0011_rls_tighten_null_org_leak.sql
--
-- SECURITY: Entfernt den "organization_id IS NULL OR ..."-Bypass aus den
-- RLS-Policies der user-data-Tabellen. Vorher konnte jeder authentifizierte
-- Nutzer alle Zeilen sehen, deren organization_id NULL ist (Legacy-Daten,
-- Migrations-Resteinträge, oder Zeilen aus offenen Actions vor 0011).
--
-- Vendors und vendor_aliases behalten den Bypass — dort gibt es bewusste,
-- globale Seed-Daten (kanonische Vendor-Liste), die alle Tenants sehen sollen.
--
-- App-Code ist nicht betroffen: er nutzt den service_role-Postgres-Client,
-- der RLS bypasst. RLS greift nur bei Direkt-Zugriff via Supabase Anon-Key.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Credential Refs ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS credential_refs_org ON credential_refs;
CREATE POLICY credential_refs_org ON credential_refs
  FOR ALL USING (
    organization_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()::TEXT
        AND org_members.organization_id = credential_refs.organization_id
    )
  );

-- ── Mail Accounts ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS mail_accounts_org ON mail_accounts;
CREATE POLICY mail_accounts_org ON mail_accounts
  FOR ALL USING (
    organization_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()::TEXT
        AND org_members.organization_id = mail_accounts.organization_id
    )
  );

-- ── Invoices ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS invoices_org ON invoices;
CREATE POLICY invoices_org ON invoices
  FOR ALL USING (
    organization_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()::TEXT
        AND org_members.organization_id = invoices.organization_id
    )
  );

-- ── Invoice Files ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS invoice_files_org ON invoice_files;
CREATE POLICY invoice_files_org ON invoice_files
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM invoices i
      JOIN org_members om ON om.organization_id = i.organization_id
      WHERE i.id = invoice_files.invoice_id
        AND om.user_id = auth.uid()::TEXT
    )
  );

-- ── Mail Messages ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS mail_messages_org ON mail_messages;
CREATE POLICY mail_messages_org ON mail_messages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM mail_accounts ma
      JOIN org_members om ON om.organization_id = ma.organization_id
      WHERE ma.id = mail_messages.mail_account_id
        AND om.user_id = auth.uid()::TEXT
    )
  );

-- ── AI Extractions ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS ai_extractions_org ON ai_extractions;
CREATE POLICY ai_extractions_org ON ai_extractions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM invoices i
      JOIN org_members om ON om.organization_id = i.organization_id
      WHERE i.id = ai_extractions.invoice_id
        AND om.user_id = auth.uid()::TEXT
    )
  );

-- ── Exports ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS exports_org ON exports;
CREATE POLICY exports_org ON exports
  FOR ALL USING (
    organization_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()::TEXT
        AND org_members.organization_id = exports.organization_id
    )
  );

-- ── Export Targets ────────────────────────────────────────────────────────────
-- Vorher: jeder authentifizierte Nutzer sah ALLE export_targets aller Tenants.
-- Bis 0012 echtes Org-Scoping nachzieht, restriktiver fahren:
-- nur lesen erlaubt, keine direkten Mutations via Anon-Key.
DROP POLICY IF EXISTS export_targets_authenticated ON export_targets;
CREATE POLICY export_targets_read ON export_targets
  FOR SELECT USING (auth.uid() IS NOT NULL);
