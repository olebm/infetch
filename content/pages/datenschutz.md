# Datenschutzerklärung

**Rechtsgrundlage:** Art. 13, 14 DSGVO  
**Pflicht:** Ja — vor Betrieb mit echten Nutzern  
**Empfehlung:** Anwaltliche Prüfung vor Go-Live

---

## 1. Verantwortlicher

**[Firmenname]**  
[Adresse]  
E-Mail: hallo@infetch.de

---

## 2. Welche Daten wir verarbeiten und warum

### 2.1 Konto & Authentifizierung
- **Daten:** E-Mail-Adresse, Zeitpunkt der Anmeldung, Session-Token
- **Zweck:** Zugang zur Anwendung ermöglichen
- **Rechtsgrundlage:** Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung)
- **Dienstleister:** Supabase Inc. (Authentifizierung, EU-Region Frankfurt)

### 2.2 Rechnungsverarbeitung
- **Daten:** E-Mail-Inhalte deines verbundenen Postfachs, PDF-Anhänge, daraus extrahierte Felder (Anbieter, Betrag, Datum, Steuersatz)
- **Zweck:** Automatische Erkennung und Weiterleitung von Rechnungen
- **Rechtsgrundlage:** Art. 6 Abs. 1 lit. b DSGVO
- **Hinweis:** Rechnungen können Namen natürlicher Personen enthalten. Diese werden ausschließlich zur Weiterleitung verarbeitet, nicht für andere Zwecke genutzt.

### 2.3 KI-Extraktion
- **Daten:** Textinhalt von Rechnungs-PDFs (kein Layout, keine Bilder)
- **Zweck:** Strukturierte Extraktion von Rechnungsdaten (Anbieter, Betrag, Datum)
- **Dienstleister:** [Mistral AI / AI-Proxy-Backend] — EU-Hosting, keine Verwendung für Modelltraining
- **Rechtsgrundlage:** Art. 6 Abs. 1 lit. b DSGVO

### 2.4 Zahlungsabwicklung
- **Daten:** E-Mail-Adresse, Zahlungsmittel (wird direkt an Stripe übermittelt, nicht bei uns gespeichert)
- **Zweck:** Verarbeitung von Abonnementzahlungen
- **Dienstleister:** Stripe Payments Europe Ltd. (irische Tochter, EWR)
- **Rechtsgrundlage:** Art. 6 Abs. 1 lit. b DSGVO

### 2.5 E-Mail-Versand (Benachrichtigungen)
- **Daten:** Deine E-Mail-Adresse, Versandzeitpunkt
- **Zweck:** Systembenachrichtigungen (z. B. neue Rechnung erkannt)
- **Dienstleister:** Brevo SAS (Frankreich, EU)
- **Rechtsgrundlage:** Art. 6 Abs. 1 lit. b DSGVO

### 2.6 Fehler-Monitoring
- **Daten:** Anonymisierte Stack Traces, Browser-Typ, anonymisierte IP-Adresse
- **Zweck:** Technische Fehler erkennen und beheben
- **Dienstleister:** Sentry (USA) — Standardvertragsklauseln (Art. 46 DSGVO)
- **Rechtsgrundlage:** Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an Systemstabilität)
- **Hinweis:** Keine personenbezogenen Nutzerinhalte in Fehlerberichten

### 2.7 Hosting & Infrastruktur
- **Dienstleister:** Hetzner Online GmbH, Industriestraße 25, 91710 Gunzenhausen
- **Serverstandort:** Deutschland (Frankfurt)
- **Daten:** Alle App-Daten, Server-Logfiles (IP, Zeitstempel, HTTP-Status) — Logs werden nach 7 Tagen gelöscht

### 2.8 Logos (Brandfetch CDN)
- Beim Laden von Anbieterlogos werden Anfragen an cdn.brandfetch.io gestellt.
- Dabei kann deine IP-Adresse an Brandfetch Inc. (USA) übertragen werden.
- **Rechtsgrundlage:** Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an Funktionalität)

---

## 3. Cookies und Speicher

Wir verwenden **keine Tracking- oder Werbe-Cookies**.

Technisch notwendige Cookies:
| Name | Zweck | Laufzeit |
|------|-------|---------|
| `sb-*` (Supabase) | Authentifizierungs-Session | Session / 1 Woche |

Ein Cookie-Consent-Banner ist nicht erforderlich, da ausschließlich technisch notwendige Cookies verwendet werden.

---

## 4. Speicherdauer und Löschung

| Datenkategorie | Löschfrist |
|----------------|-----------|
| Kontodaten | Mit Kündigung des Kontos |
| Rechnungen & Dateien | Mit Kündigung des Kontos oder auf Anfrage |
| Server-Logs | 7 Tage |
| Zahlungsdaten bei Stripe | Gemäß Stripe-Datenschutzrichtlinie (bis 10 Jahre, handelsrechtliche Pflicht) |

---

## 5. Weitergabe an Dritte

Deine Daten werden nicht an Dritte verkauft. Weitergabe erfolgt ausschließlich an die oben genannten Auftragsverarbeiter (Dienstleister), die vertraglich zur Einhaltung der DSGVO verpflichtet sind (→ AVV).

---

## 6. Deine Rechte

Du hast gegenüber uns folgende Rechte:

- **Auskunft** (Art. 15 DSGVO): Welche Daten wir über dich haben
- **Berichtigung** (Art. 16 DSGVO): Korrektur unrichtiger Daten
- **Löschung** (Art. 17 DSGVO): „Recht auf Vergessenwerden"
- **Einschränkung** (Art. 18 DSGVO): Verarbeitung einschränken lassen
- **Datenportabilität** (Art. 20 DSGVO): Daten in maschinenlesbarem Format
- **Widerspruch** (Art. 21 DSGVO): Gegen Verarbeitung auf Basis berechtigter Interessen
- **Beschwerde** bei einer Aufsichtsbehörde (z. B. Landesbeauftragte für Datenschutz deines Bundeslandes)

Anfragen bitte an: hallo@infetch.de

---

## 7. Auftragsverarbeitung

Soweit wir Daten im Auftrag unserer Kunden verarbeiten, geschieht dies auf Grundlage eines Auftragsverarbeitungsvertrages (AVV) nach Art. 28 DSGVO.  
→ [AVV einsehen](/avv)

---

## 8. Änderungen dieser Erklärung

Wir können diese Datenschutzerklärung bei wesentlichen Änderungen unserer Dienste aktualisieren. Das Datum der letzten Änderung ist unten angegeben.

**Stand:** [Datum einsetzen]

---

## Offene Punkte (ausfüllen vor Go-Live)

- [ ] Firmenname und Adresse eintragen
- [ ] AI-Backend konkret benennen (Mistral? anderer Anbieter?)
- [ ] Sentry-Drittlandstransfer prüfen — SCCs (Standardvertragsklauseln) vorhanden?
- [ ] Brandfetch Drittlandstransfer prüfen
- [ ] Stand-Datum eintragen
- [ ] Anwaltliche Prüfung empfohlen
