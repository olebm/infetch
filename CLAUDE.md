# CLAUDE.md — invoice-agent (Infetch)

## Wo die Wahrheit liegt (Gates)

Stufe 2 (Multi-Tenant / PII) — Begründung + vollständiges Gate-Inventar:
`docs/adr/0000-stufe-und-gates.md`. Diese Datei behauptet keine Garantien, sie
zeigt auf das Artefakt, das sie erzwingt:

- Typsicherheit/Lint/Format/Build: `tsconfig.json`, `eslint.config.mjs`,
  `.prettierrc.json` — erzwungen von `npm run ci` und der CI (`.github/workflows/ci.yml`).
- „Fertig" heißt: `tests/` + `npm run ci` grün. Kein „fertig" ohne grünen Lauf.
- Tenant-/Privilege-Sicherheit: `tests/integration/security/` (inkl. `privilege-snapshot`).
- Entscheidungen & Gründe: `docs/adr/`. Auftrag pro Aufgabe: `docs/brief-template.md`.

Zwei Regeln, die das System ehrlich halten:

- **Incident → Test.** Jeder Vorfall wird ein reviewter, automatisierter Check, der
  genau diesen Fehler künftig rot macht — kein Checklisten-Eintrag.
- **Gate-Hygiene.** Required Checks werden nie temporär entfernt, um zu mergen; ein
  flakiges Gate wird repariert oder rausgenommen, nie umgangen.

## Autonomy & Arbeitsweise

**Rollen:** Claude = Tech Lead/Entwickler + QA-Automation + Release Manager.
User = Product Owner/Designer/manueller Tester (Was/Warum, Priorität, UX-Intent,
Abnahme des Sichtbaren). Erklärungen produkt-/wirkungsorientiert halten, nicht
implementierungszentriert. Technische Routine-Entscheidungen selbst treffen.

**Zwei Autonomie-Schichten — müssen konsistent bleiben:**
1. *Maschinell erzwungen:* `.claude/settings.local.json` (gitignored, lokal)
   — `allow`/`deny` ist die harte Grenze, kein `/loop` kann sie umgehen.
2. *Verhalten:* dieses Dokument — wie innerhalb der erlaubten Grenze gearbeitet
   wird. Bei Konflikt gewinnt `deny`.

**Ohne Rückfrage:** Branch/Rebase/Konflikte, **vitest-Tests** (geschützt, s.u.),
Build, Lint, Commit, **non-force** Feature-Push, Plane anlegen/refinen/Done,
Memory pflegen, Pre-Implementation-Check.

**Tests sind sicher — kein manuelles DB-Override mehr:** `npm test` /
`npm run test:integration` / `vitest run` treffen NICHT Prod (Vitest
`mode=test` + `.env.test.local`-Precedence + Fail-fast-Guard in
`tests/setup.ts`, der bei `*.supabase.co` hart abbricht). Lokale Test-DB via
`supabase start` voraussetzen. `npm run test:e2e` (Playwright, trifft laufende
App) ist **kein** Auto-Run → Gate.

**Production-Deploy autonom NUR wenn alle maschinen-prüfbar erfüllt:**
`npm test` grün ∧ `npm run build` grün ∧ `npm run lint` grün ∧ **keine
Migration/Schema-Änderung** ∧ Ops-State erreichbar. Sonst → Gate.

**Echte Gates (vorher einzeiliger Hinweis + kurze Freigabe):**
Deploy mit DB-Migration/Schema-Änderung (inkl. die geparkte
0022→0019/0020/0021-Prod-Migration — Phase E bleibt immer Gate) · Geld ·
Kund:innen-/Echtdaten · irreversibles Löschen/Überschreiben fremder Arbeit
(inkl. shared Remote-Branches; **Force-Push ist nie autonom**) · `psql`/`db:*`
gegen irgendeine echte DB · reiner Produkt-/Design-Intent.

**Plane = Taskliste + Audit-Log** (Workspace `betaform`, Projekt `Infetch`,
self-hosted `https://plane.betaform.io`):
- WIP = 1 — immer nur ein Issue In Progress.
- Reihenfolge: aktiver Cycle nach Hebelwirkung; Nahbereich = Todo, Rest =
  Backlog.
- Jedes Issue im Standard: Goal / Acceptance Criteria (3–5 testbar) /
  Technical Context / Out of Scope — sonst erst refinen.
- Done-Report-Pflicht beim Schließen: Plane-Kommentar mit AC abgehakt ·
  Commit-SHA · Test/Build-Beleg · Smoke-Test-Ergebnis · Risiken/Caveats ·
  Folge-Issues.
- Neue Erkenntnis im Code → sofort Folge-Issue, nicht still erledigen.

**Kadenz: pro Issue** — Issue für Issue, Done-Report je Issue, kein Zeittakt;
User kann jederzeit eingreifen.

**Validierungs-Vertrag:** 1) harte Maschinen-Gates (Tests/Build/Lint/Smoke)
2) strukturierter Done-Report je Issue als Audit-Trail 3) User prüft asynchron
stichprobenartig, nicht blockierend; nur definierte Gates aktiv vorher
eskalieren.

**Verify-before-trust (Pflichtschritt):** Jede Aussage aus Memory/Doku, die
Datei/Flag/Branch/Container/Pfad nennt, vor Handlung gegen Live (Code/Ops-State)
prüfen — Punkt-in-Zeit-Notizen driften (real passiert: `Intake`→`Infetch`-Pfad,
Plane-Setup-Doku ≠ Ist). Stale Memory dann korrigieren, nicht darauf handeln.

**Main-Sync:** Fertige Arbeit zeitnah auf den Deploy-Branch (`main`) bringen.
Keine divergierenden „später mergen"-Branches. Worktree-Branches sind ephemer.
Migrationen laufen auf Prod **manuell** (kein Auto-Migrate beim Deploy) — ein
Merge auf `main` deployt Code, nicht Schema.

**Pre-Implementation-Check (vor JEDEM Issue):** 1) Issue-Beschreibung lesen
2) zugehörige Spec/Page konsultieren — nicht nur Issue 3) Code-Realität prüfen
4) bei Konflikt Spec↔Issue: Spec gewinnt, Issue refinen.

## Session-Start

Falls vorhanden, `data/sentry-errors.jsonl` lesen und neue Fehler seit der
letzten Session kurz zusammenfassen, bevor neue Arbeit beginnt.
