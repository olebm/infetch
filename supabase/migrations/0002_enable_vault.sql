-- ─────────────────────────────────────────────────────────────────────────────
-- 0002_enable_vault.sql
-- Aktiviert Supabase Vault (pgsodium) für serverseitige Secret-Verschlüsselung.
-- Ersetzt den AES-256-GCM Encrypted-DB-Store (SECRET_ENCRYPTION_KEY nicht mehr nötig).
-- ─────────────────────────────────────────────────────────────────────────────

-- Supabase Vault Extension aktivieren (enthält pgsodium + vault Schema)
CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;
