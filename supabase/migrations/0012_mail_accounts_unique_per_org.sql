-- ─────────────────────────────────────────────────────────────────────────────
-- 0012_mail_accounts_unique_per_org.sql
--
-- SECURITY: Strukturelle Absicherung gegen Cross-Tenant-Overwrite in
-- mail_accounts. Die App-Action-Lookups via `WHERE label = 'Primary IMAP'`
-- ohne Org-Scoping konnten den Datensatz einer anderen Org überschreiben.
-- Application-Layer-Fixes sind in 0011 (parent commit) drin, dies hier ist
-- die zweite Verteidigungslinie auf DB-Ebene.
--
-- Postgres erlaubt mehrere NULL-Werte in einem unique constraint — daher
-- ein partial index für non-NULL und ein zweiter (label-only) für NULL.
-- ─────────────────────────────────────────────────────────────────────────────

-- Wenn durch die historische Lücke schon Duplikate existieren, bricht der
-- Index-Build. Diese Anti-Affinitätsabfrage ist defensiv:
DO $$
DECLARE dup_count int;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT organization_id, label, COUNT(*) c
    FROM mail_accounts
    GROUP BY organization_id, label
    HAVING COUNT(*) > 1
  ) x;
  IF dup_count > 0 THEN
    RAISE NOTICE
      'mail_accounts: % duplicate (organization_id, label) Gruppen gefunden. '
      'Manuell prüfen und älteste Datensätze entfernen, dann diese Migration erneut anwenden.',
      dup_count;
  END IF;
END $$;

-- Pro Org max. ein Datensatz je label (Primary IMAP, Secondary IMAP, …)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_mail_accounts_org_label
  ON mail_accounts (organization_id, label)
  WHERE organization_id IS NOT NULL;

-- Legacy/None-Org-Modus: globaler Slot pro label.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_mail_accounts_label_no_org
  ON mail_accounts (label)
  WHERE organization_id IS NULL;
