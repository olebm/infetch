# Übergabe: Multi-Tenancy-Härtung

**Branch:** `claude/analyze-codebase-14Vf4`
**Zweck dieses Dokuments:** Selbsterklärende Übergabe an die Person/das Team,
das diesen Branch testet, migriert und nach Prod bringt. Es ist kein
Konversationskontext nötig — alles Relevante steht hier.

> ⚠️ **Nichts davon wurde ausgeführt.** Erstellt in einer Cloud-Session ohne
> `node_modules` und ohne Zugriff auf die echte infetch-DB (der dort
> verbundene Supabase-MCP zeigte auf fremde „skillmatch"-Projekte). Migrationen
> und Tests müssen lokal/Staging laufen. Korrektheit ist bisher nur
> Review-basiert geprüft.

---

## 1. Was dieser Branch enthält

Behebt eine **Mandantentrennungs-Lücke**: fünf Tabellen waren single-tenant
(keine `organization_id`, teils global-eindeutige Constraints) → Cross-Tenant-
Leaks und Funktionsbugs sobald mehr als eine Organisation in der DB ist.

### Commits (relevant ab `3d61833`)

| Commit | Inhalt |
|--------|--------|
| `3d0e749` | (separat) Login: User-Provisioning im OTP-Code-Pfad + 6 Ziffernfelder |
| `87d5c7f` | Migration **0019** + Wiring: `invoice_files`, `vendor_month_status`, `auto_approval_rules`, `integration_targets` org-scopen |
| `567e927` | `MULTITENANCY_HARDENING_PLAN.md` (Roadmap, weiterhin gültig) |
| `a1067ac` | Migration **0020** + Refactor: `discovered_senders` org-scopen (Scanner/Crons/Actions) |
| `ba1754d` | Fix: Missing-Check filtert Vendors pro Org (Regression aus 0019-Loop) |
| `f94eca1` | Fix: 0019 bricht nicht mehr bei verwaisten `invoice_files` ab |

> `3d0e749` (Login-Fix) ist fachlich unabhängig und kann separat reviewt werden.

---

## 2. Migrationen

Reihenfolge zwingend: **0019 vor 0020**. Beide folgen der Projektkonvention
(0011/0013): Pre-Prod-Annahme — konfigurierte Tenant-Daten, die nicht sicher
zugeordnet werden können, **brechen die Migration ab** (`RAISE EXCEPTION`)
statt still falsch attribuiert zu werden. Cache-Tabellen werden bei
Nicht-Zuordenbarkeit geleert (selbstheilend).

### `0019_multitenant_isolation.sql`

| Tabelle | Änderung |
|---------|----------|
| `invoice_files` | + `organization_id`; Backfill aus `invoices`; `sha256` GLOBAL UNIQUE → `UNIQUE(organization_id, sha256)`; RLS org-scoped. Verwaiste Rows (`invoice_id IS NULL`) bleiben org-los (legitim, kein Abbruch). |
| `vendor_month_status` | + `organization_id`; Backfill via invoice/vendor; nicht zuordenbare Cache-Rows gelöscht; `UNIQUE(vendor_id,year_month)` → `UNIQUE(organization_id,vendor_id,year_month)`; RLS. |
| `auto_approval_rules` | + `organization_id`; Backfill via Vendor; **Abbruch** bei nicht zuordenbaren konfigurierten Regeln; RLS. |
| `integration_targets` | + `organization_id`; **Abbruch** bei konfigurierten Rows (`enabled<>0` oder `oauth_token_ref`); `UNIQUE(provider)` → `UNIQUE(organization_id,provider)`; RLS. |

### `0020_discovered_senders_per_org.sql`

`discovered_senders`: + `organization_id`; Backfill via gematchten Vendor;
restlicher Scan-Cache (inkl. Block-Status) wird geleert → beim nächsten Scan
pro Org neu entdeckt; `from_address` GLOBAL UNIQUE →
`UNIQUE(organization_id, from_address)`; RLS.
**Achtung:** zuvor gesetzte Block-Status nicht zuordenbarer Sender gehen
verloren und müssen pro Org neu gesetzt werden.

---

## 3. Code-Änderungen (org-scoped gemacht)

- **Import-Pipeline** (`src/invoices/import-pipeline.ts`): sha256-Dedup,
  `invoice_files`-Insert, `vendor_month_status`-Upsert.
- **Crons** (jetzt pro Org): `src/invoices/missing-check.ts`,
  `src/lib/automation/self-provisioning.ts`.
- **Auto-Approval-Kette**: `auto-approval.ts` → `extract-invoice.ts`,
  `reeval-queue.ts`.
- **Queries** (`src/lib/db/queries.ts`): Dashboard, Auto-Approval,
  Integrationen, Senders; toter Code `listAutoApprovalRules()` entfernt.
- **Settings/Actions**: `einstellungen/actions.ts`, `senders/actions.ts`,
  `audit/actions.ts`; `auto-transfer.ts`.
- **discovered_senders-Subsystem**: `src/senders/discovered-senders.ts`
  (alle Reader/Writer), `src/mail/mail-scanner.ts` (Org pro Account),
  `src/vendors/auto-alias.ts` (org-scoped Update), Onboarding-Erstabruf.

---

## 4. NICHT enthalten / bewusst zurückgestellt

- **`settings`-Tabelle** weiterhin global (z. B. `auto_approve_confidence`).
  Entscheidung nötig: pro Org oder bewusst global? (Plan-Phase 1.3)
- **Credential-Store-Scoping** (Plan-Phase 1.2): einige
  `saveCredentialSecret`-Aufrufe übergeben keine `organizationId`.
  **Noch offen** — eigener Task.
- **Vendor-Mandantenfähigkeit**: `vendors.canonical_key` ist global UNIQUE;
  auto-erstellte Vendors sind jetzt org-gebunden, aber Key-Kollisionen
  zwischen Orgs werden per Suffix gelöst (Duplikate). Tiefer out-of-scope.
- **Reliability/Skalierung** (Plan-Phase 2/3): per-Org Advisory Lock,
  Fehler-Isolation in Cron-Schleifen, Quota-TOCTOU, Job-Queue. Offen.

---

## 5. Offene Befunde aus dem internen Test-Report

| ID | Sev | Befund | Status |
|----|-----|--------|--------|
| 2.1 | P0 | Missing-Check zog globale Vendor-Liste pro Org → fremde „missing"-Rows | ✅ `ba1754d` |
| 1.1 | P1 | 0019-Abbruch bei verwaisten `invoice_files` | ✅ `f94eca1` |
| 3.x | P1 | `typecheck`/`lint`/`test` nicht ausgeführt | ⬜ Desktop-Schritt 1 |
| 4.1 | P1 | Missing-Check O(Orgs×Vendors×Monate) + Query/Upsert pro Tripel → Timeout-Risiko; Fehler-Isolation fehlt | ⬜ offen (Plan-Phase 2.2 + Bulk-Upsert) |
| 1.3 | P2 | `DROP CONSTRAINT IF EXISTS` setzt PG-Default-Namen voraus | ⬜ Desktop-Schritt 2 |
| 1.2 | P2 | Dashboard `missing/actionRequired` = 0 bis erster Missing-Check-Cron nach Migration | ⬜ Erwartung kommunizieren |
| 4.2 | P2 | `backfill`/`autoAssign` user-getriggert laufen systemweit (kein Leak, aber Fremd-Org-Arbeit) | ⬜ Design-Entscheidung |
| 1.4 / 2.4 / 4.4 | P3 | NULL-org UNIQUE-Semantik / No-Org-User / Vendor-Key-Kollision | ⬜ dokumentiert |

---

## 6. Ausführungsplan (Desktop / Staging)

### Schritt 1 — Statik (Pflicht, vor allem anderen)
```bash
npm ci
npm run typecheck
npm run lint
npm test
```
Muss grün sein. Deckt Befund 3.x ab (in der Cloud nicht prüfbar).

### Schritt 2 — Pre-Migration-Checks gegen echte DB
```sql
-- Befund 1.1: legitime Orphans (ok, bleiben org-los) vs. anomale Rows
SELECT count(*) FROM invoice_files WHERE invoice_id IS NULL;                 -- ok, bleiben NULL-org
SELECT count(*) FROM invoice_files WHERE invoice_id IS NOT NULL
  AND id NOT IN (SELECT id FROM invoice_files f JOIN invoices i ON i.id=f.invoice_id);
-- Befund 1.3: tatsächliche Constraint-Namen verifizieren
\d invoice_files
\d vendor_month_status
\d integration_targets
\d discovered_senders
```
Stimmt ein Constraint-Name nicht mit dem `DROP CONSTRAINT IF EXISTS` in
`0019`/`0020` überein → Migrationsdatei anpassen (sonst bleibt der alte
globale UNIQUE bestehen und der 2.-Org-Insert schlägt später fehl).

### Schritt 3 — Migration auf **Staging** (nicht Prod)
```bash
psql "$STAGING_DATABASE_URL" -f supabase/migrations/0019_multitenant_isolation.sql
psql "$STAGING_DATABASE_URL" -f supabase/migrations/0020_discovered_senders_per_org.sql
# oder: supabase db push
```
- Guards **nicht** entfernen. Bei `RAISE EXCEPTION`: betroffene Daten pro Org
  klonen/zuordnen, dann erneut.
- Erwartung (1.2) festhalten: Dashboard `missing/actionRequired` = 0 bis der
  Missing-Check-Cron einmal lief.

### Schritt 4 — 2-Org-Funktionstest (Org A + Org B)
- Gleiches PDF in beide Orgs → **keine** fälschliche Dublette.
- Auto-Approval-Regel in A → greift **nicht** in B.
- Lexoffice in A konfigurieren → in B unsichtbar; Auto-Transfer nutzt A's Key.
- Absender mailt an beide → getrennte Zähler; **Block in A blockt B nicht**.
- `markSenderDomainPrivateAction` in A betrifft nur A.

### Schritt 5 — Cron-Verifikation
- `missing-check`, `self-provisioning`, `backfill`, `autoAssign` manuell
  triggern.
- Prüfen: A's `vendor_month_status` enthält **keine** fremden Vendors
  (Regressions-Test zu 2.1). Laufzeit messen (4.1).

### Schritt 6 — Negativtest (Reliability)
- Eine von zwei Orgs mit absichtlich kaputtem IMAP-Credential → die andere
  Org muss trotzdem durchlaufen. Falls der ganze Cron abbricht: Plan-Phase
  2.2 (Fehler-Isolation pro Org) ist Pflicht vor Prod.

### Schritt 7 — Prod
Erst nach grünem Staging: Backup + Wartungsfenster, `0019` dann `0020`,
danach 2-Org-Stichprobe auf Prod.

---

## 7. Rollback

- Migrationen sind additiv (Spalten/Indizes), aber **destruktiv** bei den
  `DELETE`-Schritten (geleerte Cache-Rows von `vendor_month_status` /
  `discovered_senders`). Diese heilen sich via Cron, sind aber nicht
  wiederherstellbar → **DB-Backup vor Prod-Migration zwingend**.
- Kein automatisches Down-Migrationsskript. Rollback = Restore aus Backup.
- Code und Migration sind gekoppelt: alter Code + neue Migration bricht
  (z. B. `ON CONFLICT(provider)` existiert nicht mehr). Deploy atomar
  (Code + Migration zusammen), nicht teilweise.

---

## 8. Entscheidungen, die der Empfänger treffen muss

1. `settings`-Tabelle pro Org oder bewusst global? (steuert Mini-Migration)
2. `backfill`/`autoAssign` aus der UI: systemweit lassen oder auf User-Org
   einschränken? (4.2)
3. Reihenfolge der offenen Plan-Phasen (1.2 Credential-Store, 2.2
   Reliability) relativ zum Prod-Rollout.

Details zu allen offenen Phasen: `MULTITENANCY_HARDENING_PLAN.md` im selben
Branch.
