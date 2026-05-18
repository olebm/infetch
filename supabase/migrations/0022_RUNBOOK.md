# Runbook — Multitenancy-Schema auf Prod bringen (0022 → 0019 → 0020 → 0021)

**Kontext:** `main` (deployt) erwartet das Post-0019-Schema, die Prod-DB ist
aber Pre-0019 → org-gescopte Seiten (z. B. `/einstellungen`) liefern 500
(`column "organization_id" does not exist`, Postgres 42703). Migrationen
laufen auf Prod **manuell** (kein Auto-Migrate beim Deploy). Prod ist bereits
jetzt kaputt für org-Seiten → diese Migration ist Vorwärts-Recovery, kein
Eingriff in einen funktionierenden Zustand.

`chore/db-refactor-wip` ist **totes Cruft** (würde 0018–0021 zurückdrehen) →
nicht mergen, am besten löschen.

> SQL wird vom Operator ausgeführt (kein Prod-/Staging-DB-Zugriff aus der
> Entwicklungsumgebung). Reihenfolge strikt einhalten. Bei jedem Fehler:
> stoppen, Dump zurückspielen, nicht ad-hoc patchen.

---

## Phase A — Backup (blockierend)

```bash
pg_dump "$PROD_DATABASE_URL" -Fc -f infetch-pre-0019-$(date +%Y%m%d-%H%M).dump
createdb infetch_restore_test
pg_restore -d infetch_restore_test infetch-pre-0019-*.dump   # muss fehlerfrei durchlaufen
```

Einziger Rollback = dieser Dump. Es gibt **keine** Down-Migration.

---

## Phase B — Drift-Recon (read-only gegen Prod)

```sql
-- echte Tenant-Zahl (entscheidet single- vs multi-tenant Backfill)
SELECT count(*) FROM organizations WHERE deleted_at IS NULL;
SELECT id, name, slug FROM organizations WHERE deleted_at IS NULL;

-- Orphans / Guard-Flächen
SELECT count(*) AS total, count(organization_id) AS attribuiert FROM invoices;
SELECT count(*) FROM integration_targets WHERE enabled IS TRUE OR oauth_token_ref IS NOT NULL;
SELECT id, provider, label, enabled, oauth_token_ref FROM integration_targets;
SELECT count(*) FROM auto_approval_rules;

-- 0013-Status (export_targets) — wenn 0 Zeilen, ist auch 0013 offen!
SELECT 1 FROM information_schema.columns
 WHERE table_name='export_targets' AND column_name='organization_id';

-- Constraint-Namen (R1 — NICHT den PG-Defaults vertrauen)
SELECT conname, conrelid::regclass FROM pg_constraint
 WHERE conrelid::regclass::text IN
   ('invoice_files','vendor_month_status','integration_targets','discovered_senders')
 AND contype='u';
```

### ► Checkpoint 1 (Entscheidung)
- **Genau 1 aktive Org:** `0022`-Blanket-Zuweisung ist sicher → weiter.
- **Mehrere Orgs:** **STOP.** Blanket-Fallback würde fremde Tenant-Daten
  zusammenmischen. Dann Pro-Tenant-Ableitung nötig (nicht in diesem Runbook).
- Constraint-Namen müssen den 0019/0020-Erwartungen entsprechen:
  `invoice_files_sha256_key`, `vendor_month_status_vendor_id_year_month_key`,
  `integration_targets_provider_key`, `discovered_senders_from_address_key`.
  Weichen sie ab → melden, bevor es weitergeht (sonst bleibt der alte globale
  UNIQUE als latente Falle bestehen).
- `<ORG_ID>` = id der einen aktiven Org aus dieser Recon.

---

## Phase C — Staging-Dry-Run (gegen den Restore-Klon)

```bash
DB="postgres://…/infetch_restore_test"
psql "$DB" -v ON_ERROR_STOP=1 \
  -c "SELECT set_config('app.designated_org','<ORG_ID>',false)" \
  -f supabase/migrations/0022_prebackfill_org_attribution.sql \
  -f supabase/migrations/0019_multitenant_isolation.sql \
  -f supabase/migrations/0020_discovered_senders_per_org.sql \
  -f supabase/migrations/0021_remaining_boolean_columns.sql
```

