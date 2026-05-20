-- ─────────────────────────────────────────────────────────────────────────────
-- tests/fixtures/pre-0019-snapshot.sql
--
-- Synthetic snapshot of prod's DB state immediately before the W5 prod
-- migration (0019 → 0020 → 0021 → 0022). Used by the `migration-drift-gate`
-- CI job to prove `apply-all-migrations.mjs` can take this state forward
-- to the current chain.
--
-- Frozen point-in-time — do NOT auto-update if upstream migrations change.
-- When a new migration is added to the chain, refresh this snapshot
-- deliberately (see CI fail-loud step in PR 10).
--
-- Mirrors prod recon (supabase/migrations/0022_RUNBOOK.md, Phase B):
--   * Migration chain 0001, 0003, 0010, 0011, 0013, 0014–0018 applied
--   * 0023_users_avatar_url already present (out-of-band, predates the
--     committed migration)
--   * One designated org (`tools` UUID from the runbook)
--   * Orphan invoices (organization_id NULL) ready for 0022 backfill
--
-- Run from the repo root: `psql ... -f tests/fixtures/pre-0019-snapshot.sql`
-- The \i paths are relative to the current directory of psql at invocation.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Stubs (auth + vault) so the migrations apply on vanilla postgres ─────────
\i tests/fixtures/ci-bootstrap-pre.sql

-- ── Pre-0019 migration chain ─────────────────────────────────────────────────
\i supabase/migrations/0001_initial_schema.sql
\i supabase/migrations/0003_stripe.sql
\i supabase/migrations/0010_rls.sql
\i supabase/migrations/0011_rls_tighten_null_org_leak.sql
\i supabase/migrations/0013_export_targets_per_org.sql
\i supabase/migrations/0014_business_tier.sql
\i supabase/migrations/0015_perf_indexes.sql
\i supabase/migrations/0016_stripe_idempotency.sql
\i supabase/migrations/0017_integration_targets_bool.sql
\i supabase/migrations/0018_stripe_event_ordering.sql

-- ── Out-of-band drift: users.avatar_url applied pre-W5, no migration in chain
--    (committed migration 0023 will be a no-op against this snapshot via
--    ADD COLUMN IF NOT EXISTS — that is the drift behavior we want to prove)
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- ── Migration tracking: mark the snapshot as applied ─────────────────────────
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.schema_migrations (version) VALUES
  ('0001'), ('0003'), ('0010'), ('0011'), ('0013'),
  ('0014'), ('0015'), ('0016'), ('0017'), ('0018')
ON CONFLICT (version) DO NOTHING;

-- ── Seed: designated org + owner + orphan invoices (0022 backfill target) ────
INSERT INTO users (id, email, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'tools-test@infetch.local', 'Tools Test Owner')
ON CONFLICT (id) DO NOTHING;

INSERT INTO organizations (id, name, slug, owner_user_id) VALUES
  ('185109b5-4a88-44d1-ad22-73d6e8a47f8e',
   'tools (test)',
   'tools-test',
   '00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Orphan invoices — organization_id NULL. 0022 will backfill these to the
-- designated org, then 0019 expects them to be attributed.
INSERT INTO invoices (vendor_id, source, status, invoice_number, organization_id) VALUES
  (NULL, 'manual', 'new',          'PROD-DRIFT-001', NULL),
  (NULL, 'manual', 'needs_review', 'PROD-DRIFT-002', NULL),
  (NULL, 'manual', 'ready',        'PROD-DRIFT-003', NULL);
