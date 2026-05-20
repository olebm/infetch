-- ══════════════════════════════════════════════════════════════════════════════
-- 0026 — Portal-Schema Org-Scope (INFETCH-177)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Context: PR #35 (Stream A) hat den Cascade-Delete von `portal_recipes` und
-- `portal_run_logs` aus `removeOnlineAccountAction` entfernt, weil beide
-- Tabellen kein `organization_id` hatten — ein vendor_key-basierter Cascade
-- hätte die Recipes/Logs fremder Mandanten gelöscht. Diese Migration legt
-- die Schema-Grundlage für die Wiederherstellung des Cascade als Org-gescopt.
--
-- Strategie: ADDITIV. Alte Zeilen bleiben mit `organization_id IS NULL`
-- (legacy/global). Neue Inserts (über vendor-spezifisches Recording) sollten
-- die org_id setzen — der Code-Pfad dafür kommt in einem Folge-PR
-- (removeOnlineAccount-Cascade-Restore + record-Pfad-Anpassung).
--
-- Dependent on: Migration 0025 (für `app_org_match()`-Helper). Apply muss in
-- Reihenfolge geschehen: 0025 → 0026.

-- ── Add organization_id columns ───────────────────────────────────────────────
ALTER TABLE portal_recipes
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL;

ALTER TABLE portal_run_logs
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL;

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- (organization_id, vendor_key) für scoped lookups + zukünftigen Cascade-Delete.
CREATE INDEX IF NOT EXISTS idx_portal_recipes_org_vendor
  ON portal_recipes (organization_id, vendor_key);

CREATE INDEX IF NOT EXISTS idx_portal_run_logs_org_vendor
  ON portal_run_logs (organization_id, vendor_key);

-- ── RLS-Policies ──────────────────────────────────────────────────────────────
-- Auch portal_recipes + portal_run_logs hatten zwar RLS aktiviert, aber KEINE
-- Policies definiert — d.h. unter Supabase-JS-Client wären die Tabellen
-- komplett unsichtbar gewesen. Wir nutzen app_org_match() aus 0025 als
-- Standard-Pattern; NULL bleibt sichtbar als legacy/global.

-- portal_recipes: legacy NULL ist global sichtbar; eigene Org-Recipes via match
DROP POLICY IF EXISTS portal_recipes_org ON portal_recipes;
CREATE POLICY portal_recipes_org ON portal_recipes
  FOR ALL USING (
    portal_recipes.organization_id IS NULL
    OR app_org_match(portal_recipes.organization_id)
  );

-- portal_run_logs: analog
DROP POLICY IF EXISTS portal_run_logs_org ON portal_run_logs;
CREATE POLICY portal_run_logs_org ON portal_run_logs
  FOR ALL USING (
    portal_run_logs.organization_id IS NULL
    OR app_org_match(portal_run_logs.organization_id)
  );

-- ══════════════════════════════════════════════════════════════════════════════
-- NICHT in diesem Schritt (kommt als Folge-PR):
--   - UNIQUE-Constraint-Wechsel von (vendor_key, version) auf
--     (organization_id, vendor_key, version) — braucht NULLS NOT DISTINCT
--     plus Backfill-Plan für bestehende Recipes mit kollidierenden vendor_keys.
--   - Code-Anpassung: src/portals/agent/recipe-store.ts + .../portal-run-logs.ts
--     müssen orgId bei INSERT setzen.
--   - removeOnlineAccountAction-Cascade-Wiederherstellung mit
--     AND organization_id = ${orgId} auf beide Tabellen.
-- ══════════════════════════════════════════════════════════════════════════════
