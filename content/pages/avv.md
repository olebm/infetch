# Auftragsverarbeitungsvertrag (AVV)

**Rechtsgrundlage:** Art. 28 DSGVO  
**Pflicht:** Ja — verpflichtend sobald Infetch personenbezogene Daten im Auftrag von Kunden verarbeitet  
**Hinweis:** Dieser Vertrag wird durch Akzeptieren der AGB automatisch abgeschlossen (Click-through). Die Seite dient als verbindlicher, abrufbarer Vertragstext.

---

## Präambel

Infetch verarbeitet im Rahmen seiner Dienstleistung E-Mails und Rechnungsdokumente seiner Kunden. Diese können personenbezogene Daten enthalten (z. B. Namen auf Rechnungen, E-Mail-Adressen). Der Kunde bleibt dabei **Verantwortlicher** im Sinne der DSGVO; Infetch handelt als **Auftragsverarbeiter** (Art. 28 DSGVO).

Dieser Auftragsverarbeitungsvertrag regelt die Bedingungen, unter denen Infetch diese Daten verarbeitet.

---

## 1. Gegenstand und Dauer

(1) **Gegenstand:** Verarbeitung von E-Mail-Inhalten und Rechnungsdokumenten zur automatisierten Erkennung, Extraktion und Weiterleitung von Rechnungsdaten.

(2) **Dauer:** Die Laufzeit des AVV entspricht der Laufzeit des Hauptvertrages (AGB). Er endet automatisch mit Beendigung des Nutzungsvertrages.

---

## 2. Art und Zweck der Verarbeitung

**Art der Verarbeitung:**
- Erhebung und Speicherung von E-Mail-Inhalten (IMAP-Abruf)
- Analyse und Extraktion strukturierter Daten aus PDF-Dokumenten (KI-gestützt)
- Speicherung extrahierter Rechnungsfelder in einer Datenbank
- Übermittlung von Rechnungsdokumenten an vom Verantwortlichen konfigurierte Empfänger

**Zweck:** Erbringung der Infetch-SaaS-Leistung gemäß Hauptvertrag (AGB).

---

## 3. Art der personenbezogenen Daten

Verarbeitet werden ausschließlich Daten, die der Verantwortliche über verbundene Postfächer oder manuellen Upload bereitstellt. Typischerweise:

- Namen und Kontaktdaten auf Rechnungen (Rechnungsaussteller, ggf. Ansprechpartner)
- E-Mail-Adressen von Absendern
- Rechnungsbeträge, IBAN/Bankverbindungen auf Rechnungen
- Bestellnummern, Kundennummern

---

## 4. Kategorien betroffener Personen

- Rechnungsaussteller (Unternehmen und deren Mitarbeiter)
- Mitarbeiter des Verantwortlichen, deren E-Mail-Postfächer verbunden sind

---

## 5. Pflichten von Infetch (Auftragsverarbeiter)

Infetch verpflichtet sich:

(1) **Weisungsgebundenheit:** Daten ausschließlich auf dokumentierte Weisung des Verantwortlichen zu verarbeiten. Die Konfiguration durch den Kunden in der App gilt als Weisung.

(2) **Vertraulichkeit:** Sicherzustellen, dass zur Verarbeitung befugte Personen zur Vertraulichkeit verpflichtet sind.

(3) **Technische und organisatorische Maßnahmen (TOMs)** gemäß Art. 32 DSGVO — siehe Anhang A.

(4) **Unterauftragsverarbeiter:** Keine weiteren Unterauftragsverarbeiter ohne vorherige Information des Verantwortlichen einzusetzen (allgemeine Genehmigung mit Widerspruchsrecht, § 8 dieses AVV).

(5) **Unterstützung:** Den Verantwortlichen bei der Erfüllung von Betroffenenrechten (Auskunft, Löschung, Einschränkung) zu unterstützen, soweit möglich.

(6) **Löschung:** Nach Beendigung des Auftrags alle personenbezogenen Daten zu löschen oder zurückzugeben, sofern keine gesetzliche Aufbewahrungspflicht entgegensteht.

(7) **Nachweise:** Dem Verantwortlichen alle erforderlichen Informationen zur Nachweisführung der Einhaltung dieses Vertrages bereitzustellen.

