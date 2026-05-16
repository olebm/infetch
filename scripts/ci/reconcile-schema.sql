-- CI-only schema reconciliation for the self-hosted E2E stack.
--
-- `supabase start` applies the full migration set (0001–0017) against the
-- local Supabase Postgres. Those migrations lag the application code in two
-- ways that only surface when the real app runs (the unit/integration `test`
-- job patches the same drift inline):
--
--   1. 0001 declares boolean-semantic columns as INTEGER (SQLite-era compat).
--      The app queries them with real boolean predicates (`WHERE enabled IS
--      TRUE`, etc.), which Postgres rejects against an INTEGER column.
--   2. `users.avatar_url` is read by findUserByEmail() but no migration adds
--      it.
--
-- Every statement is idempotent and type-guarded, so this is safe to re-run
-- and never fights a migration that already did the right thing (e.g. 0017
-- already converts integration_targets.enabled).

-- ── INTEGER → BOOLEAN for boolean-semantic columns ────────────────────────────
DO $$
DECLARE
  rec   RECORD;
  bdef  BOOLEAN;
  -- Only columns the app queries with real boolean predicates (e.g.
  -- `WHERE enabled IS TRUE`). This mirrors the proven set from the
  -- unit/integration `test` job. Columns the code still treats as INTEGER
  -- (e.g. invoices.is_private via `COALESCE(is_private, 0) = 0`) must stay
  -- INTEGER — convert a column here only when an E2E run proves it boolean.
  cols  TEXT[][] := ARRAY[
    -- table, column, default-after-conversion
    ['mail_accounts',       'secure',  'true'],
    ['export_targets',      'enabled', 'false'],
    ['auto_approval_rules', 'enabled', 'true'],
    ['discovered_senders',  'blocked', 'false']
  ];
  i INT;
BEGIN
  FOR i IN 1 .. array_length(cols, 1) LOOP
    SELECT data_type = 'integer'
      INTO bdef
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = cols[i][1]
       AND column_name  = cols[i][2];

    IF bdef IS TRUE THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', cols[i][1], cols[i][2]);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE BOOLEAN USING (%I != 0)',
                     cols[i][1], cols[i][2], cols[i][2]);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT %s',
                     cols[i][1], cols[i][2], cols[i][3]);
    END IF;
  END LOOP;
END $$;

-- ── users.avatar_url (read by findUserByEmail, never added by a migration) ─────
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- ── Vendor seed (matcher / self-healing paths exercised by E2E specs) ──────────
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
