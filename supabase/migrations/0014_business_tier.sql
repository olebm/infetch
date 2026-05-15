-- ─────────────────────────────────────────────────────────────────────────────
-- 0014: business-Tier — CHECK-Constraint auf organizations.tier erweitern
--
-- Der Code kennt bereits Tier = 'business' (TIER_LIMITS, getOrgTier), aber
-- der DB-Constraint erlaubt nur ('free', 'pro'). PostgreSQL erlaubt kein
-- ALTER TABLE ... MODIFY CONSTRAINT, daher: alten DROP + neuen ADD.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_tier_check;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_tier_check
    CHECK (tier IN ('free', 'pro', 'business'));
