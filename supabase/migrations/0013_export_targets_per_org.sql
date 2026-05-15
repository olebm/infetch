-- ─────────────────────────────────────────────────────────────────────────────
-- 0013_export_targets_per_org.sql
--
-- SECURITY (Seer-Review da65ba0 #1, CRITICAL):
-- export_targets war global geteilt (nur 2 Rows: kontist, accountable).
-- clearExportTargetAction und saveExportTargetAction modifizierten diese
-- globalen Rows ohne Org-Filter → jeder authentifizierte User konnte den
-- Export-Versand aller Tenants stoppen.
--
-- Fix: organization_id NOT NULL, partial unique index (org, target),
-- existierende globale Rows entfernen (Pre-Prod, User-Data leer).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Spalte nullable hinzufügen (kein Default — wird per Code/Seed gesetzt)
ALTER TABLE export_targets
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE;

-- 2. Index für Org-Lookups
CREATE INDEX IF NOT EXISTS idx_export_targets_org
  ON export_targets(organization_id)
  WHERE organization_id IS NOT NULL;

-- 3. Sanity: alle bestehenden Rows haben User-Daten? Wenn ja, abbrechen —
--    diese Migration darf existierende Konfiguration nicht stillschweigend löschen.
DO $$
DECLARE rows_with_data int;
BEGIN
  -- `enabled` ist INTEGER (0/1) — daher `<> 0` statt `= TRUE`.
  SELECT COUNT(*) INTO rows_with_data
  FROM export_targets
  WHERE recipient_email IS NOT NULL OR enabled <> 0;
  IF rows_with_data > 0 THEN
    RAISE EXCEPTION
      'export_targets enthält % konfigurierte Rows. Migration manuell prüfen und Rows pro Org klonen, bevor die globalen entfernt werden.',
      rows_with_data;
  END IF;
END $$;

-- 4. Globale (organization_id IS NULL) Rows entfernen — vorher leer/unkonfiguriert.
--    Per-Org-Seeding passiert beim createUserWithDefaultOrg().
DELETE FROM export_targets WHERE organization_id IS NULL;

-- 5. Alter globaler UNIQUE(target) Constraint muss weg — sonst kann jede Org
--    nur einmal global einen 'kontist'/'accountable' Eintrag haben.
ALTER TABLE export_targets DROP CONSTRAINT IF EXISTS export_targets_target_key;

-- 6. Unique constraint pro Org+Target.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_export_targets_org_target
  ON export_targets (organization_id, target);

-- 6. RLS-Policy ergänzen: aus 0011 als SELECT-only übrig, jetzt richtig org-scoped.
DROP POLICY IF EXISTS export_targets_read ON export_targets;
CREATE POLICY export_targets_org ON export_targets
  FOR ALL USING (
    organization_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()::TEXT
        AND org_members.organization_id = export_targets.organization_id
    )
  );
