-- Performance: Composite index for monthly invoice count query used in tier quota checks.
-- getMonthlyImportCount() filters by organization_id + created_at on every PDF import.
-- Without this, the query does a full table scan as invoice volume grows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_org_created
  ON invoices (organization_id, created_at DESC);

-- Supporting index for the dedupe_key uniqueness check in the import pipeline.
-- Already covered by the UNIQUE constraint in 0001, but making it explicit.
-- (No-op if constraint index already exists.)
