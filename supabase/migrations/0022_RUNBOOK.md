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

## Recon-Ergebnis (Stand: abgeschlossen) & Entscheidungen

- **Echte Org:** genau eine — `tools` = **`185109b5-4a88-44d1-ad22-73d6e8a47f8e`**
  → das ist der `designated_org`-Wert. Checkpoint 1 **aufgelöst**.
- **Constraint-Namen** = PG-Defaults bestätigt → R1 entschärft.
- **0013 ist auf Prod** (`export_targets.organization_id` existiert) → 0013 nicht im Chain.
- `integration_targets` = 0 rows, `auto_approval_rules` = 0 rows → 0019-Guards
  E/F können **nicht** abbrechen. **Einziger** 0019-Blocker: Guard A
  (`invoice_files` der **697 orphan-Invoices**, org=NULL). Die 14 attribuierten
  Invoices gehören Quota-Test-Orgs (Pollution).
- **Strategie: Minimal-Fix zuerst** — KEIN Löschen im kritischen Pfad. Nur
  `0022`(orphans→tools) → `0019/0020/0021`. Die 14 Quota-Test-Invoices
  bekommen via 0019 die org ihrer Quota-Test-Org (harmlos, per-Org-Constraint).
- **Test-Pollution-Purge = separate, spätere Aufgabe** (Junk-Orgs, alle
  bestätigt: `order`, `Test User`, 8× `org-quota-test-*`). Nicht Teil dieses
  Runbooks; eigener Backup+Staging-Lauf, wegen `vendors`-FK-Geflecht.

`<ORG_ID>` in allen Befehlen unten = `185109b5-4a88-44d1-ad22-73d6e8a47f8e`.

---

## Phase A — Backup (blockierend)

```bash
pg_dump "$PROD_DATABASE_URL" -Fc -f infetch-pre-0019-$(date +%Y%m%d-%H%M).dump
createdb infetch_restore_test
pg_restore -d infetch_restore_test infetch-pre-0019-*.dump   # muss fehlerfrei durchlaufen
```

Einziger Rollback = dieser Dump. Es gibt **keine** Down-Migration.

---

## Phase B — Drift-Recon ✓ ABGESCHLOSSEN

Recon gelaufen, Checkpoint 1 aufgelöst (siehe „Recon-Ergebnis" oben):
1 echte Org (`tools` `185109b5-4a88-44d1-ad22-73d6e8a47f8e`), Constraint-Namen
= Defaults, 0013 vorhanden, integration_targets/auto_approval_rules leer,
697 orphan-Invoices. **Kein erneuter Recon nötig** — direkt Phase C.

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
