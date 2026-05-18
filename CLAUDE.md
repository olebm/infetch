# Infetch — KI-Bauplan

Dieses Dokument ist die individuelle Anleitung für die KI, die an Infetch
weiterbaut. Es übersetzt die vier Fundament-Entscheidungen
(`docs/saas-foundation.md`) in Dauer-Regeln. **Bei Konflikt gewinnt dieses
Dokument vor Bequemlichkeit, nicht vor explizitem Nutzerwunsch.**

## Was Infetch ist

Infetch nimmt Selbstständigen das monatliche Zusammensuchen von
Eingangsrechnungen ab: Belege werden automatisch aus dem Mailpostfach (und
optional Lieferantenportalen) eingesammelt, per KI (Mistral) ausgelesen und
an den Steuerberater weitergeleitet. Stack: Next.js 16 (App Router, Server
Actions) · Supabase/Postgres · Stripe · Playwright (Portale, hinter Flag).

Mentales Modell des Nutzers — in Code & UI an diesen drei Begriffen
orientieren: **Postfach** · **Rechnung** · **Steuerberater**.

## Die eine nicht verhandelbare Regel: Tenancy

**Der Mandant ist die `organization`, niemals der `user`.**

- Modell ist **Solo jetzt, Team-fähig gebaut**: 1 User = 1 Org *heute*,
  aber Code darf **nie** annehmen, dass eine Org genau einen User/ein
  Mitglied hat. Keine `LIMIT 1` auf `org_members`, kein "der User der Org".
- **Jede neue mandantenbezogene Tabelle bekommt `organization_id`** und
  eine RLS-Policy nach dem Muster in `supabase/migrations/0010_rls.sql`
  (Sichtbarkeit via `org_members` → `auth.uid()`).
- Neue org-scoped Spalten/Tabellen: `organization_id` **`NOT NULL`**
  anlegen (Alt-Bestand ist nullable — das ist ein bekanntes Risiko, siehe
  `docs/saas-foundation.md`, nicht nachahmen).
- Schreibpfade müssen `organization_id` **immer explizit setzen**. Nie auf
  den NULL-ist-global-Fallback der RLS verlassen — das ist im Mehr-Mandanten-
  Betrieb ein Cross-Tenant-Leak.
- Datenzugriff aus dem Nutzerkontext über den `authenticated`-Client
  (RLS greift). Nur Hintergrund-Jobs nutzen `service_role` und müssen dann
  `organization_id` **selbst** in jeder Query filtern.

## Rollen

Solo-Modus: keine Rollenprüfung nötig, der einzige User ist `owner`. Das
`role`-Enum (`owner`/`admin`/`member`) bleibt im Schema, aber **keine neue
Logik darauf aufbauen**, bis der Team-Modus explizit beauftragt wird. Wenn
er kommt: `admin`/`owner` = Postfach/Export/Abrechnung/Mitglieder,
`member` = nur Rechnungen.

## Sicherheit & DSGVO (hart)

- Postfach-Passwörter, Portal-Logins, TOTP, API-Keys gehören in Supabase
  Vault / `credential_refs` — **nie** Klartext in `settings`, Code, Tests
  oder Logs. Keine Secrets in Commit-Messages oder PR-Texten.
- Belegdaten sind personenbezogen. Beim Loggen/Fehlerreporting Beträge,
  Absender, Dateinamen nicht unnötig ausgeben.
- Abrechnung hängt an der Org (`organizations.stripe_*`, `tier`), nicht am
  User.

## Arbeitsweise in diesem Repo

- Branch: `claude/saas-foundation-questionnaire-dBT2I`. Committen mit
  klaren Messages, pushen mit `git push -u origin <branch>`. **Kein PR
  ohne ausdrücklichen Auftrag.**
- Schema-Änderungen nur als **neue** nummerierte Migration unter
  `supabase/migrations/` (bestehende nie editieren). Migration und
  passende RLS-Policy im selben Schritt liefern.
- Vor "fertig": `npm run lint`, `npm test`. UI-Änderungen real im Browser
  prüfen oder ausdrücklich sagen, dass es nicht getestet wurde.
- Bestehenden deutschen Stil (Kommentare, UI-Texte) beibehalten; i18n über
  `messages/de.json` / `messages/en.json`.
- Keine Spekulativ-Abstraktionen, keine Backwards-Compat-Shims für Code,
  den man genauso gut direkt ändern kann.

## Bekannte Fundament-Baustellen (vor Team-Modus)

Siehe `docs/saas-foundation.md` → "Offene Fundament-Risiken": nullable
`organization_id`, `export_targets` ohne Org, global geteilte
`vendors`/`portal_recipes`. Nicht ungefragt großflächig umbauen, aber bei
Berührung in die richtige Richtung bewegen (org_id setzen, nicht auf
NULL-Fallback verlassen).
