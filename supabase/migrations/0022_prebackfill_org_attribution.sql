-- ─────────────────────────────────────────────────────────────────────────────
-- 0022_prebackfill_org_attribution.sql
--
-- Runs BEFORE 0019. Idempotent, drift-safe (0021-style pattern).
--
-- WHY: 0019_multitenant_isolation aborts (RAISE EXCEPTION) when configured
-- tenant data has no derivable organization_id. On the drifted prod DB this
-- trips for:
--   • invoice_files       (guard derives org from invoices → orphan invoices)
--   • auto_approval_rules  (derives from vendors → guard aborts on NULL)
--   • integration_targets  (no derivation at all → guard aborts on any
--                            configured row, since the column is brand new)
-- All 0019 backfills ultimately derive from invoices.organization_id /
-- vendors.organization_id. This migration attributes the legacy orphans to a
-- DESIGNATED organization first, so 0019's guards count zero and complete
-- without aborting. Cache tables (vendor_month_status, discovered_senders)
-- are left untouched — 0019/0020 delete unattributable cache rows and they
-- self-heal via the next missing-check.
--
-- A pre-0019 migration cannot UPDATE columns that 0019 creates, so for
-- integration_targets / auto_approval_rules we ADD the column here with
-- IF NOT EXISTS (keeps 0019 idempotent) and attribute the rows now.
--
-- REQUIRED PARAMETER — the designated organizations.id. This file is pure
-- SQL (portable across psql AND the node migration runner / CI); it reads a
-- session GUC. The OPERATOR must set it in the SAME psql session/connection
-- immediately before running this + the following migrations, e.g.:
--
--   psql "$DB" -v ON_ERROR_STOP=1 \
--     -c "SELECT set_config('app.designated_org','REAL_ORG_ID',false)" \
--     -f supabase/migrations/0022_prebackfill_org_attribution.sql \
--     -f supabase/migrations/0019_multitenant_isolation.sql \
--     -f supabase/migrations/0020_discovered_senders_per_org.sql \
--     -f supabase/migrations/0021_remaining_boolean_columns.sql
--
-- (psql runs -c then -f on ONE connection, so the GUC persists.) The id MUST
-- exist in organizations (verified below). Confirm it at the runbook's
-- Checkpoint 1. Multi-tenant: do NOT use this blanket fallback — see runbook,
-- per-tenant derivation required. When the GUC is unset (CI / fresh DB /
-- node runner) this migration skips — a pristine DB has no orphans.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  designated     TEXT := current_setting('app.designated_org', true);
  has_vendor_org BOOLEAN;
  n              INT;
BEGIN
  -- No designated org → clean-DB / CI / fresh-chain path: a pristine DB has
  -- no legacy orphans and 0019's guards won't trip, so this pre-backfill is
  -- unnecessary. Skip instead of aborting (keeps CI + fresh installs green).
  -- The prod runbook ALWAYS passes -v designated_org=...
  IF designated IS NULL OR designated = '' THEN
    RAISE NOTICE '0022: no designated_org set — skipping pre-backfill (clean-DB path).';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = designated) THEN
    RAISE EXCEPTION '0022: designated org % not found in organizations', designated;
  END IF;

  -- 1) invoices — legacy orphans have no derivable FK (import sets org from
  --    scan context; pre-org-scoping rows are simply NULL). Assign to the
  --    designated org. Safe under the single-tenant assumption.
  UPDATE invoices SET organization_id = designated WHERE organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0022: invoices attributed = %', n;

  -- 2) integration_targets — column added by 0019; create it now so we can
  --    attribute CONFIGURED rows (enabled OR live OAuth token). 0019's
  --    guard F then counts zero. Unconfigured seed rows stay NULL and are
  --    deleted by 0019's own `DELETE … WHERE organization_id IS NULL`.
  ALTER TABLE integration_targets
    ADD COLUMN IF NOT EXISTS organization_id TEXT
    REFERENCES organizations(id) ON DELETE CASCADE;
  UPDATE integration_targets
     SET organization_id = designated
   WHERE organization_id IS NULL
     AND (enabled IS TRUE OR oauth_token_ref IS NOT NULL);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0022: integration_targets configured rows attributed = %', n;

  -- 3) auto_approval_rules — column added by 0019; create it now. Derive via
  --    the (org-specific) vendor where vendors carries organization_id
  --    (drift-dependent → guarded), then assign any remainder to designated.
  ALTER TABLE auto_approval_rules
    ADD COLUMN IF NOT EXISTS organization_id TEXT
    REFERENCES organizations(id) ON DELETE CASCADE;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vendors' AND column_name = 'organization_id'
  ) INTO has_vendor_org;

  IF has_vendor_org THEN
    UPDATE auto_approval_rules r
       SET organization_id = v.organization_id
      FROM vendors v
     WHERE v.id = r.vendor_id
       AND r.organization_id IS NULL
       AND v.organization_id IS NOT NULL;
  END IF;

  UPDATE auto_approval_rules
     SET organization_id = designated
   WHERE organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0022: auto_approval_rules fallback-attributed = %', n;

  -- invoice_files / vendor_month_status: intentionally untouched. 0019
  -- backfills invoice_files from the now-attributed invoices (guard A passes);
  -- unattributable cache rows are deleted by 0019/0020 and self-heal.
END $$;
