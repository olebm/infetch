-- ─────────────────────────────────────────────────────────────────────────────
-- 0023_users_avatar_url.sql
--
-- Adds users.avatar_url, which src/lib/db/schema.ts:436 has declared since
-- migration 0001 but no committed migration ever applied. Until now the
-- column was patched into CI via scripts/ci/reconcile-schema.sql (line 57)
-- and presumably exists on prod out-of-band.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, so it's a no-op anywhere the column
-- already exists (prod, the supabase-start E2E stack after past hot-patches).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
