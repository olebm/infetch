-- ══════════════════════════════════════════════════════════════════════════════
-- 0031 — Portal-Vendoren: Org-Attribution der Altlasten (INFETCH-236)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Context: Der Portal-Connect-Pfad (online-accounts → upsertVendor) hat Vendoren
-- ohne organization_id angelegt (global, organization_id IS NULL). Dadurch waren
-- Name + Login-URL eines Portals einer Org für ALLE Orgs sichtbar
-- (Cross-Tenant-Leak). Der Code-Fix setzt organization_id beim Anlegen; diese
-- Migration räumt bereits entstandene Alt-Zeilen auf.
--
-- Heuristik: Ein „geleakter" Portal-Vendor hat organization_id IS NULL UND
-- portal_login_url IS NOT NULL (globale Seed-Built-ins tragen keine kundenspezi-
-- fische Login-URL). Die besitzende Org ergibt sich aus credential_refs
-- (scope='portal', secret_ref enthält ':<canonical_key>:'). Nur wenn GENAU eine
-- Org Credentials für den Key hält, wird attribuiert — bei Mehrdeutigkeit bleibt
-- die Zeile global und wird zur manuellen Prüfung geloggt.
--
-- Idempotent: nach der Attribution ist organization_id NOT NULL → beim erneuten
-- Lauf nicht mehr in der Auswahl. In Prod (Portal-Feature nie aktiv) ein No-Op.

DO $$
DECLARE
  v RECORD;
  owner_org TEXT;
  owner_count INT;
BEGIN
  FOR v IN
    SELECT id, canonical_key
    FROM vendors
    WHERE organization_id IS NULL
      AND portal_login_url IS NOT NULL
  LOOP
    SELECT COUNT(DISTINCT organization_id), MIN(organization_id)
      INTO owner_count, owner_org
    FROM credential_refs
    WHERE scope = 'portal'
      AND organization_id IS NOT NULL
      AND secret_ref LIKE '%:' || v.canonical_key || ':%';

    IF owner_count = 1 THEN
      UPDATE vendors
      SET organization_id = owner_org, updated_at = NOW()::TEXT
      WHERE id = v.id;
      RAISE NOTICE '0031: vendor % (%) der Org % zugeordnet', v.id, v.canonical_key, owner_org;
    ELSIF owner_count > 1 THEN
      RAISE WARNING '0031: vendor % (%) hat Portal-Credentials in % Orgs — bleibt global, manuelle Prüfung nötig', v.id, v.canonical_key, owner_count;
    ELSE
      RAISE NOTICE '0031: vendor % (%) ohne Org-Credentials — bleibt global (evtl. verwaister Connect-Versuch)', v.id, v.canonical_key;
    END IF;
  END LOOP;
END $$;
