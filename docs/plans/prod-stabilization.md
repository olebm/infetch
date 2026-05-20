# Plan — Drift-Sanierung, Prod-Migration & Multitenancy-Hardening

> **Tracker-Issue:** [#19](https://github.com/olebm/infetch/issues/19) — fortschreitende Checkliste der 10+3 PRs.

## Context

Drei verwobene Probleme treffen sich am gleichen Code-Pfad:

1. **CI-Drift (strukturell)** — `.github/workflows/ci.yml:85-214` spielt nur 7 von 22 Migrations linear ein (cherry-picked: `0001, 0003, 0014-0018`) und holt die fehlenden 15 mit ~119 Zeilen Inline-`ALTER TABLE` nach. Der E2E-Job nutzt `scripts/ci/reconcile-schema.sql` als zweiten Patch-Block. Drift wird maskiert, nicht gefangen — jeder neue Migrationsschritt muss an drei Stellen parallel gepflegt werden.

2. **Prod-Schema-Drift** — Prod ist Pre-0019, deployter `main` erwartet Post-0019. `/einstellungen` war live 500 (`column "organization_id" does not exist`, 42703); inzwischen resolved (HTTP 200), aber das Schema bleibt strukturell out-of-band. Workaround-Guards aus #13/#14 in `src/lib/auth/account-teardown.ts` halten den Drift kompatibel statt zu beheben.

3. **Multitenancy-Leaks** — `MULTITENANCY_HARDENING_PLAN.md` Phase 1.2/1.3 offen: `src/lib/automation/auto-transfer.ts:91` ruft `readCredentialSecret({scope})` ohne `organizationId` auf; `src/lib/db/queries.ts:63-95` (`getPipelineSnapshot`) zählt global; 9 `saveCredentialSecret`-Aufrufe in `src/app/(app)/einstellungen/actions.ts` ungeprüft. `src/lib/db/client.ts:66-67` exportiert `service_role`-`sql`-Singleton — 53 direkte Imports, keine ESLint-Schranke.

**Ziel:** Drift strukturell verhindern (CI-Gate), Prod-Schema vorwärts auf Post-0022 bringen (Operator-Gate), Multitenancy mechanisch durchsetzen (Wrapper + ESLint). Jede Code-Anpassung wird validiert.

## Validierungs-Prinzip

Jeder PR muss vor Merge:

1. `npm run lint` → 0 warnings (Zero-Warnings-Mode)
2. `npm run test` → Vitest grün (seriell, `vitest.config.ts: fileParallelism=false`)
3. `npm run build` → Next.js Build grün
4. CI grün — alle Jobs (`lint`, `typecheck`, `audit`, `test`, `e2e`)
5. DB-PRs ab PR 5: zusätzlich `migration-drift-gate` grün
6. Multitenancy-PRs ab PR 7: zusätzlich Fuzz-Suite grün

## PR-Sequenz

| # | Was | Validierung |
|---|---|---|
| 1 | `.mcp.json` + Issues + alten Branch entsorgen | Lint, MCP-Lookup |
| 2 | **Dieser Plan** in `docs/plans/` | Doku |
| 3 | `scripts/apply-all-migrations.mjs` (linearer Runner) | Unit-Test gegen ephemere DB |
| 4 | CI ersetzt Inline-Patch durch Runner-Aufruf | CI komplett grün auf Feature-Branch |
| 5 | `tests/fixtures/pre-0019-snapshot.sql` + Drift-Gate-Stage; `reconcile-schema.sql` löschen | `migration-drift-gate` grün |
| 6 | App-Code-Leaks 1.2 + 1.3 | `tenant-isolation*.test.ts` + neue Asserts |
| 7 | Cross-Tenant Fuzz-Harness (Org A vs B) | Demo-Leak-Proof-Run im PR |
| 8 | Scoped-Query-Wrapper + ESLint-`no-restricted-imports` | Lint mit Allowlist grün |
| 9 | **OPERATOR-GATE**: Prod-Migration `0022→0019→0020→0021` | Pre-flight gegen Restore-Klon + Phase-D-Queries + 30 min Sentry-clean |
| 10 | Cleanup nach W5: Drift-Guards raus, Legacy-Skripte löschen | Tests grün ohne Guards |
| 11-13 | Phase-2-Multitenancy (Advisory Lock, Cron-Isolation, Quota-TOCTOU) | Eigene Tests pro PR |

## Korrekturen gegenüber dem alten Plan (`claude/fix-production-errors-wT264`, gelöscht)

| # | Alte Annahme | Realität | Konsequenz |
|---|---|---|---|
| 1 | `/einstellungen` ist akuter Outage | HTTP 200 live | Plan ist Drift-*Prävention*, kein Outage-Fix |
| 2 | `is_private` muss INTEGER bleiben (PR #5) | Commit `88d90c0` hat alles auf `IS TRUE`/`IS NOT TRUE` umgestellt | Sonderbehandlung entfällt |
| 3 | Neue Migration `0023_normalize_boolean_types` | `0021_remaining_boolean_columns.sql` macht das bereits idempotent | `0023` weggelassen |
| 4 | Ziel-Branch `chore/db-multitenant-prod-migration` direkt nutzbar | 0 ahead / 13 behind main | Rebase vor W5 |
| 5 | `designated_org=185109b5-…` hardcoded | `tools@`-Org am 2026-05-19 hart gelöscht, `order@` aktiv | UUID aus Env-Var, Operator setzt sie |

## W5 — Operator-Gate (Details)

**Voraussetzungen vor Approval:**
- PR 1-8 gemerged, CI auf `main` grün
- Pre-flight gegen Restore-Klon des aktuellen Prod-Dumps: `node scripts/apply-all-migrations.mjs "$STAGING_URL" --set app.designated_org=$DESIGNATED_ORG_UUID` — Phase-D-Queries grün
- `$DESIGNATED_ORG_UUID` aus Env (Operator setzt auf aktive Org, **nicht** hardcoded)
- Pre-0019-Dump verifiziert restorbar

**Ablauf (Operator-getrieben):**
1. Operator-Approval (`AskUserQuestion` mit Pre-flight-Beleg)
2. Crons stoppen (mail-scanner, missing-check, self-provisioning)
3. Wartungsflag setzen oder Coolify Container stoppen
4. Frischer `pg_dump`
5. Eine `psql`-Session: `SELECT set_config('app.designated_org', $UUID, false);` → `0022` → `0019` → `0020` → `0021`
6. Phase-D-Verifikationsqueries aus `supabase/migrations/0022_RUNBOOK.md`
7. Funktions-Smoke `/einstellungen` (200, kein 500, eingeloggt)
8. Crons + Writes wieder an
9. Release-Tag

**Rollback:** `pg_restore --clean --if-exists` aus Pre-flight-Dump.

## Kritische Dateien

**Neu:**
- `.mcp.json` (PR 1, bereits gemerged)
- `docs/plans/prod-stabilization.md` (diese Datei)
- `scripts/apply-all-migrations.mjs`
- `tests/unit/apply-all-migrations.test.ts`
- `tests/fixtures/pre-0019-snapshot.sql`
- `tests/integration/tenant-fuzz.test.ts` + `tests/integration/endpoint-registry.ts`
- `src/lib/db/scoped-query.ts` + `src/lib/db/unsafe-global.ts`
- `src/lib/db/advisory-lock.ts` (PR 11)
- `supabase/migrations/README.md` (PR 10)

**Modifiziert:**
- `.github/workflows/ci.yml` (mehrfach: PR 4, 5, 7, 10)
- `eslint.config.mjs`
- `src/lib/auth/current.ts`
- `src/lib/automation/auto-transfer.ts`
- `src/lib/db/queries.ts`
- `src/app/(app)/einstellungen/actions.ts`
- `src/lib/auth/account-teardown.ts` (Drift-Guards raus in PR 10)
- `tests/integration/account-teardown.test.ts`
- `tests/integration/tenant-isolation-queries.test.ts`
- `MULTITENANCY_HARDENING_PLAN.md` (resolved-Markierung in PR 10)

**Gelöscht (nach grünen Vorläufer-PRs):**
- `scripts/ci/reconcile-schema.sql` (in PR 5)
- `scripts/apply-migration.mjs` (in PR 10)

## Wiederverwendete Bausteine

- `postgres`-Lib + Connection-Pattern: `src/lib/db/client.ts:19-67`
- `getCurrentAuth()`-Aufhänger für `scopedSql`: `src/lib/auth/current.ts:20-56`
- Prod-Schutz in `tests/setup.ts:12-16` (unverändert)
- Phase-A–E-Logik aus `supabase/migrations/0022_RUNBOOK.md`
- ESLint-Flat-Config-Basis (`eslint.config.mjs`)
- `tests/integration/tenant-isolation*.test.ts` als Boilerplate für Fuzz-Tests
- `scripts/apply-migration.mjs` als Connection/Env-Reading-Pattern für den neuen Runner

## End-to-End-Verifikation

- **Pro PR:** `lint && test && build` lokal grün + alle CI-Jobs grün
- **Nach PR 4:** Inline-Patch-Block weg, Runner grün gegen leere `postgres:16`-Instanz
- **Nach PR 5:** `migration-drift-gate` grün gegen synthetischen Pre-0019-Snapshot; `reconcile-schema.sql` weg
- **Nach PR 7:** Demo-Leak wird gefangen (Proof-Run im PR-Body verlinkt, vor Merge revertet)
- **Nach PR 8:** Lint schlägt bei neuem bare-`sql`-Import außerhalb Allowlist fehl
- **W5-Pre-flight:** gleiche Kette gegen Restore-Klon grün → Operator-Approval → Maintenance-Fenster
- **Nach W5:** `/einstellungen` 200 eingeloggt, 30 min Sentry-clean, Fuzz-Suite gegen Prod-Schema grün
- **Nach PR 10:** `account-teardown.test.ts` grün ohne Drift-Guards; CI fail-loud bei neuer Migration ohne Snapshot-Update
