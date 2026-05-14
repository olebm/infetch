# Portal-Agent: Real-World-Test-Anleitung

Diese Datei beschreibt, wie du den Portal-Agent gegen echte Vendor-Logins testest. Vorher empfohlen: Test-Konten anlegen oder ein nicht-produktives Login verwenden.

## Voraussetzungen

- macOS oder Linux mit Chrome/Chromium-Abhängigkeiten
- Mistral-API-Key in `.env` (`MISTRAL_API_KEY=...`)
- Vendor-Credentials in der UI angelegt (`/einstellungen → Online-Konten`)
- App läuft (`npm run dev`)

## Debug-Modus aktivieren

Lege folgende Variablen in `.env` an, dann App neu starten:

```env
PORTAL_HEADLESS=false
PORTAL_SLOWMO_MS=300
PORTAL_SCREENSHOT_ON_FAILURE=true
PORTAL_VERBOSE=true
```

Effekt:

- **`PORTAL_HEADLESS=false`** — Chromium-Fenster öffnet sich sichtbar; du siehst jeden Schritt.
- **`PORTAL_SLOWMO_MS=300`** — jede Playwright-Aktion verzögert sich um 300 ms; gut zum Mitlesen.
- **`PORTAL_SCREENSHOT_ON_FAILURE=true`** — bei Fehler landet ein Full-Page-PNG unter `data/logs/portal-failures/<vendor>-<timestamp>.png`.
- **`PORTAL_VERBOSE=true`** — strukturierte Konsolen-Logs (Vendor, headless-Status, slowMo, Screenshot-Pfad).

## Lauf auslösen

Drei Wege, einen Lauf zu starten:

1. **UI:** `/einstellungen → Online-Konten → [Jetzt holen]` neben dem Konto.
2. **Auto-Pilot:** alle 4 Stunden via Cron — siehe `/` Übersicht für "Nächster Lauf in …".
3. **SQL-Trigger:** kann eingebaut werden, aktuell kein CLI-Pfad.

Beim ersten Lauf für einen Vendor ohne Recipe startet der Recorder automatisch (Mistral lernt die Selektoren). Diese Phase ist die teuerste — rechne mit 20–60 LLM-Calls und ~2–5 Cent Cost pro neuem Vendor.

## Logs prüfen

```bash
# DB-Log
sqlite3 data/invoice-agent.db "SELECT vendor_key, mode, status, invoices_found, duration_ms, error_message, llm_calls, llm_cost_cents FROM portal_run_logs ORDER BY started_at DESC LIMIT 10;"

# Failure-Screenshots
ls -la data/logs/portal-failures/

# Aktive Recipe für einen Vendor
sqlite3 data/invoice-agent.db "SELECT version, recorded_by, success_count, failure_count, recipe FROM portal_recipes WHERE vendor_key = 'hetzner' AND status = 'active';"
```

## Häufige Fehlerbilder

| Status | Bedeutung | Was tun |
|---|---|---|
| `login_required` | Session abgelaufen oder falsche Credentials | In UI neu anmelden, dann erneut versuchen |
| `two_factor` | 2FA-Code erforderlich, aber kein TOTP-Secret hinterlegt | TOTP-Schlüssel in den Online-Konten-Settings ergänzen |
| `captcha` | Vendor zeigt CAPTCHA | Manuell einmal im Browser einloggen, Session wird übernommen |
| `recipe_broken` | Selektoren passen nicht mehr | Nach 2 Fails versucht der Recorder automatisch eine neue Recipe |
| `no_invoices` | Eingeloggt, aber Liste leer | Vendor-Layout geändert? Recipe-JSON manuell prüfen |
| `failed` | Anderer Fehler | `error_message` in `portal_run_logs` lesen + Screenshot anschauen |

## Test-Matrix

Empfohlene Vendor-Reihenfolge fürs erste Onboarding:

1. **Hetzner** — relativ stabile UI, gutes Test-Target
2. **Hostinger** — TOTP-relevant, gut um 2FA-Pfad zu prüfen
3. **OpenAI/Anthropic** — Stripe-Backend, etwas dynamischer
4. **Bahn** — komplexer (Auswahljahr, Reisearten)

Pro Vendor: Headless-Run → Failure-Screenshot → Recipe-JSON in der UI prüfen → Erfolgsquote nach 5 Läufen kontrollieren.

## Zurück zu Production

Nach erfolgreichen Tests Debug-Flags wieder auf Default setzen (oder Zeilen auskommentieren). Dann App neu starten.

```env
# PORTAL_HEADLESS=true     # default
# PORTAL_SLOWMO_MS=0       # default
# PORTAL_VERBOSE=false     # default
```

## Recipe nach erfolgreichem Lauf teilen

Wenn ein Vendor eine Erfolgsquote ≥ 80 % über mindestens 5 Läufe erreicht, zeigt der **Recipe-Details**-Drawer einen "Auf GitHub teilen"-Button. Klick öffnet eine pre-filled PR-URL gegen [invoice-agent/invoice-agent-recipes](https://github.com/invoice-agent/invoice-agent-recipes). Nur Selektoren werden geteilt — keine Credentials, keine Rechnungs-Daten.
