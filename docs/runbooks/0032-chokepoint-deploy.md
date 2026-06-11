# Runbook — Decrypt-Chokepoint (0032 / #138) auf Prod

Bringt **INFETCH-263a** live: eine `SECURITY DEFINER`-Funktion
`public.app_read_vault_secret(text)` als **einziger** Decrypt-Pfad der App.
[#138](https://github.com/olebm/infetch/pull/138) stellt den App-Code so um, dass
Secrets (Portal/IMAP/SMTP) nur noch über diese Funktion gelesen werden
(`encrypted-db-store.ts`).

## ⚠️ Reihenfolge ist kritisch

`0032` **muss auf Prod sein, BEVOR der #138-Code deployt.** Sonst ruft jeder
Secret-Read eine nicht existierende Funktion auf → **alle Zugänge brechen**.

`0032` liegt **nur** im Branch `feat/credential-decrypt-chokepoint`, **nicht** auf
`main`. Also: Migration zuerst anwenden, **dann** #138 mergen (= Code-Deploy).

## Wo ausführen?

- **`git …` / `gh pr merge`** → dein **Laptop** (lokaler Repo-Checkout). `gh` redet
  nur mit GitHub; Coolify deployt nach dem Merge automatisch.
- **Die `0032`-Migration** → gegen die **Prod-Supabase-DB**
  (`aws-0-eu-central-1…supabase.com`). Zwei Wege:
  - **Empfohlen (kein Terminal):** Supabase Dashboard → **SQL Editor** →
    0032-SQL einfügen → **Run**. Läuft als `postgres` — genau richtig, damit die
    `SECURITY DEFINER`-Funktion `vault.decrypted_secrets` lesen darf. Die SQL gibt's
    im PR [#138](https://github.com/olebm/infetch/pull/138) →
    `supabase/migrations/0032_credential_decrypt_chokepoint.sql` (Raw kopieren).
  - **Alternative (psql):** gegen die **Direct Connection (Port 5432)** aus
    Supabase → Project Settings → Database → „Direct connection". **Nicht** den
    Transaction-Pooler `:6543` (PgBouncer zickt bei DDL).

## Voraussetzungen

- Frischer Prod-DB-Snapshot/Backup (Regel: erst Snapshot, dann Migration). In
  Supabase: Database → Backups.
- Für den psql-Weg: die Direct-Connection-URL (Port 5432) → unten `$PROD_DB`.

## Schritte

### 1. 0032-Datei holen (Branch hat sie, main nicht)

```bash
git fetch origin
git checkout feat/credential-decrypt-chokepoint
```

### 2. Migration anwenden

`0032` ist idempotent (`CREATE OR REPLACE FUNCTION`, `REVOKE`, guarded `GRANT`) —
kleinster Blast-Radius, rührt 0027–0031 nicht an.

**Path A (empfohlen) — Supabase SQL Editor:** Inhalt von
`0032_credential_decrypt_chokepoint.sql` (aus #138) in den SQL Editor einfügen →
**Run**. Fertig.

**Path B — psql gegen die Direct Connection (5432):**

```bash
psql "$PROD_DB" -v ON_ERROR_STOP=1 -f supabase/migrations/0032_credential_decrypt_chokepoint.sql
```

> **Path C (nur wenn du 0027–0031 mitnehmen willst):** der lineare Runner wendet
> ALLE fehlenden Migrationen an (trackt `public.schema_migrations`, transaktional):
> `node scripts/apply-all-migrations.mjs "$PROD_DB"` — nur bei sauberem
> `schema_migrations`; gemeldete Pending-Liste vorher prüfen.

### 3. Funktion verifizieren (read-only)

```bash
psql "$PROD_DB" -c "SELECT proname, prosecdef FROM pg_proc WHERE proname='app_read_vault_secret';"
# Erwartet: genau 1 Zeile, prosecdef = t (SECURITY DEFINER)

psql "$PROD_DB" -c "SELECT has_function_privilege('service_role','public.app_read_vault_secret(text)','EXECUTE');"
# Erwartet: t  — sonst bricht der Read im aktuellen Single-Prozess-Betrieb
```

### 4. #138 mergen (deployt den Code, der die Funktion nutzt)

```bash
gh pr merge 138 --merge --delete-branch
```

Coolify deployt automatisch. **Smoke-Test:** auf einem Online-Konto „Jetzt prüfen"
auslösen → erfolgreich, keine `function ... does not exist`-Fehler im Log.

### 5. Zurück auf main

```bash
git checkout main && git pull
```

## Rollback

- Die Funktion ist additiv und stört nichts — sie muss i. d. R. nicht zurück.
- Bricht nach dem #138-Deploy etwas, **#138 reverten** (Code liest dann wieder
  direkt `vault.decrypted_secrets`); die Funktion kann bleiben.
- Nur wenn wirklich nötig: `DROP FUNCTION public.app_read_vault_secret(text);`

## Danach — der eigentliche Schutz (eigener Schritt)

Bis hier ist der Chokepoint **gelegt, aber nicht scharf**: die App verbindet als
`postgres`/`service_role` → ein Superuser umgeht Grants. Scharf wird es erst mit
dem 2-Service-Rollen-Split (siehe Lockdown-Block im Header von `0032` und
[269-worker-egress-firewall.md](269-worker-egress-firewall.md)):

1. `portal_worker`-Rolle **mit** `EXECUTE` auf die Funktion (+ App-Tabellen-Grants).
2. Web-Rolle **ohne** `EXECUTE` und **ohne** Zugriff auf `vault.*`.
3. `REVOKE EXECUTE ON FUNCTION public.app_read_vault_secret(text) FROM service_role;`
   — sobald beide Services eigene Rollen haben.
4. `DATABASE_URL` je Coolify-Service auf die jeweilige Rolle (Web → Web-Rolle,
   Worker → `portal_worker`).
