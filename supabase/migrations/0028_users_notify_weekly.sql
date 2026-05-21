-- ─────────────────────────────────────────────────────────────────────────────
-- 0028_users_notify_weekly.sql
--
-- Adds users.notify_weekly for the weekly digest opt-in toggle (INFETCH-79).
-- Default FALSE → no emails until the user actively enables the toggle.
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_weekly BOOLEAN NOT NULL DEFAULT FALSE;
