-- invoices.is_private und vendors.hidden von INTEGER → BOOLEAN.
--
-- SQLite-Alt-Erbe: 0001 deklariert beide als INTEGER. Der App-Code SCHREIBT
-- sie aber bereits als Boolean (`SET is_private = TRUE`, `SET hidden = <bool>`)
-- und liest sie integer-stil (`COALESCE(is_private, 0) = 0`). Keine Schema-
-- Variante machte beides korrekt → in Prod schlugen die Schreib-Actions fehl,
-- im (boolean-reconciliierten) E2E-Stack die Lese-Queries
-- ("COALESCE types boolean and integer cannot be matched").
--
-- Guarded/idempotent: konvertiert nur, wenn die Spalte aktuell INTEGER ist
-- (der E2E-reconcile-Schritt bzw. ein erneuter Lauf konvertiert sonst doppelt).
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'invoices'
          AND column_name = 'is_private') = 'integer' THEN
    ALTER TABLE invoices ALTER COLUMN is_private DROP DEFAULT;
    ALTER TABLE invoices ALTER COLUMN is_private TYPE BOOLEAN USING (is_private != 0);
    ALTER TABLE invoices ALTER COLUMN is_private SET DEFAULT FALSE;
    ALTER TABLE invoices ALTER COLUMN is_private SET NOT NULL;
  END IF;

  IF (SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'vendors'
          AND column_name = 'hidden') = 'integer' THEN
    ALTER TABLE vendors ALTER COLUMN hidden DROP DEFAULT;
    ALTER TABLE vendors ALTER COLUMN hidden TYPE BOOLEAN USING (hidden != 0);
    ALTER TABLE vendors ALTER COLUMN hidden SET DEFAULT FALSE;
  END IF;
END $$;
