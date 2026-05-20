-- ─────────────────────────────────────────────────────────────────────────────
-- tests/fixtures/ci-bootstrap-pre.sql
--
-- Pre-migration bootstrap for the CI `test` job (vanilla postgres:16).
-- Provides stubs for Supabase-specific objects so the migration chain can
-- run linearly without --skip exclusions for RLS-using migrations.
--
-- Idempotent + guarded so it is also safe (no-op) against the real Supabase
-- stack in the `e2e` job.
--
-- Two stubs:
--   1. auth.uid() — referenced by RLS policies in 0010/0011/0013/0019/0020.
--      Stub returns NULL; under the CI `ci` superuser RLS is bypassed anyway.
--   2. Supabase Vault — schema + table + view + create_secret() so app code
--      can write/read secrets in tests. supabase_vault extension itself
--      (migration 0002) is skipped because the binary is not installed on
--      vanilla postgres:16.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── auth.uid() stub ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    CREATE SCHEMA IF NOT EXISTS auth;
    EXECUTE 'CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL STABLE AS $func$ SELECT NULL::UUID $func$';
  END IF;
END $$;

-- ── Supabase Vault stub ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'supabase_vault') THEN
    CREATE SCHEMA IF NOT EXISTS vault;

    CREATE TABLE IF NOT EXISTS vault.secrets (
      id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name   TEXT NOT NULL UNIQUE,
      secret TEXT NOT NULL
    );

    EXECUTE 'CREATE OR REPLACE VIEW vault.decrypted_secrets AS '
         || 'SELECT id, name, secret AS decrypted_secret FROM vault.secrets';

    EXECUTE 'CREATE OR REPLACE FUNCTION vault.create_secret(p_secret TEXT, p_name TEXT) '
         || 'RETURNS UUID LANGUAGE SQL AS $func$ '
         || 'INSERT INTO vault.secrets (name, secret) VALUES (p_name, p_secret) RETURNING id '
         || '$func$';
  END IF;
END $$;
