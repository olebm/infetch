# Multi-Tenancy Hardening — Ausführungsplan

Stand: Branch `claude/analyze-codebase-14Vf4`, nach Migration `0019` (4 Tabellen
org-scoped: invoice_files, vendor_month_status, auto_approval_rules,
integration_targets) + Code-Wiring.

Dieser Plan wird **lokal auf dem Desktop** ausgeführt (node_modules vorhanden,
echte infetch-DB erreichbar, Tests lauffähig). Reihenfolge ist bewusst gewählt:
erst 0019 verifizieren, dann offene Leaks, dann Reliability, dann Skalierung.

---

## Phase 0 — Voraussetzung: 0019 verifizieren (zuerst!)

Bevor irgendetwas Neues: den bereits gepushten Stand absichern.

1. Branch lokal auschecken, `npm install`, `npm run typecheck` + `npm run lint`
   + `npm test` grün bekommen. (In der Cloud-Session war das nicht möglich —
   hier ist die erste echte Prüfung.)
2. Migration `0019` gegen **Staging** anwenden (nicht Prod):
   `supabase db push` bzw. `psql "$STAGING_DATABASE_URL" -f supabase/migrations/0019_multitenant_isolation.sql`
3. Die `RAISE EXCEPTION`-Guards beachten: Bricht die Migration ab, existieren
   konfigurierte Daten, die manuell pro Org geklont/zugeordnet werden müssen,
   bevor erneut ausgeführt wird. **Nicht** die Guards entfernen.
4. Manueller 2-Org-Smoke-Test auf Staging:
   - Org A + Org B anlegen (2 Magic-Link-Accounts).
   - Je ein PDF importieren → dasselbe PDF in beide Orgs: darf **nicht** als
     Dublette abgewiesen werden (invoice_files org-scoped sha256).
   - Auto-Approval-Regel in Org A → darf in Org B nicht greifen.
   - Lexoffice-Integration in Org A konfigurieren → Org B sieht sie nicht.
   - `missing-check` + `self-provisioning` Cron einmal manuell triggern,
     Logs auf Fehler prüfen.
5. Erst wenn Staging sauber: Prod-Migration einplanen (Wartungsfenster, Backup).

**Definition of Done:** Tests grün, Migration auf Staging ohne Abbruch,
2-Org-Smoke-Test ohne Cross-Tenant-Sichtbarkeit.

---

## Phase 1 — Offene Leaks schließen (P0)

### 1.1 `discovered_senders` org-scopen (Rest aus 0019)

**Problem:** `from_address` ist GLOBAL UNIQUE. Absender-Cache **und
Block-Status** über alle Orgs geteilt. Org A blockt → Org B's Scan
überspringt denselben Absender.

**Migration `0020_discovered_senders_per_org.sql`** (Muster: 0019 Abschnitt 4):
- `ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE`
- Backfill via `matched_vendor_id → vendors.organization_id` wo möglich.
- Rest ist reiner Scan-Cache → `DELETE WHERE organization_id IS NULL`
  (heilt sich beim nächsten Scan; Block-Status muss ggf. pro Org neu gesetzt
  werden — im Migrations-Kommentar dokumentieren).
- `DROP CONSTRAINT discovered_senders_from_address_key`
- `CREATE UNIQUE INDEX ... (organization_id, from_address)`
- Index `(organization_id)` + org-scoped RLS-Policy (Muster 0019).

**Code (`src/senders/discovered-senders.ts`) — jede Funktion braucht `organizationId`:**
- `recordSenderObservation(obs, orgId)` — INSERT + `ON CONFLICT(organization_id, from_address)`; der nachgelagerte `SELECT ... WHERE from_address` muss `AND organization_id IS NOT DISTINCT FROM ${orgId}`.
- `isSenderBlocked(addr, orgId)` — `WHERE ... AND organization_id`.
- `isSenderAutoIgnored(addr, orgId)` — die invoices/invoice_files-Joins zusätzlich org-filtern.
- `listDiscoveredSenders(orgId)` — `WHERE ds.organization_id IS NOT DISTINCT FROM ${orgId}`.
- `blockSender(id, …)` / `unblockSender(id)` / `linkSenderToVendor(id, …)` — sind id-basiert; sicher **sobald** die id aus einer org-gescopten Liste stammt. Defensive Variante: zusätzlich `AND organization_id = ${orgId}` in den UPDATEs.
- `backfillFromMailMessages()` — Cron: pro Org iterieren. Quelle ist `mail_messages → mail_accounts.organization_id`; `GROUP BY` um org erweitern, `ON CONFLICT(organization_id, from_address)`.
- `autoAssignSenders()` — Cron: pro Org iterieren (Org aus `discovered_senders.organization_id`).

