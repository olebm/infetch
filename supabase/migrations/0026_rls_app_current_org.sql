-- ══════════════════════════════════════════════════════════════════════════════
-- 0026 — Defense-in-Depth RLS via app.current_org (INFETCH-175)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Context: Die App nutzt heute eine postgres-Superuser-Connection (Supavisor)
-- die RLS implizit umgeht. Multi-Tenant-Sicherheit hängt damit ausschließlich
-- am manuellen `WHERE organization_id = …` in jeder Query — siehe Stream A
-- (INFETCH-160…165), wo genau diese Disziplin gefehlt hatte.
--
-- Defense-in-Depth: Diese Migration ergänzt alle org-scoped RLS-Policies um
-- eine zweite Match-Klausel via `current_setting('app.current_org')`. Wenn
-- der `createScopedSql(orgId)`-Wrapper (src/lib/db/scoped-query.ts) eine
-- Transaktion mit `SELECT set_config('app.current_org', orgId, true)`
-- vorbereitet, dann sehen die Policies die org-Zuordnung — selbst wenn ein
-- manueller WHERE-Filter im Code-Pfad fehlt, blockt RLS Cross-Tenant-Reads
-- und -Writes als zweite Verteidigungslinie.
--
-- Sicherheits-Eigenschaft: ADDITIV. Bestehende `auth.uid()`-Pfade (Browser
-- mit JWT, Supabase JS Client) funktionieren unverändert — die neue
-- `current_setting`-Klausel ist über OR ergänzt. Solange `app.current_org`
-- ungesetzt ist (Default), liefert `current_setting('app.current_org', true)`
-- den leeren String und matcht keine echte `organization_id` → kein
-- Effektreduzieren.
--
-- Aktiviert von: src/lib/db/scoped-query.ts (Proxy-Pattern, jede scoped`…`
-- Query öffnet eine Transaktion + set_config + Query). Cross-Org-Audits per
-- `grep -rn unsafeGlobalSql src/`.

-- ── Helper-Function: org-match (auth.uid OR app.current_org) ──────────────────
-- STABLE damit die Query-Engine den Funktions-Call innerhalb einer Query
-- cachen kann. SQL-Funktionen (kein PL/pgSQL) inlinet der Planner zu den
-- ursprünglichen Boolean-Ausdrücken, kein Performance-Overhead vs. inline-OR.
CREATE OR REPLACE FUNCTION app_org_match(target_org TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT target_org IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = (auth.uid())::TEXT
        AND org_members.organization_id = target_org
    )
    -- current_setting(..., true): missing_ok=true → liefert '' wenn nicht
    -- gesetzt (kein Error). Vergleich mit echter org_id matcht nur, wenn
    -- der Wrapper das setting via set_config bewusst gesetzt hat.
    OR current_setting('app.current_org', true) = target_org
  )
$$;

COMMENT ON FUNCTION app_org_match(TEXT) IS
  'INFETCH-175: org-membership via auth.uid() OR app.current_org session setting. Used by RLS policies as defense-in-depth alongside manual WHERE filters.';

-- ── Drop-and-recreate aller org-scoped Policies ──────────────────────────────
-- Pattern: jede Policy nutzt jetzt app_org_match(target_org).
-- Tabellen mit direktem organization_id-Feld: app_org_match(invoices.organization_id)
-- Tabellen mit FK-Relation: app_org_match auf das referenzierte org-Feld der FK-Zeile

-- invoices
DROP POLICY IF EXISTS invoices_org ON invoices;
CREATE POLICY invoices_org ON invoices
  FOR ALL USING (app_org_match(invoices.organization_id));

-- invoice_files (FK invoice_id → invoices.organization_id)
DROP POLICY IF EXISTS invoice_files_org ON invoice_files;
CREATE POLICY invoice_files_org ON invoice_files
  FOR ALL USING (app_org_match(invoice_files.organization_id));

-- mail_accounts
DROP POLICY IF EXISTS mail_accounts_org ON mail_accounts;
CREATE POLICY mail_accounts_org ON mail_accounts
  FOR ALL USING (app_org_match(mail_accounts.organization_id));

-- mail_messages (FK mail_account_id → mail_accounts.organization_id)
DROP POLICY IF EXISTS mail_messages_org ON mail_messages;
CREATE POLICY mail_messages_org ON mail_messages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM mail_accounts ma
      WHERE ma.id = mail_messages.mail_account_id
        AND app_org_match(ma.organization_id)
    )
  );

-- credential_refs
DROP POLICY IF EXISTS credential_refs_org ON credential_refs;
CREATE POLICY credential_refs_org ON credential_refs
  FOR ALL USING (app_org_match(credential_refs.organization_id));

-- exports
DROP POLICY IF EXISTS exports_org ON exports;
CREATE POLICY exports_org ON exports
  FOR ALL USING (app_org_match(exports.organization_id));

-- export_targets
DROP POLICY IF EXISTS export_targets_org ON export_targets;
CREATE POLICY export_targets_org ON export_targets
  FOR ALL USING (app_org_match(export_targets.organization_id));

