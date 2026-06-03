# ADR-0000 — Stufe-Einstufung und Gate-Inventar

- Status: akzeptiert
- Datum: 2026-06-03
- Kontext: Einführung der betaform-Dev-Blueprint-Basis in Infetch.

Ein ADR spricht über die Vergangenheit und ändert sich nicht. Was sich ändern darf
(der Ist-Zustand der Gates), steht in den Configs/Tests, nicht hier.

## Entscheidung: Stufe 2 (Multi-Tenant / PII)

Die Tiefe der Absicherung richtet sich nach dem Blast-Radius. Für Infetch gilt
**Stufe 2**, weil im schlimmsten Fall **fremde Mandanten-Daten leaken** (Rechnungen,
Kontakt-/Zahlungsdaten). Belege im Repo:

- Org-scoped RLS-Migrationen (`supabase/migrations/0010`, `0011`, `0025`–`0027`).
- `HANDOVER_MULTITENANCY.md`, `MULTITENANCY_HARDENING_PLAN.md`.
- ESLint-Regel, die den bare `sql`-Client verbietet und auf
  `scopedSql`/`unsafeGlobalSql` zwingt (`eslint.config.mjs`).

Stufe 2 erbt Stufe 0 (Basis-Qualität) und Stufe 1 (App mit Login + Daten).

## Wo die Wahrheit liegt — Gate-Inventar

Sortierregel: Was eine Maschine prüfen kann, lebt im Gate (Config/Test), nicht als
Prosa. Diese Tabelle ist ein **Verweis** auf das erzwingende Artefakt, keine zweite
Quelle der Wahrheit.

| Blueprint-Anforderung | Erzwungen von | Lauf |
| --- | --- | --- |
| TypeScript strict | `tsconfig.json` (`strict: true`) | `npm run typecheck` · CI `typecheck` |
| ESLint rot bei Fehler, kein `--quiet` | `package.json` `lint` (`--max-warnings=0`) | CI `lint` |
| `no-explicit-any`, `ban-ts-comment` = error | `eslint-config-next/typescript` (resolved `[2]`) | CI `lint` |
| Tenant-Scoping erzwungen | `eslint.config.mjs` `no-restricted-imports` | CI `lint` |
| Prettier-Format | `.prettierrc.json` + `format:check` | CI `lint` (Format-Step) |
| Build läuft | `package.json` `build` | CI `build` |
| Unit/Component | `tests/unit/**` (Vitest) | CI `test` |
| E2E Auth + kritische Flows | `tests/e2e/**` (Playwright) | CI `e2e` |
| Smoke: Hauptseiten rendern, keine Console-Errors | `tests/e2e/smoke.test.ts` | CI `e2e` |
| Migrationen/Seed in CI vor Tests | CI `test` (Postgres 16 + `apply-all-migrations.mjs`) | CI `test` |
| Cross-Tenant SELECT + INSERT/UPDATE | `tests/integration/security/cross-tenant-idor.test.ts`, `tenant-fuzz.test.ts` | CI `test` |
| Unauthenticated → 0 Zeilen / Fehler | siehe „Unauth-Abdeckung" unten | CI `e2e` + `test` |
| Privilege-Snapshot vs. Allowlist | `tests/integration/security/privilege-snapshot.test.ts` (+ `privilege-allowlist.json`) | CI `test` |
| Migration-Drift (prod-replay) | CI `migration-drift-gate` | CI |
| Schema-Drift + Audit nächtlich | `.github/workflows/nightly.yml` | scheduled |
| Git-Hooks echt installiert | `lefthook.yml` + `package.json` `prepare` | lokal (`npm install`) |

Lokaler Spiegel des PR-Gates: `npm run ci` (`typecheck → lint → format:check → test → build`).
E2E ist nicht in `npm run ci` (braucht laufenden Server + Supabase-Stack) — eigener CI-Job.

## Bewusste Scope-Entscheidungen

