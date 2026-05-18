# SaaS-Fundament — Infetch

Dieses Dokument hält die vier Fundament-Entscheidungen fest und leitet daraus
das Mandanten- und Datenmodell ab. Es ist die Quelle der Wahrheit; der
KI-Bauplan (`/CLAUDE.md`) verweist hierauf.

Stand: 2026-05-18 · Branch `claude/saas-foundation-questionnaire-dBT2I`

---

## 1. Der Job der Software

> **Infetch nimmt Selbstständigen das monatliche Zusammensuchen von
> Eingangsrechnungen ab: Belege werden automatisch aus dem Mailpostfach
> (und optional Lieferantenportalen) eingesammelt, per KI ausgelesen und
> auswertbar an die Buchhaltung bzw. den Steuerberater weitergeleitet.**

Nicht das Feature ("IMAP-Scan"), sondern der Job: *"Ich will mich nicht
mehr monatlich durchs Postfach wühlen, damit mein Steuerberater alles
hat."*

## 2. Wer ist ein Mandant?

**Entscheidung: Solo jetzt, Team-fähig bauen.**

- Verkauft und abgerechnet wird an **Einzelnutzer** (Freelancer /
  Selbstständige — das README-Zielbild).
- Das **Datenmodell bleibt organisationsbasiert**: 1 User = 1 Organisation
  (`organizations`-Zeile mit genau einem `org_members`-Eintrag, Rolle
  `owner`).
- Ein späterer Team-Modus (mehrere Mitarbeiter teilen einen Mandanten) ist
  damit **ohne Datenmigration** möglich — nur UI/Invite-Flow kommt dazu.

**Konsequenz (nicht verhandelbar):** Der **Mandant ist die
`organization`**, niemals der `user`. Jede mandantenbezogene Zeile trägt
`organization_id`. Code darf **nie** annehmen, dass eine Org genau einen
User hat — diese Annahme wäre genau die nicht nachrüstbare Falle, die die
Fragebogen-Warnung meint.

## 3. Die Kern-Objekte

Nutzersicht (nicht Tabellensicht):

| Objekt | Was der Nutzer darunter versteht | Tabellen dahinter |
|---|---|---|
| **Postfach** | "Mein verbundenes E-Mail-Konto, das abgesucht wird" | `mail_accounts`, `mail_messages`, `credential_refs` |
| **Rechnung** | "Ein eingegangener Beleg mit Betrag/Datum/Lieferant" | `invoices`, `invoice_files`, `ai_extractions`, `vendors` |
| **Steuerberater** | "Wohin die fertigen Belege gehen" | `export_targets`, `exports` |

Alles andere (Portale, Monatsstatus-Matrix, Auto-Approval) ist
*unterstützend*, nicht das mentale Modell des Nutzers.

## 4. Unterschiedliche Rollen?

**Im Solo-Modell gibt es faktisch keine Rollen** — der einzige Nutzer ist
implizit `owner` und darf alles.

Das `role`-Enum (`owner` / `admin` / `member`) bleibt im Schema erhalten,
wird aber **noch nicht erzwungen**. Erst wenn der Team-Modus kommt:

- `owner` / `admin`: verwaltet Postfach-/Export-Zugänge, Abrechnung,
  Mitglieder
- `member`: sieht/bearbeitet nur Rechnungen

## Optional — bereits bekannte Besonderheiten

- **DSGVO-kritisch:** Postfach-Zugangsdaten und Belege sind hochsensibel.
  Secrets gehören in Supabase Vault / `credential_refs`, **nie** im Klartext
  in `settings` oder Logs. AVV/Datenschutz liegen unter `content/pages/`.
- **Abrechnung:** Stripe ist auf `organizations` verdrahtet
  (`stripe_customer_id`, `tier` ∈ `free`/`pro`). Abo gehört der Org, nicht
  dem User — passt zum Team-ready-Modell.
- **Herkunft:** App war local-first (SQLite); das Postgres/Supabase-Schema
  ist die SaaS-Portierung. README beschreibt teils noch den Desktop-Stand.

