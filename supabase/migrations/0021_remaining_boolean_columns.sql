-- Convert the remaining INTEGER-as-boolean columns to real BOOLEAN.
--
-- 0001_initial_schema.sql defined several flag columns as INTEGER (0/1) for
-- SQLite compatibility. 0017 already migrated integration_targets.enabled and
-- noted "the rest of the schema moves to BOOLEAN". Until now the rest was only
-- patched in CI (.github/workflows/ci.yml), which masked a real bug: branch
-- code writes/compares booleans (e.g. `enabled = TRUE`, INSERT ... TRUE) against
-- these columns, which throws on the real (prod) schema:
--   operator does not exist: integer = boolean
--   column "enabled" is of type integer but expression is of type boolean
--
-- Drop the INTEGER default first — PostgreSQL cannot auto-cast the default
-- expression (e.g. "1") to BOOLEAN during ALTER COLUMN TYPE. Defaults mirror
-- the values the application relies on.

ALTER TABLE mail_accounts ALTER COLUMN secure DROP DEFAULT;
ALTER TABLE mail_accounts ALTER COLUMN secure TYPE BOOLEAN USING (secure <> 0);
ALTER TABLE mail_accounts ALTER COLUMN secure SET DEFAULT true;

ALTER TABLE discovered_senders ALTER COLUMN blocked DROP DEFAULT;
ALTER TABLE discovered_senders ALTER COLUMN blocked TYPE BOOLEAN USING (blocked <> 0);
ALTER TABLE discovered_senders ALTER COLUMN blocked SET DEFAULT false;

ALTER TABLE auto_approval_rules ALTER COLUMN enabled DROP DEFAULT;
ALTER TABLE auto_approval_rules ALTER COLUMN enabled TYPE BOOLEAN USING (enabled <> 0);
ALTER TABLE auto_approval_rules ALTER COLUMN enabled SET DEFAULT true;

ALTER TABLE export_targets ALTER COLUMN enabled DROP DEFAULT;
ALTER TABLE export_targets ALTER COLUMN enabled TYPE BOOLEAN USING (enabled <> 0);
ALTER TABLE export_targets ALTER COLUMN enabled SET DEFAULT false;