---

## 6. Pflichten des Verantwortlichen (Kunden)

(1) Der Verantwortliche stellt sicher, dass er zur Übermittlung der Daten an Infetch berechtigt ist.

(2) Der Verantwortliche informiert Infetch unverzüglich, wenn er bei der Prüfung der Verarbeitungsvorgänge Fehler oder Unregelmäßigkeiten feststellt.

(3) Weisungen werden schriftlich (E-Mail genügt) oder über die App-Konfiguration erteilt.

---

## 7. Technische und organisatorische Maßnahmen (Anhang A)

| Maßnahme | Umsetzung bei Infetch |
|----------|----------------------|
| Verschlüsselung in Übertragung | TLS 1.2+ für alle Verbindungen |
| Verschlüsselung im Ruhezustand | Datenbank-Verschlüsselung (Supabase/Hetzner AES-256) |
| Zugangskontrollen | Magic Link (kein Passwort), rollenbasierte Berechtigungen |
| Zugriffsprotokolle | Server-Logs, Sentry-Monitoring |
| Datensicherung | Tägliche Backups, 7-Tage-Retention |
| Pseudonymisierung | Nicht relevant (Nutzer muss Rechnungsdaten lesbar sehen) |
| Subprozessoren | Vertraglich zur DSGVO-Konformität verpflichtet |
| Incident Response | Meldung an Verantwortlichen bei Datenpanne innerhalb 72 h |
| Physische Sicherheit | Hetzner-Rechenzentrum (ISO 27001 zertifiziert) |

---

## 8. Unterauftragsverarbeiter (Sub-Processors)

Die folgenden Unterauftragsverarbeiter werden eingesetzt. Der Verantwortliche erteilt seine allgemeine Genehmigung. Änderungen werden mindestens 30 Tage im Voraus mitgeteilt (per E-Mail oder über diese Seite).

| Dienstleister | Zweck | Standort | Zertifizierung |
|---------------|-------|---------|---------------|
| Hetzner Online GmbH | Server-Hosting, Datenspeicherung | Deutschland (Frankfurt) | ISO 27001 |
| Supabase Inc. | Datenbank, Authentifizierung | EU (Frankfurt) | SOC 2 |
| Brevo SAS | Transaktionale E-Mails | Frankreich (EU) | ISO 27001 |
| Sentry | Fehler-Monitoring (anonymisiert) | USA | SCCs (Art. 46 DSGVO) |
| Mistral AI SAS | KI-Textextraktion aus Rechnungsdokumenten (eingebunden über den Backend-Proxy von Infetch) | Frankreich (EU) | DPA · keine Nutzung der Daten zu Modelltraining |
| Stripe Payments Europe Ltd. | Zahlungsabwicklung | Irland (EU) | PCI DSS |

---

## 9. Datenpannen

Infetch meldet Verletzungen des Schutzes personenbezogener Daten unverzüglich, spätestens jedoch innerhalb von **72 Stunden** nach Bekanntwerden an den Verantwortlichen per E-Mail (hallo@infetch.de als Absender, E-Mail-Adresse des Kontos als Empfänger).

---

## 10. Schlussbestimmungen

Es gilt deutsches Recht. Dieser AVV ist Bestandteil des Hauptvertrages. Bei Widersprüchen zwischen AVV und AGB hat der AVV Vorrang in Bezug auf datenschutzrechtliche Fragen.

---

**Stand:** 16. Mai 2026  
**Version:** 1.0

---

## Offene Punkte (ausfüllen vor Go-Live)

- [x] AI-Backend-Anbieter konkret benennen + Zertifizierungsstatus → Mistral AI SAS (FR/EU), via Backend-Proxy, kein Modelltraining
- [ ] Sentry: SCCs prüfen und verlinken (https://sentry.io/legal/dpa/)
- [ ] Supabase: EU-Region Frankfurt bestätigen (Supabase EU-hosted?)
- [ ] Stand-Datum eintragen
- [ ] Anwaltliche Prüfung der TOMs empfohlen
- [ ] Klären: Click-through-Einwilligung beim Onboarding (Checkbox) implementieren?
