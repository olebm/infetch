-- Convert the remaining INTEGER-as-boolean columns to real BOOLEAN.
--
-- 0001_initial_schema.sql defined several flag columns as INTEGER (0/1) for
-- SQLite compatibility. 0017 already migrated integration_targets.enabled and
-- noted "the rest of the schema moves to BOOLEAN". Until now the rest was only
-- patched in CI (.github/workflows/ci.yml), which masked a real bug: branch
-- code writes/compares booleans against these columns, which throws on the
-- INTEGER schema (operator does not exist: integer = boolean).
--
-- IMPORTANT — schema drift: production already has these columns as BOOLEAN
-- (applied out-of-band, never as a committed migration), while the migration
-- chain (fresh DB / local / CI) still has them as INTEGER. This migration is
-- therefore written to be idempotent: each column is only converted if it is
-- still of type integer. On prod it is a safe no-op; on a fresh DB it performs
-- the real conversion.

DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name='mail_accounts' AND column_name='secure') = 'integer' THEN
    ALTER TABLE mail_accounts ALTER COLUMN secure DROP DEFAULT;
    ALTER TABLE mail_accounts ALTER COLUMN secure TYPE BOOLEAN USING (secure <> 0);
    ALTER TABLE mail_accounts ALTER COLUMN secure SET DEFAULT true;
  END IF;

  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name='discovered_senders' AND column_name='blocked') = 'integer' THEN
    ALTER TABLE discovered_senders ALTER COLUMN blocked DROP DEFAULT;
    ALTER TABLE discovered_senders ALTER COLUMN blocked TYPE BOOLEAN USING (blocked <> 0);
    ALTER TABLE discovered_senders ALTER COLUMN blocked SET DEFAULT false;
  END IF;

  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name='auto_approval_rules' AND column_name='enabled') = 'integer' THEN
    ALTER TABLE auto_approval_rules ALTER COLUMN enabled DROP DEFAULT;
    ALTER TABLE auto_approval_rules ALTER COLUMN enabled TYPE BOOLEAN USING (enabled <> 0);
    ALTER TABLE auto_approval_rules ALTER COLUMN enabled SET DEFAULT true;
  END IF;

  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name='export_targets' AND column_name='enabled') = 'integer' THEN
    ALTER TABLE export_targets ALTER COLUMN enabled DROP DEFAULT;
    ALTER TABLE export_targets ALTER COLUMN enabled TYPE BOOLEAN USING (enabled <> 0);
    ALTER TABLE export_targets ALTER COLUMN enabled SET DEFAULT false;
  END IF;
END $$;