---

## Mandanten- & Datenmodell (Schema zum Ansehen)

### Tenancy-Prinzip

```
auth.uid()  ──>  org_members  ──>  organization_id  ──>  alle Mandantendaten
                  (Rolle)
```

Isolation passiert in **Postgres Row Level Security** (siehe
`supabase/migrations/0010_rls.sql`): Die `authenticated`-Rolle sieht eine
Zeile nur, wenn sie über `org_members` zur `organization_id` der Zeile
gehört. `service_role` (Server-Jobs) umgeht RLS bewusst.

### Diagramm

```
┌─────────────┐        ┌──────────────────┐        ┌──────────────┐
│   users     │◄───────│   org_members    │───────►│ organizations│
│  (Person)   │ 1    n │  user_id         │ n    1 │  = MANDANT   │
└─────────────┘        │  organization_id │        │  tier, stripe│
                       │  role            │        └──────┬───────┘
                       └──────────────────┘               │ organization_id
                                                           │ (auf JEDER
                          ┌────────────────────────────────┼─ Mandanten-
                          │                │               │   tabelle)
                  ┌───────▼──────┐  ┌───────▼──────┐ ┌──────▼────────┐
                  │ mail_accounts│  │   vendors    │ │ export_targets│
                  │  POSTFACH    │  │  (Lieferant) │ │  STEUERBERATER│
                  └───────┬──────┘  └───────┬──────┘ └──────┬────────┘
                          │                 │               │
                  ┌───────▼──────┐  ┌───────▼──────┐ ┌──────▼────────┐
                  │ mail_messages│  │   invoices   │ │    exports    │
                  └──────────────┘  │  RECHNUNG    │►│ (Versand-Log) │
                                    └───┬──────┬───┘ └───────────────┘
                                        │      │
                            ┌───────────▼─┐ ┌──▼──────────────┐
                            │invoice_files│ │ ai_extractions  │
                            │   (PDF)     │ │ (Mistral-Auslese)│
                            └─────────────┘ └─────────────────┘
```

### Tabellen nach Tenancy-Klasse

**A — Mandantendaten (direkt `organization_id`, RLS via `org_members`)**

`organizations`, `org_members`, `vendors`, `mail_accounts`,
`credential_refs`, `invoices`, `exports`, `usage_events`,
`mail_inbound_addresses`

**B — Mandantendaten (indirekt org-gescoped über FK)**

`vendor_aliases`→vendors · `invoice_files`/`ai_extractions`→invoices ·
`mail_messages`→mail_accounts · `vendor_month_status`/`portal_*`→vendors

**C — Global / System (kein Client-Direktzugriff, nur `service_role`)**

`jobs`, `sync_runs`, `sync_events`, `portal_recipes`,
`portal_browser_sessions`, `portal_run_logs`, `discovered_senders`,
`settings`, `integration_targets`, `encrypted_secrets`

### Offene Fundament-Risiken (vor Team-Modus zu schließen)

1. **`organization_id` ist überall NULLABLE**, und RLS behandelt
   `organization_id IS NULL` als *global sichtbar* (siehe `0011_*` /
   `0010_rls.sql`). Im Solo-Betrieb harmlos, aber sobald zwei zahlende
   Mandanten existieren, ist jede versehentlich NULL gelassene Zeile ein
   **Cross-Tenant-Leak**. → Mittelfristig `NOT NULL` + Backfill, oder
   striktes "immer org_id setzen" im Code erzwingen.
2. **`export_targets` hat keine `organization_id`** (RLS = jeder
   Authenticated). Im Team-Modus muss das pro Org isoliert werden
   (`0013_export_targets_per_org.sql` ist ein Anfang — prüfen).
3. **`vendors` / `portal_recipes` sind teils global** (Community-Rezepte).
   Beim Team-Modus klären, was geteilt vs. mandanteneigen ist.

Diese Punkte sind im KI-Bauplan als Dauer-Regeln verankert.
