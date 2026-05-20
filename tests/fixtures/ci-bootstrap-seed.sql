-- ─────────────────────────────────────────────────────────────────────────────
-- tests/fixtures/ci-bootstrap-seed.sql
--
-- Post-migration seed data for CI test/e2e jobs. Runs AFTER
-- apply-all-migrations.mjs so vendors / vendor_aliases tables exist.
-- Idempotent via ON CONFLICT.
--
-- Mirrors the seed block previously embedded in .github/workflows/ci.yml
-- (lines 197-213) and scripts/ci/reconcile-schema.sql (lines 60-75).
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO vendors (name, canonical_key, category) VALUES
  ('OpenAI',    'openai',    'software'),
  ('Anthropic', 'anthropic', 'software')
ON CONFLICT (canonical_key) DO NOTHING;

INSERT INTO vendor_aliases (vendor_id, alias, match_type)
SELECT id, 'openai',        'contains' FROM vendors WHERE canonical_key = 'openai'
UNION ALL
SELECT id, 'openai.com',    'domain'   FROM vendors WHERE canonical_key = 'openai'
UNION ALL
SELECT id, 'anthropic',     'contains' FROM vendors WHERE canonical_key = 'anthropic'
UNION ALL
SELECT id, 'claude',        'contains' FROM vendors WHERE canonical_key = 'anthropic'
UNION ALL
SELECT id, 'anthropic.com', 'domain'   FROM vendors WHERE canonical_key = 'anthropic'
ON CONFLICT DO NOTHING;