**Caller anpassen:**
- `src/mail/mail-scanner.ts` — Scanner hat die Org pro Mail-Account
  (`account.organizationId`). An `recordSenderObservation` / `isSenderBlocked`
  / `isSenderAutoIgnored` durchreichen.
- `src/app/(app)/senders/actions.ts` — Block/Unblock/Link-Actions: `orgId`
  aus `requireCurrentAuth()`, an die Funktionen geben.
- `listDiscoveredSenders`-Konsumenten (Senders-Seite/Komponenten) — `orgId`
  durchreichen (analog `listSendersWithStats` in Phase-0-Stand).

**Test:** 2 Orgs, gleicher Absender mailt an beide → getrennte Zähler;
Block in Org A blockt in Org B **nicht**.

### 1.2 Credential-Store org-scopen

**Problem:** In `src/app/(app)/einstellungen/actions.ts` rufen die
`saveCredentialSecret({ scope: "lexoffice" / "sevdesk" })` **ohne
`organizationId`** auf → Secret-Ref nicht org-spezifisch, zwei Orgs
überschreiben sich den API-Key. Gleiches bei IMAP/SMTP-Secrets prüfen.

**Vorgehen:**
- Alle `saveCredentialSecret` / `readCredentialSecret` /
  `deleteCredentialSecret` / `hasConfiguredCredential`-Aufrufe greppen
  (`grep -rn "CredentialSecret\|hasConfiguredCredential" src`).
- Jeder Aufruf muss `organizationId` aus dem Auth-Kontext mitgeben.
  Die Helper in `src/lib/secrets/credential-store.ts` akzeptieren bereits
  `organizationId` (Secret-Ref-Hash bezieht es ein) — es wird nur an
  einigen Call-Sites nicht übergeben.
- Besonders: `auto-transfer.ts` `readCredentialSecret({ scope: integration.provider })`
  → muss `organizationId` der Rechnung mitgeben.

**Achtung Migration der Secrets:** Bestehende Refs ohne Org wandern nicht
automatisch. Auf Staging prüfen, ob Re-Auth (User gibt API-Key/App-Passwort
erneut ein) akzeptabel ist, oder ein Backfill-Skript nötig ist. Im
Zweifel: Re-Auth erzwingen (Status auf `invalid` setzen → bestehendes
Mail-Invalid-Banner greift).

**Test:** Org A + Org B je Lexoffice mit unterschiedlichem Key → beide
Keys bleiben erhalten und werden beim Auto-Transfer korrekt getrennt geladen.

### 1.3 Restliche ungescopte Reads/Writes

`grep -rn "FROM settings\|getVendorInvoices\|getPipelineSnapshot" src` und prüfen:
- `settings`-Tabelle: `auto_approve_confidence` wird global geschrieben
  (`writeJsonSetting` in `einstellungen/actions.ts`). Entweder
  `settings`-Tabelle um `organization_id` erweitern (eigene Mini-Migration,
  Muster wie gehabt) **oder** bewusst als globale Default-Einstellung
  dokumentieren. Entscheidung treffen, nicht offen lassen.
- `getVendorInvoices(vendorId)` — prüfen, ob Caller-seitig durch
  org-gescopten Vendor abgesichert; sonst `organizationId`-Filter ergänzen.
- `getPipelineSnapshot()` — enthält einen org-übergreifenden
  `needs_review`-Count; `organizationId` ergänzen (Caller in
  `invoice-inbox-view.tsx` hat `orgId` bereits).

---

## Phase 2 — Zuverlässigkeit unter Last (P1, klein & risikoarm)

### 2.1 Per-Org Advisory Lock

**Problem:** `src/lib/db/advisory-lock.ts` nutzt einen globalen Key
(`imap-scan`, `export_dispatch`). Ein langsamer IMAP-Scan einer Org
blockiert alle anderen Orgs (Head-of-Line-Blocking).

**Fix:**
- Lock-Funktion einen optionalen `scopeKey` annehmen lassen,
  Key = `hashtext(name || ':' || coalesce(orgId,'global'))`.
