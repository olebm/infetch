# Portal-Failure-Debug-Artefakte — Schutz & Retention

Erfüllt AC3 von **INFETCH-266** (Security/Privacy: Failure-Screenshots + A11y-Tree
dürfen keine sensiblen Daten exponieren).

## Was wird gespeichert

Schlägt ein Portal-Abruf fehl, speichert der Agent optional einen Screenshot zur
Fehlerdiagnose:

- Pfad: `<LOG_STORAGE_PATH>/portal-failures/<vendorKey>-<timestamp>.png`
  (Default `./data/logs/portal-failures`).
- Schalter: `PORTAL_SCREENSHOT_ON_FAILURE` (Default an; auf `false` deaktivierbar).
- Code: `src/portals/agent/agent-connector.ts` (Screenshot-Block).

## Schutz (kein PII-Leak)

- **Nie im Repo.** `data/logs/**` ist in `.gitignore` — Artefakte werden niemals
  committet.
- **Redaction vor dem Screenshot.** `maskSensitiveInputs`
  (`src/portals/agent/screenshot-redaction.ts`) überschreibt im DOM die Werte
  aller Text-/E-Mail-/Passwort-Eingaben und Textareas mit `[redacted]`, bevor der
  Screenshot entsteht. **Fail-closed:** scheitert die Maskierung, wird **kein**
  Screenshot gespeichert. Checkbox/Radio/Button/File/Range/Color/Hidden bleiben
  unberührt (kein PII, aber Layout-Kontext).
- **Bewusste Grenze:** Sichtbarer Seitentext *außerhalb* von Eingabefeldern
  (z. B. eine bereits gerenderte Rechnungsliste) wird nicht maskiert — er ist für
  die Diagnose nötig und kein Credential-Vektor. PII dort ist möglich; deshalb die
  kurze Retention unten.
- **A11y-Tree an Mistral.** Der Tree, der an die KI geht, enthält **nie** literale
  Feldwerte: `tree-serializer.ts` gibt aus dem Browser nur `hasValue` zurück,
  Node-seitig wird daraus der Marker `[redacted]`. Passwörter werden nie als
  befüllt markiert.

## Retention

- Beim Schreiben eines neuen Failure-Screenshots werden Artefakte älter als
  **`FAILURE_RETENTION_DAYS` (14 Tage)** best-effort gelöscht
  (`pruneFailureArtifacts`, `src/portals/agent/failure-artifacts.ts`).
- Kein Dauerarchiv — die Screenshots sind ein kurzlebiges Debug-Hilfsmittel.

## Produktion / Ops

- Liegt das `data/`-Volume off-box gesichert, sollte die Backup-Aufbewahrung der
  `data/logs`-Schicht die 14 Tage nicht überschreiten.
- Für die getrennte Worker-Box (INFETCH-269) gilt dieselbe Policy; dort entsteht
  der Screenshot, dort prunt der Agent.
