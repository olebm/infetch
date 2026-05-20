-- Convert invoices.is_private and vendors.hidden from INTEGER to BOOLEAN.
--
-- 0001_initial_schema.sql defined these columns as INTEGER (0/1) for
-- SQLite compatibility. 0021_remaining_boolean_columns.sql converted most
-- of the other INTEGER-as-boolean columns but missed these two.
--
-- Production already has these as BOOLEAN (applied out-of-band).
-- This migration is idempotent: each column is only converted if it is
-- still of type integer. On prod it is a safe no-op; on a fresh DB / CI
-- it performs the real conversion.

DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name='invoices' AND column_name='is_private') = 'integer' THEN
    ALTER TABLE invoices ALTER COLUMN is_private DROP DEFAULT;
    ALTER TABLE invoices ALTER COLUMN is_private TYPE BOOLEAN USING (is_private <> 0);
    ALTER TABLE invoices ALTER COLUMN is_private SET DEFAULT false;
  END IF;

  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name='vendors' AND column_name='hidden') = 'integer' THEN
    ALTER TABLE vendors ALTER COLUMN hidden DROP DEFAULT;
    ALTER TABLE vendors ALTER COLUMN hidden TYPE BOOLEAN USING (hidden <> 0);
    ALTER TABLE vendors ALTER COLUMN hidden SET DEFAULT false;
  END IF;
END $$;
