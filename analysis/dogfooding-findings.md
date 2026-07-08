# Dogfooding-Analyse: Extraktions-Genauigkeit & Automatisierung

**Datum:** 2026-07-08 · **Konto:** Prod-Org `73b3d5e1…` (Owner, DB-tier free / effektiv Pro via Test-Override)
**Datenbasis:** 82 erfasste Rechnungen, davon 53 echte (nach Junk-Filter), 62 mit KI-Extraktion.
**Methode:** Read-only, PII-frei. Ground Truth = KI-Rohwert (`ai_extractions.output_json`) vs. finaler Wert (`invoices`) + `sync_events`-Review-Label. Queries: [`extraction-accuracy.sql`](extraction-accuracy.sql). Gegenprobe der Rechenlogik auf lokaler DB (230 echte Extraktionen).

> **Caveat vorweg:** n = 53 / ein Konto. Das sind belastbare **Signale**, keine Statistik. Nichts hier ist auf „den Durchschnittsnutzer" verallgemeinerbar.

---

## Was nachweislich sitzt

| Feld | Ergebnis | Beleg |
|------|----------|-------|
| **Betrag** | 0 Abweichungen über 62 Extraktionen (46 exportiert) | Feld-Drift KI↔final = 0 |
| **Währung** | 0 Abweichungen über 62 | Feld-Drift = 0 |
| **Automatisierung** | 92 % (49 von 53 echten Rechnungen laufen automatisch durch) | 4 in `needs_review` |
| **Kein Datenverlust** | 39 % Aussortier-Quote, aber **kein einziges** fälschlich verworfenes „invoice" | Junk = nur `other` + Dateiname-Filter |

**Kernaussage zur Ausgangsfrage „stimmen die Daten?": Ja.** Die extrahierten Rechnungsdaten sind an echtem Ground Truth verlässlich.

---

## Was wackelt — aber aufgefangen wird

- **Datum: Mistral liefert in 14,5 % *gar kein* Datum** (null). **Alle** diese Fälle fängt der lokale Regex-Parser auf → kein Datenverlust. Bestätigt die Zwei-Schichten-Architektur (Parser als aktives Sicherheitsnetz, kein Overhead). Die KI ist beim Datum schwächer als ein simpler Regex — vermutlich weil sie nur Text sieht, kein PDF-Layout (`AI_SEND_PDF_BINARY=false`).

- **Confidence-Score ist gesättigt:** 49 von 50 Rechnungen bei ≥ 0.95. Der Score diskriminiert praktisch nicht → als Frühwarn-/Steuergröße wertlos. **Wichtig:** Die Auto-Freigabe-Sicherheit ruht *nicht* auf diesem Score, sondern auf `vendorKnown + Betrags-Cap` ([auto-approval.ts:14](../src/lib/automation/auto-approval.ts), INFETCH-272 Anti-Prompt-Injection). Der tote Score ist also ein langfristiger blinder Fleck, kein akutes Sicherheitsloch.

- **29 % ohne `amount_confidence`:** Per-Feld-Confidence wurde bewusst zugunsten eines Top-Level-Scores aufgegeben ([Code-Kommentar](../src/lib/automation/auto-approval.ts:67)). Die 18 Fälle sind vermutlich neuere (top-level-only) Extraktionen.

---

## Die widerlegte These (Lehrstück)

**Hypothese aus dem Code:** „Kein Anbieter-Match (`vendor_id` NULL) → keine Auto-Freigabe → Handarbeit."

**Die Daten widerlegen das:** Von 10 Rechnungen ohne Anbieter-Match laufen **8 trotzdem automatisch durch.** Grund: Status „ready" braucht [bewusst **keinen** `vendor_id`](../src/invoices/review.ts:100) — der KI-Anbietername genügt für den Export. Die vermeintliche Kopplung war ein Trugschluss; sie wurde erst durch echte Daten sichtbar.

**Konsequenz:** Der „Anbieter-Hebel" ist für Handarbeit **marginal** (fehlender Match verdoppelt die Review-Rate von 5 % auf 20 %, absolut aber nur 2 Rechnungen). → Kein Fix gebaut. Das Dogfooding hat seinen Zweck erfüllt: verhindert, einen Fix zu bauen, den die Realität nicht braucht.

---

## Offene Themen (nicht akut — Skalierung / Härtung)

Für dieses Konto ohne Handlungsdruck. Relevant bei Wachstum / vielen Kunden:

1. **KI-Kosten bei Skalierung:** 0 von 62 Rechnungen wurden lokal ohne Mistral-Call abgehandelt — der „Sufficiency-Gate" greift nie ([extraction-sufficiency.ts](../src/invoices/extraction-sufficiency.ts): verlangt `vendorConfidence ≥ 0.72` *und* `overallConfidence ≥ 0.8`, beides startet beim lokalen Vendor-Match). Bei 1 Konto = Cent-Beträge; bei tausenden Konten ein echter Kostenhebel.
   - **Pareto-Nuance (Block 6):** Die Anbieter sind stark konzentriert — **8 wiederkehrende Anbieter = 40 von 47 Rechnungen (85 %)**, nur 7 einmalig. Falls der Kosten-Hebel angegangen wird, wäre gezieltes Anlernen dieser 8 der effizienteste Weg (85 % Abdeckung mit 8 Einträgen). **Ungeprüft:** ob Seeding den Gate wirklich öffnet — der Gate nutzt den *lokalen* Match (vor KI), nicht den finalen `vendor_id`. Vor einem Fix erst verifizieren.
2. **Confidence-Sättigung:** Der Top-Level-Score trägt nicht als Steuergröße. Kalibrierung (Prompt mit Beispielen) oder bewusst akzeptieren, dass die Sicherheit auf `vendorKnown + Cap` ruht.
3. **Datum-KI:** PDF-Bild statt nur Text an Mistral geben (`AI_SEND_PDF_BINARY`) würde die 14,5 % Datums-Ausfälle vermutlich senken — kostet aber mehr pro Call. Heute vom Parser gefangen, daher niedrige Priorität.

---

## Erledigt in dieser Session

- **Dashboard-KPI-Absicherung (Hebel 4):** Rechen-Tests für `getMonthlyKpis`/`getAutomationStats`/`getSecondaryStats` ergänzt, `hoursSaved` als Schätzung gelabelt, Doku-Drift gefixt (Free 15→30). Siehe `tests/integration/dashboard-kpis.test.ts`.