- **Lighthouse: draußen.** Der Blueprint rahmt Lighthouse-Budgets als KMU-/Marketing-
  Seiten-Gate. Infetch ist eine auth-gated Multi-Tenant-App; Performance-Budgets hätten
  hier geringen Wert und auth'd-Lighthouse-Komplexität. A11y ist über
  `tests/e2e/a11y.test.ts` (axe-core) bereits gegated.
- **Rollen nicht im Privilege-Snapshot.** Postgres-Rollen werden von der Plattform
  (Supabase) provisioniert und divergieren zwischen CI-vanilla-pg, lokal und Prod —
  ein Rollen-Snapshot wäre nur Falsch-Positive. Der Snapshot prüft die migrations-
  definierte Fläche im `public`-Schema (RLS-Flags, Policies, SECURITY-DEFINER-Funktionen),
  die über alle Umgebungen identisch ist. Prod-Rollen-Audit: `scripts/prod-setup-audit.ts`.
- **`strictNullChecks`/`noImplicitAny` nicht explizit gesetzt.** Von `strict: true`
  subsumiert; explizit setzen wäre Doppel-Dokumentation der gleichen Garantie.
- **Markdown nicht in Prettier.** `.prettierignore` schließt `*.md` aus, damit der
  einmalige Normalize auf Code/Config fokussiert bleibt; Langform-Docs sind Prosa.
- **Hooks ohne DB-Tests.** Pre-commit/Pre-push laufen ohne Postgres (Lint/Format/Typecheck);
  Integrationstests brauchen einen DB-Service und laufen im CI-`test`-Job.

## Unauth-Abdeckung (warum kein eigener DB-Test)

„Unauthenticated → 0 Zeilen / Fehler" ist mehrschichtig abgedeckt:

1. **HTTP:** `tests/e2e/smoke.test.ts` — anonymer Zugriff auf `/` leitet auf `/login`.
2. **App-Filter:** `tenant-fuzz`/`cross-tenant-idor` — falscher Mandant bekommt 0 Zeilen.
3. **RLS-Funktion:** `scoped-query-set-local.test.ts` — `app_org_match()` matcht nicht
   ohne `app.current_org` und ohne `auth.uid()`.

Ein zusätzlicher DB-Probe als Nicht-Superuser ist **nicht** ergänzt worden, weil er gegen
das aktuelle Schema nicht lauffähig ist (siehe Finding unten) und die Garantie ohnehin
dreifach gegated ist.

## Findings / Follow-ups

- **RLS rekursiert unter Nicht-Superuser-Rolle.** Ein `SELECT` auf eine org-scoped Tabelle
  als Rolle `authenticated` wirft `infinite recursion detected in policy for relation
  "org_members"` (die `org_members`-Policy liest `org_members`). In Prod nie sichtbar, weil
  die App als Superuser verbindet und RLS umgeht (so dokumentiert in `0026`). Heißt aber:
  die „Defense-in-Depth"-RLS würde unter einer echten Rolle **fehlern statt nur zu
  verweigern**. → Folge-Issue (RLS unter Nicht-Superuser lauffähig machen, z. B.
  `org_members`-Lookup via SECURITY-DEFINER-Helper).
- **Live-Prod-Schema-Drift fehlt im Nightly.** Echter Repo-vs-Prod-Vergleich braucht ein
  read-only Prod-DSN-Secret. → Folge-Issue, wenn das Secret bereitsteht.

## Die zwei Regeln, die das System ehrlich halten

- **Incident → Test.** Kein Postmortem ist fertig, bevor der automatisierte Check existiert,
  der genau diesen Fehler künftig rot macht — ein reviewter Test, kein Checklisten-Eintrag.
- **Gate-Hygiene.** Required Checks werden nie temporär entfernt, um zu mergen. Ein flakiges
  Gate wird repariert oder rausgenommen, nie umgangen.