- Scanner/Export pro Org mit org-spezifischem Lock laufen lassen.
- Globalen Lock nur noch für wirklich globale Jobs behalten.

**Test:** Zwei Orgs gleichzeitig scannen → laufen parallel, nicht
serialisiert (Timing/Logs prüfen).

### 2.2 Fehler-Isolation in Cron-Batches

**Problem:** `runMissingInvoiceCheck` (jetzt Schleife über Orgs) und der
Scanner brechen bei einer Exception in Org A komplett ab — Orgs B–Z
werden nie verarbeitet.

**Fix (Muster für alle pro-Org-Schleifen):**
```ts
for (const org of orgs) {
  try {
    await processOrg(org);
  } catch (err) {
    await recordSyncEvent({ level: "error", eventType: "...", organizationId: org.id, ... });
    // weiter mit nächster Org
  }
}
```
Betroffen: `src/invoices/missing-check.ts`, `src/lib/automation/self-provisioning.ts`,
`src/mail/mail-scanner.ts`, später `discovered-senders`-Crons.

**Test:** Org mit absichtlich kaputtem IMAP-Credential → andere Orgs
laufen trotzdem durch; Fehler ist pro Org geloggt.

### 2.3 Quota-Race (TOCTOU)

**Problem:** `canImportInvoice()` / `canStoreFile()` prüfen *vor* der
Transaktion (`src/invoices/import-pipeline.ts`). Parallele Imports
derselben Org können das Limit überschreiten.

**Fix (eine Variante wählen):**
- (a) Quota-Zählung in dieselbe Transaktion ziehen + Org-Row per
  `SELECT ... FOR UPDATE` auf `organizations` serialisieren (einfach,
  etwas Contention pro Org — aber nur pro Org, nicht global).
- (b) DB-Trigger/Constraint, der INSERT ablehnt, wenn Monats-Quota
  überschritten (robuster, mehr Aufwand).
Empfehlung: (a) zuerst, reicht für realistische Last.

**Test:** 5 parallele Imports bei Quota-Rest = 2 → genau 2 gehen durch,
3 sauber abgelehnt (nicht 5).

---

## Phase 3 — Skalierung & Betrieb (P2, später)

- **Cron → Queue pro Org:** mittelfristig globale `node-cron`-Jobs auf
  eine Job-Queue (pg-boss / Supabase Queues) umstellen — parallelisierbar,
  retrybar, pro Org isoliert.
- **DB-Pooling:** pro-Org-Schleifen erhöhen Verbindungslast; Supabase
  PgBouncer (Transaction-Mode) + `postgres`-Client `max` prüfen.
- **Rate-Limiting pro Org** statt nur per-IP (`src/lib/rate-limit.ts`).
- **RLS als 2. Verteidigung:** perspektivisch org-gebundener DB-Rollen-User
  statt durchgängig `service_role`.

---

## Querschnitt (parallel zu allen Phasen)

- **Multi-Tenant-Integrationstest:** Fixture mit 2 Orgs; nach jedem Flow
  (Onboarding, Import, Scan, Export, Cron) assert, dass Org A **null**
  Zeilen/Dateien/Secrets von Org B sieht. Fängt 0019-Klasse Bugs künftig
  automatisch. Höchste Hebelwirkung — idealerweise vor Phase 1 als
  Regressions-Netz aufsetzen.
- **Observability:** `organization_id` als Sentry-Tag + in alle
  `recordSyncEvent`-Aufrufe; Cron-Fehler pro Org sichtbar.
- **`CORE_ARCHITECTURE.md` korrigieren:** behauptet noch fälschlich, alle
  Tabellen seien org-scoped — Tabelle der tatsächlichen org_id-Spalten
  + Verweis auf 0019/0020 ergänzen.

---

## Empfohlene Reihenfolge (Kurzfassung)

1. Phase 0 (0019 verifizieren) — **blockierend**
2. Querschnitt: 2-Org-Integrationstest als Netz
3. Phase 1.1 `discovered_senders` + 1.2 Credential-Store (echte Leaks)
4. Phase 1.3 Rest-Reads
5. Phase 2.1 + 2.2 (per-Org-Lock + Fehler-Isolation — schnell, viel Wirkung)
6. Phase 2.3 Quota-Race
7. Phase 3 nach Bedarf / wenn Org-Zahl wächst

Jede Phase einzeln committen + auf Staging mit 2 Orgs verifizieren,
bevor Prod-Migration.