-- vendors (organization_id NULL = global built-in vendor, sichtbar für alle)
DROP POLICY IF EXISTS vendors_org ON vendors;
CREATE POLICY vendors_org ON vendors
  FOR ALL USING (
    vendors.organization_id IS NULL OR app_org_match(vendors.organization_id)
  );

-- vendor_aliases (FK vendor_id → vendors.organization_id; NULL-vendors sind global)
DROP POLICY IF EXISTS vendor_aliases_org ON vendor_aliases;
CREATE POLICY vendor_aliases_org ON vendor_aliases
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM vendors v
      WHERE v.id = vendor_aliases.vendor_id
        AND (v.organization_id IS NULL OR app_org_match(v.organization_id))
    )
  );

-- ai_extractions (FK invoice_id → invoices.organization_id)
DROP POLICY IF EXISTS ai_extractions_org ON ai_extractions;
CREATE POLICY ai_extractions_org ON ai_extractions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = ai_extractions.invoice_id
        AND app_org_match(i.organization_id)
    )
  );

-- portal_sessions (FK vendor_id → vendors.organization_id; NULL = global)
DROP POLICY IF EXISTS portal_sessions_org ON portal_sessions;
CREATE POLICY portal_sessions_org ON portal_sessions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM vendors v
      WHERE v.id = portal_sessions.vendor_id
        AND (v.organization_id IS NULL OR app_org_match(v.organization_id))
    )
  );

-- portal_runs (FK vendor_id → vendors.organization_id; NULL = global)
DROP POLICY IF EXISTS portal_runs_org ON portal_runs;
CREATE POLICY portal_runs_org ON portal_runs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM vendors v
      WHERE v.id = portal_runs.vendor_id
        AND (v.organization_id IS NULL OR app_org_match(v.organization_id))
    )
  );

-- usage_events
DROP POLICY IF EXISTS usage_events_org ON usage_events;
CREATE POLICY usage_events_org ON usage_events
  FOR ALL USING (app_org_match(usage_events.organization_id));

-- mail_inbound_addresses (organization_id NULL erlaubt — System-Defaults)
DROP POLICY IF EXISTS mail_inbound_addresses_org ON mail_inbound_addresses;
CREATE POLICY mail_inbound_addresses_org ON mail_inbound_addresses
  FOR ALL USING (
    mail_inbound_addresses.organization_id IS NULL
    OR app_org_match(mail_inbound_addresses.organization_id)
  );

-- vendor_month_status
DROP POLICY IF EXISTS vendor_month_status_org ON vendor_month_status;
CREATE POLICY vendor_month_status_org ON vendor_month_status
  FOR ALL USING (app_org_match(vendor_month_status.organization_id));

-- auto_approval_rules
DROP POLICY IF EXISTS auto_approval_rules_org ON auto_approval_rules;
CREATE POLICY auto_approval_rules_org ON auto_approval_rules
  FOR ALL USING (app_org_match(auto_approval_rules.organization_id));

-- integration_targets (INFETCH-116: war historisch nicht org-scoped)
DROP POLICY IF EXISTS integration_targets_org ON integration_targets;
CREATE POLICY integration_targets_org ON integration_targets
  FOR ALL USING (app_org_match(integration_targets.organization_id));

-- discovered_senders (0020: per-org seit recent migration)
DROP POLICY IF EXISTS discovered_senders_org ON discovered_senders;
CREATE POLICY discovered_senders_org ON discovered_senders
  FOR ALL USING (app_org_match(discovered_senders.organization_id));

-- ══════════════════════════════════════════════════════════════════════════════
-- Smoke-Selftest (würde bei kaputter Helper-Function migration abbrechen):
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_match BOOLEAN;
BEGIN
  -- ohne gesetztes app.current_org und ohne JWT-User: kein Match → FALSE
  PERFORM set_config('app.current_org', '', false);
  SELECT app_org_match('some-org-id') INTO v_match;
  IF v_match IS NOT FALSE THEN
    RAISE EXCEPTION 'app_org_match selftest #1 failed: expected FALSE without auth or setting, got %', v_match;
  END IF;

  -- mit gesetztem app.current_org und passender target_org: TRUE
  PERFORM set_config('app.current_org', 'matching-org', false);
  SELECT app_org_match('matching-org') INTO v_match;
  IF v_match IS NOT TRUE THEN
    RAISE EXCEPTION 'app_org_match selftest #2 failed: expected TRUE with matching setting, got %', v_match;
  END IF;

  -- mit gesetztem app.current_org aber anderer target_org: FALSE
  SELECT app_org_match('different-org') INTO v_match;
  IF v_match IS NOT FALSE THEN
    RAISE EXCEPTION 'app_org_match selftest #3 failed: expected FALSE for mismatched setting, got %', v_match;
  END IF;

  -- Reset für saubere Session.
  PERFORM set_config('app.current_org', '', false);
END $$;