`psql` führt `-c` und `-f` auf **einer** Verbindung aus → die GUC
`app.designated_org` bleibt für 0022 **und** 0019 gesetzt.
Erwartung: keine `RAISE EXCEPTION`; `0022`-`NOTICE`s zeigen die attribuierten
Zähler (invoices / integration_targets / auto_approval_rules).

---

## Phase D — Verifikation (erst Klon, später identisch auf Prod)

```sql
-- alle 6 Tabellen haben jetzt organization_id
SELECT table_name FROM information_schema.columns WHERE column_name='organization_id'
 AND table_name IN ('invoice_files','vendor_month_status','auto_approval_rules',
                    'integration_targets','discovered_senders','export_targets');  -- 6 Zeilen

-- keine verbleibenden NULLs, wo 0019 Attribution verlangt
SELECT count(*) FROM invoices WHERE organization_id IS NULL;                                    -- 0
SELECT count(*) FROM auto_approval_rules WHERE organization_id IS NULL;                         -- 0
SELECT count(*) FROM integration_targets
  WHERE organization_id IS NULL AND (enabled IS TRUE OR oauth_token_ref IS NOT NULL);            -- 0

-- neue Per-Org-Indizes da, alte globale Constraints weg
SELECT indexname FROM pg_indexes WHERE indexname IN
 ('uniq_invoice_files_org_sha256','uniq_vms_org_vendor_month',
  'uniq_integration_targets_org_provider','uniq_discovered_senders_org_addr');                   -- 4
SELECT conname FROM pg_constraint WHERE conname IN
 ('invoice_files_sha256_key','integration_targets_provider_key',
  'vendor_month_status_vendor_id_year_month_key','discovered_senders_from_address_key');         -- 0 Zeilen
```

---

## Phase E — Prod (nur nach grünem Staging + Checkpoint 1)

1. Kurzes Wartungsfenster ankündigen; Crons (`mail-scanner`, `missing-check`,
   `self-provisioning`) und App-Writes einfrieren (Coolify: Container stoppen
   oder Maintenance-Flag). Keinen laufenden Import abwürgen.
2. Exakt denselben `psql`-Block wie Phase C, aber gegen `"$PROD_DATABASE_URL"`.
3. Phase-D-Verifikation gegen Prod.
4. Funktional als eingeloggter User: `https://app.infetch.de/einstellungen`
   (200, kein „konnte nicht geladen werden"), zusätzlich `/senders`,
   `/invoices`, `/audit`.
5. Grün → Wartungsfenster beenden, Crons reaktivieren. `missing-check` einmal
   triggern (Cache `vendor_month_status` baut sich pro Org neu auf; bis dahin
   ist „Fehlende" leer — erwartet). Sentry beobachten: kein neues 42703.

---

## Rollback

```bash
# vorher auf Klon testen, dann (mit User-Freigabe) gegen Prod:
pg_restore --clean --if-exists -d "$PROD_DATABASE_URL" infetch-pre-0019-*.dump
```

Caches (`vendor_month_status`, `discovered_senders`-Block-Status) werden von
0019/0020 destruktiv geleert und sind nur über den Dump wiederherstellbar —
deshalb ist Phase A blockierend.

---

## Risiken (Kurz)

- **R1 (hoch):** Abweichende Constraint-Namen → `DROP CONSTRAINT IF EXISTS`
  no-opt still, alter globaler UNIQUE überlebt, 2. Org-Insert scheitert später.
  Per Phase B + D abgesichert.
- **R2 (hoch):** Orphan-Zuweisung ist praktisch irreversibel. Bei >1 Org →
  Cross-Tenant-Leak. Deshalb Checkpoint 1 zwingend.
- **R3 (mittel):** Cache-Deletes unwiederbringlich außer per Dump; Block-Status
  ggf. pro Org neu setzen.
- **R4 (mittel):** Migration **genau einmal** im eingefrorenen Fenster fahren
  (erneutes Ausführen mit neuen NULL-Rows könnte frische Daten löschen).
