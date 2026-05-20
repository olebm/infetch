#!/usr/bin/env bash
#
# W5 Pre-flight: validates that 0019→0022 will apply cleanly against a
# restore-clone of the current Prod dump.
#
# This is what the `migration-drift-gate` CI job does, pointed at the
# real clone instead of a synthetic snapshot. A green pre-flight is the
# evidence that goes to the operator approval (`AskUserQuestion`) before
# the Phase-E window opens against Prod.
#
# Usage:
#   STAGING_URL='postgres://...restore_clone...'  \
#   DESIGNATED_ORG='<uuid>'                       \
#   ./scripts/prod-migration-preflight.sh
#
# Exit codes:
#   0  green — Phase D invariants hold, safe to schedule Phase E
#   1  argv / env error
#   2  Phase C (migration apply) failed
#   3  Phase D (verification) failed — specific invariants listed
#
# Phase A (pg_dump + restore) is operator-manual — this script assumes
# STAGING_URL already points at a fresh restore-clone.
#
set -euo pipefail

# ── argv / env ───────────────────────────────────────────────────────────────
if [[ -z "${STAGING_URL:-}" ]]; then
  echo "❌ STAGING_URL is required (postgres URL of the restore-clone)"
  exit 1
fi
if [[ -z "${DESIGNATED_ORG:-}" ]]; then
  echo "❌ DESIGNATED_ORG is required (UUID of the org to attribute orphan rows to)"
  echo "   Verify against the restore-clone first:"
  echo "   psql \"\$STAGING_URL\" -c \"SELECT id, slug FROM organizations WHERE deleted_at IS NULL ORDER BY created_at\""
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "──────────────────────────────────────────────────────────────────────────"
echo " W5 Pre-flight"
echo "   STAGING_URL    = ${STAGING_URL%@*}@<redacted>"
echo "   DESIGNATED_ORG = $DESIGNATED_ORG"
echo "──────────────────────────────────────────────────────────────────────────"

# ── Phase C: apply the chain ─────────────────────────────────────────────────
echo
echo "▶ Phase C — apply migrations via runner (snapshot-mode=prod-replay)"
echo

if ! node scripts/apply-all-migrations.mjs "$STAGING_URL" \
    --snapshot-mode=prod-replay \
    --skip=0002 \
    --set app.designated_org="$DESIGNATED_ORG"; then
  echo
  echo "❌ Phase C failed — migration chain did not apply cleanly."
  echo "   Inspect the runner output above. Do NOT proceed to Phase E."
  exit 2
fi

# ── Phase D: verification queries (from 0022_RUNBOOK.md) ─────────────────────
echo
echo "▶ Phase D — invariant verification"
echo

TMP_CSV="$(mktemp -t phase-d.XXXXXX.csv)"
trap 'rm -f "$TMP_CSV"' EXIT

psql "$STAGING_URL" -v ON_ERROR_STOP=1 -X --csv -t <<'SQL' > "$TMP_CSV"
  SELECT 'has_org_id_columns',
         COUNT(*) FILTER (WHERE column_name = 'organization_id')
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN (
       'invoice_files','vendor_month_status','auto_approval_rules',
       'integration_targets','discovered_senders','export_targets'
     );

  SELECT 'invoices_null_org',
         COUNT(*) FROM invoices WHERE organization_id IS NULL;

  SELECT 'rules_null_org',
         COUNT(*) FROM auto_approval_rules WHERE organization_id IS NULL;

  SELECT 'per_org_indexes',
         COUNT(*) FROM pg_indexes WHERE indexname IN (
           'uniq_invoice_files_org_sha256',
           'uniq_integration_targets_org_provider',
           'uniq_discovered_senders_org_addr',
           'uniq_vms_org_vendor_month'
         );

  SELECT 'old_global_constraints',
         COUNT(*) FROM pg_constraint WHERE conname IN (
           'invoice_files_sha256_key','integration_targets_provider_key',
           'vendor_month_status_vendor_id_year_month_key',
           'discovered_senders_from_address_key'
         );
SQL

echo "  Phase-D measurements:"
cat "$TMP_CSV" | sed 's/^/    /'
echo

fail=0
while IFS=, read -r key val; do
  key=${key// /}; val=${val// /}
  case "$key" in
    has_org_id_columns)
      [[ "$val" == "6" ]] || { echo "  ✗ $key=$val (expected 6)"; fail=1; }
      ;;
    invoices_null_org)
      [[ "$val" == "0" ]] || { echo "  ✗ $key=$val (expected 0 — 0022 backfill incomplete)"; fail=1; }
      ;;
    rules_null_org)
      [[ "$val" == "0" ]] || { echo "  ✗ $key=$val (expected 0 — 0019 backfill incomplete)"; fail=1; }
      ;;
    per_org_indexes)
      [[ "$val" == "4" ]] || { echo "  ✗ $key=$val (expected 4 per-org UNIQUE indexes)"; fail=1; }
      ;;
    old_global_constraints)
      [[ "$val" == "0" ]] || { echo "  ✗ $key=$val (expected 0 — old global UNIQUEs still present)"; fail=1; }
      ;;
  esac
done < "$TMP_CSV"

if [[ $fail -ne 0 ]]; then
  echo
  echo "❌ Phase D verification failed. Do NOT proceed to Phase E."
  echo "   Investigate the offending invariant above; the runbook"
  echo "   (supabase/migrations/0022_RUNBOOK.md) has the rationale for each."
  exit 3
fi

echo
echo "✅ Pre-flight green."
echo "   Phase E may proceed under operator approval (Maintenance window,"
echo "   pg_dump of prod, then the SAME runner invocation against prod)."
