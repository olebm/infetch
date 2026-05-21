-- ─────────────────────────────────────────────────────────────────────────────
-- 0030_sync_runs_organization_id.sql
--
-- Macht sync_runs org-scoped (INFETCH-208, Kern-Refactor "Scan multi-tenant").
--
-- Vorher war sync_runs global: das Erstabruf-Polling musste über einen
-- sinceIso-Zeitfenster-Hack die "eigene" Scan-Row von fremden/alten trennen
-- (genau dieser Hack war der 500 aus PR #97). Mit organization_id kann jeder
-- Scan seiner Org zugeordnet werden, und der Status wird sauber per Org
-- abgefragt — kein Zeitfenster-Rätsel, kein Cross-Org-Bleed.
--
-- Nullable + FK: Alt-Rows (vor dieser Migration) bleiben NULL. Globale Jobs
-- ohne Org-Bezug (z. B. künftige system-weite Runs) dürfen ebenfalls NULL
-- schreiben. Idempotent: ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE sync_runs
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id);

-- Deckt die Erstabruf-Statusabfrage:
--   WHERE organization_id = $1 AND type = 'imap_scan' ORDER BY id DESC LIMIT 1
CREATE INDEX IF NOT EXISTS idx_sync_runs_org_type_id
  ON sync_runs (organization_id, type, id DESC);
