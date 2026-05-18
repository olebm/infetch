-- ─────────────────────────────────────────────────────────────────────────────
-- 0019_multitenant_isolation.sql
--
-- SECURITY (Multi-Tenancy, CRITICAL):
-- Fünf Tabellen waren architektonisch single-tenant — keine organization_id,
-- teils global-eindeutige Constraints. In einer Mehr-Mandanten-DB führte das zu
-- Cross-Tenant-Leaks und Funktionsfehlern:
--
--   • invoice_files       — sha256 GLOBAL UNIQUE → Org B's identisches PDF wird
--                            als "Duplikat" von Org A abgewiesen (Leak + Bug).
--   • vendor_month_status  — UNIQUE(vendor_id, year_month) global → Orgs
--                            überschreiben gegenseitig Monatsstatus.
--   • auto_approval_rules  — keine org_id → Regeln galten global.
--   • integration_targets  — UNIQUE(provider) → genau EINE Lexoffice/sevDesk-
--                            Config für die gesamte DB.
--
-- Fix: organization_id ergänzen, ableitbare Werte backfillen, global-eindeutige
-- Constraints durch (organization_id, …) ersetzen, RLS direkt org-scopen.
--
-- HINWEIS: discovered_senders ist ebenfalls single-tenant (from_address GLOBAL
-- UNIQUE), wird hier aber NICHT migriert. Seine Writer (Mail-Scanner,
-- backfillFromMailMessages, autoAssignSenders) sind noch nicht org-aware —
-- ein Constraint-Wechsel würde laufende Scans brechen. Folgt in einer eigenen
-- Migration zusammen mit dem Scanner-Refactor.
--
-- Pre-Prod-Annahme (konsistent zu 0011/0013): konfigurierte Tenant-Daten, die
-- nicht sicher zugeordnet werden können, brechen die Migration ab statt still
-- falsch attribuiert zu werden. Die Cache-Tabelle vendor_month_status wird bei
-- Nicht-Zuordenbarkeit geleert — sie heilt sich beim nächsten Missing-Check
-- selbst.
-- ─────────────────────────────────────────────────────────────────────────────

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. invoice_files                                                          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE invoice_files
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE;

-- Backfill aus der zugehörigen Rechnung.
UPDATE invoice_files f
SET organization_id = i.organization_id
FROM invoices i
WHERE i.id = f.invoice_id
  AND f.organization_id IS NULL
  AND i.organization_id IS NOT NULL;

-- Verwaiste Datei-Rows (invoice_id IS NULL, weil die Rechnung via
-- ON DELETE SET NULL gelöscht wurde) sind legitim org-los — sie haben keine
-- Mandantenbindung, die verloren gehen könnte, und brechen den neuen
-- UNIQUE(organization_id, sha256) nicht (NULL gilt in Postgres als distinct).
-- Sie bleiben mit organization_id = NULL bestehen; der reguläre Import-Pfad
-- matcht sie nicht (Dedup-Query ist org-scoped).
--
-- Sanity-Guard NUR für den unerwarteten Fall: Datei hängt an einer
-- existierenden Rechnung, die aber keine organization_id hat (von 0011 für
-- invoices eigentlich ausgeschlossen) → manuell prüfen statt still falsch.
DO $$
DECLARE unattributed int;
BEGIN
  SELECT COUNT(*) INTO unattributed
  FROM invoice_files
  WHERE organization_id IS NULL AND invoice_id IS NOT NULL;
  IF unattributed > 0 THEN
    RAISE EXCEPTION
      'invoice_files: % Rows mit existierender Rechnung aber ohne ableitbare organization_id. Manuell prüfen (invoices.organization_id sollte seit 0011 NOT NULL sein).', unattributed;
  END IF;
END $$;

-- sha256-Dedup pro Org statt global (behebt Cross-Tenant-"Duplikat").
ALTER TABLE invoice_files DROP CONSTRAINT IF EXISTS invoice_files_sha256_key;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_invoice_files_org_sha256
  ON invoice_files (organization_id, sha256);
CREATE INDEX IF NOT EXISTS idx_invoice_files_org
  ON invoice_files (organization_id);

DROP POLICY IF EXISTS invoice_files_org ON invoice_files;
CREATE POLICY invoice_files_org ON invoice_files
  FOR ALL USING (
    organization_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()::TEXT
        AND org_members.organization_id = invoice_files.organization_id
    )
  );

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. vendor_month_status  (Cache — selbstheilend via Missing-Check)          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE vendor_month_status
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE;

