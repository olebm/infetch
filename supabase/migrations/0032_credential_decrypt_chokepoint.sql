-- ══════════════════════════════════════════════════════════════════════════════
-- 0032 — Credential-Decrypt-Chokepoint (INFETCH-263a)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Ziel: den Blast-Radius des Credential-Honeypots reduzieren. Heute kann jede
-- DB-Rolle mit Zugriff `vault.decrypted_secrets` direkt lesen → Klartext aller
-- Zugänge (Portal/IMAP/SMTP). Diese Migration etabliert EINE SECURITY-DEFINER-
-- Funktion als einzigen Decrypt-Pfad der App. Damit lässt sich der Decrypt-Zugriff
-- über EXECUTE-Grants steuern.
--
-- WICHTIG: Die App verbindet aktuell als `postgres` (Superuser) → Grants greifen
-- NOCH NICHT (ein Superuser umgeht sie). Der eigentliche Schutz entsteht erst durch
-- den Rollen-/Connection-Split beim Deploy (Lockdown-Block unten): Web-Rolle OHNE
-- EXECUTE, Worker-Rolle MIT. Diese Migration legt nur die Grundlage (Chokepoint)
-- und ändert das Laufzeitverhalten nicht.

CREATE OR REPLACE FUNCTION public.app_read_vault_secret(secret_name text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = secret_name LIMIT 1;
$$;

-- Standardmäßig niemand; service_role behält EXECUTE, damit der aktuelle
-- Single-Prozess-Betrieb (Web+Worker = service_role/postgres) weiterläuft.
REVOKE ALL ON FUNCTION public.app_read_vault_secret(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.app_read_vault_secret(text) TO service_role';
  END IF;
END $$;

-- ── Deploy-Lockdown (MANUELL, sobald die 2-Service-Architektur steht) ──────────
-- Erst hier entsteht der echte Schutz (Web-App kann Zugänge nicht mehr entschlüsseln):
--   1) Worker-Rolle (nur sie darf entschlüsseln):
--        CREATE ROLE portal_worker LOGIN PASSWORD '…';
--        GRANT EXECUTE ON FUNCTION public.app_read_vault_secret(text) TO portal_worker;
--        -- + die übrigen App-Grants (SELECT/INSERT/UPDATE/DELETE auf die App-Tabellen)
--   2) Web-Rolle OHNE EXECUTE auf die Funktion und OHNE Zugriff auf vault.* anlegen.
--   3) EXECUTE von service_role entziehen, sobald beide Services eigene Rollen nutzen:
--        REVOKE EXECUTE ON FUNCTION public.app_read_vault_secret(text) FROM service_role;
--   4) DATABASE_URL je Coolify-Service auf die jeweilige Rolle setzen
--      (Web → Web-Rolle, Worker → portal_worker).