-- Primär aus der verknüpften Rechnung ableiten …
UPDATE vendor_month_status vms
SET organization_id = i.organization_id
FROM invoices i
WHERE i.id = vms.invoice_id
  AND vms.organization_id IS NULL
  AND i.organization_id IS NOT NULL;

-- … fallback über den (org-spezifischen) Vendor.
UPDATE vendor_month_status vms
SET organization_id = v.organization_id
FROM vendors v
WHERE v.id = vms.vendor_id
  AND vms.organization_id IS NULL
  AND v.organization_id IS NOT NULL;

-- Nicht zuordenbare Cache-Rows verwerfen — werden beim nächsten Missing-Check
-- pro Org neu berechnet.
DELETE FROM vendor_month_status WHERE organization_id IS NULL;

ALTER TABLE vendor_month_status
  DROP CONSTRAINT IF EXISTS vendor_month_status_vendor_id_year_month_key;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_vms_org_vendor_month
  ON vendor_month_status (organization_id, vendor_id, year_month);
CREATE INDEX IF NOT EXISTS idx_vms_org
  ON vendor_month_status (organization_id);

DROP POLICY IF EXISTS vendor_month_status_org ON vendor_month_status;
CREATE POLICY vendor_month_status_org ON vendor_month_status
  FOR ALL USING (
    organization_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()::TEXT
        AND org_members.organization_id = vendor_month_status.organization_id
    )
  );

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. auto_approval_rules                                                    ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE auto_approval_rules
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE;

-- Aus dem (org-spezifischen) Vendor ableiten.
UPDATE auto_approval_rules r
SET organization_id = v.organization_id
FROM vendors v
WHERE v.id = r.vendor_id
  AND r.organization_id IS NULL
  AND v.organization_id IS NOT NULL;

-- Regeln sind echte Tenant-Konfiguration — nicht zuordenbare (pattern-only
-- oder an globalen Seed-Vendor gebundene) Rows nicht still global lassen.
DO $$
DECLARE unattributed int;
BEGIN
  SELECT COUNT(*) INTO unattributed FROM auto_approval_rules WHERE organization_id IS NULL;
  IF unattributed > 0 THEN
    RAISE EXCEPTION
      'auto_approval_rules: % Rows ohne ableitbare organization_id. Pro Org klonen/zuordnen, bevor fortgefahren wird.', unattributed;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_auto_approval_rules_org
  ON auto_approval_rules (organization_id);

DROP POLICY IF EXISTS auto_approval_rules_org ON auto_approval_rules;
CREATE POLICY auto_approval_rules_org ON auto_approval_rules
  FOR ALL USING (
    organization_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()::TEXT
        AND org_members.organization_id = auto_approval_rules.organization_id
    )
  );

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 4. integration_targets                                                    ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE integration_targets
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE;

-- Keine ableitbare Verknüpfung. Konfigurierte Rows (aktiv oder mit OAuth-Token)
-- dürfen nicht still einer falschen Org zugeordnet werden. `enabled` wurde in
-- Migration 0017 von INTEGER auf BOOLEAN umgestellt — daher `IS TRUE`.
DO $$
DECLARE configured int;
BEGIN
  SELECT COUNT(*) INTO configured
  FROM integration_targets
  WHERE enabled IS TRUE OR oauth_token_ref IS NOT NULL;
  IF configured > 0 THEN
    RAISE EXCEPTION
      'integration_targets: % konfigurierte Rows. Pro Org klonen und organization_id setzen, bevor der globale UNIQUE(provider) entfernt wird.', configured;
  END IF;
END $$;

-- Unkonfigurierte (globale Seed-)Rows entfernen — Per-Org-Anlage erfolgt über
-- die Einstellungen/Onboarding.
DELETE FROM integration_targets WHERE organization_id IS NULL;

ALTER TABLE integration_targets
  DROP CONSTRAINT IF EXISTS integration_targets_provider_key;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_integration_targets_org_provider
  ON integration_targets (organization_id, provider);
CREATE INDEX IF NOT EXISTS idx_integration_targets_org
  ON integration_targets (organization_id);

-- 0010 hatte RLS aktiviert aber KEINE Policy. Jetzt org-scoped.
DROP POLICY IF EXISTS integration_targets_org ON integration_targets;
CREATE POLICY integration_targets_org ON integration_targets
  FOR ALL USING (
    organization_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()::TEXT
        AND org_members.organization_id = integration_targets.organization_id
    )
  );
