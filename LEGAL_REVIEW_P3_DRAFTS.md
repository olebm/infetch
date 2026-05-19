# Rechtsseiten — P3 Entwürfe (ANWALTLICH PRÜFEN)

> ⚠️ **KEINE RECHTSBERATUNG. ENTWURF / DISKUSSIONSGRUNDLAGE.**
> Diese Formulierungen sind NICHT in die Live-Seiten eingebaut. Sie betreffen
> Substanzrisiken (B2C-AGB-Klauselkontrolle §§ 307–309 BGB, Widerrufsrecht
> digitaler Dienste, vorvertragliche Informationspflichten), die ein:e
> Fachanwält:in für IT-/Verbraucherrecht final prüfen und freigeben muss,
> bevor sie produktiv gehen. Stand der Recherche: Mai 2026.

## Kontext
Zielgruppe ist primär B2B (Freelancer/Agenturen/Teams). Sobald aber auch
Verbraucher (§ 13 BGB) abschließen können — und der Free-Plan/Checkout das
faktisch zulässt — greift die strenge AGB-Inhaltskontrolle. Die folgenden drei
Klauseln sind die Hauptrisiken.

---

## P3-1 · AGB § 11 — Änderungsklausel (Zustimmungsfiktion)

**Problem:** Reine „Schweigen = Zustimmung"-Klauseln sind nach BGH, Urt. v.
27.04.2021 – XI ZR 26/20 gegenüber Verbrauchern unwirksamkeitsverdächtig,
wenn sie unbegrenzt auch wesentliche Leistungs-/Preisänderungen erfassen.

**Entwurf (zur anwaltlichen Prüfung):**
- Unwesentliche Änderungen (Klarstellungen, gesetzliche Anpassungen, neue
  Funktionen ohne Eingriff in Hauptleistung/Preis): Mitteilung mit 30 Tagen
  Vorlauf; Fortsetzung der Nutzung gilt als Zustimmung, Hinweis auf
  Kündigungsrecht.
- **Wesentliche Änderungen** (Hauptleistungspflichten, Preis, Laufzeit,
  Haftung): Wirksamkeit nur mit **aktiver Zustimmung** des Nutzers. Ohne
  Zustimmung läuft der Vertrag zu unveränderten Bedingungen weiter oder endet
  zum Mitteilungszeitpunkt-Ende; kein Fiktionsmechanismus.
- Preisänderungen: separater, transparenter Mechanismus + Sonderkündigungsrecht.

## P3-2 · AGB § 9 — Haftung (B2C-Klauselkontrolle)

**Problem:** Struktur (unbeschränkt bei Vorsatz/grober Fahrlässigkeit/Leben-
Körper-Gesundheit; bei einfacher Fahrlässigkeit nur Kardinalpflichten,
begrenzt auf vorhersehbaren typischen Schaden) ist gängig, aber:
- § 9(3) „Datenverlust nur bei zumutbaren Sicherungsmaßnahmen des Nutzers"
  kann als unzulässige Haftungsfreizeichnung ausgelegt werden — eher als
  Mitverschuldens-/Schadensminderungsregel (§ 254 BGB) formulieren.
- Produkthaftungsgesetz ausdrücklich unberührt lassen (Klarstellungssatz).
- Keine Verkürzung gesetzlicher Verjährung zulasten Verbraucher.

**Entwurf-Zusatz:** „Die Haftung nach dem Produkthaftungsgesetz bleibt
unberührt. Im Übrigen ist die Haftung ausgeschlossen. Eine Änderung der
gesetzlichen Beweislast zum Nachteil des Nutzers ist damit nicht verbunden."

## P3-3 · AGB § 5(4) — Erlöschen des Widerrufsrechts (digitale Dienstleistung)

**Problem:** Bei Verbraucherverträgen über digitale Dienstleistungen erlischt
das Widerrufsrecht nur unter den Voraussetzungen des § 356 Abs. 4 BGB
(ausdrückliches Verlangen des Verbrauchers auf Beginn vor Fristende **und**
Kenntnisnahme-Bestätigung des Erlöschens **und** Bereitstellung der
Bestätigung auf dauerhaftem Datenträger nach § 312f BGB).

**Entwurf:** „Das Widerrufsrecht erlischt bei einem Vertrag über eine digitale
Dienstleistung, wenn der Nutzer (a) ausdrücklich zugestimmt hat, dass Infetch
vor Ablauf der Widerrufsfrist mit der Ausführung beginnt, (b) seine Kenntnis
davon bestätigt hat, dass er durch diese Zustimmung mit Beginn der Ausführung
sein Widerrufsrecht verliert, und (c) Infetch dem Nutzer eine Bestätigung
gemäß § 312f BGB zur Verfügung gestellt hat." → Im Checkout-Flow technisch
abbilden (zwei separate Checkboxen + Bestätigungs-E-Mail).

## P3-4 · Fehlende vorvertragliche B2C-Pflichtinformationen

Bei Fernabsatzverträgen mit Verbrauchern fehlen derzeit u. a. (Art. 246a
§ 1 / Art. 246 EGBGB, § 312i BGB):
- Vertragssprache (Deutsch) und Speicherung/Zugänglichkeit des Vertragstexts.
- Die einzelnen technischen Schritte zum Vertragsschluss + Hinweis auf
  Eingabefehler-Korrektur (§ 312i Abs. 1 Nr. 1–2 BGB) — i. d. R. im
  Checkout, nicht in der AGB.
- **Gesetzeskonformes Muster-Widerrufsformular (Anlage 2 zu Art. 246a § 1
  Abs. 2 S. 1 Nr. 1 EGBGB)** — die aktuelle Fassung in § 5 ist vereinfacht;
  der amtliche Wortlaut sollte unverändert als separate Anlage/Seite
  bereitgestellt werden.
- Klare Widerrufsbelehrung im amtlichen Muster (Anlage 1) inkl. Fristbeginn,
  Folgen, Wertersatz bei digitalen Dienstleistungen.

**Empfehlung:** Eigene Seite `/widerruf` mit amtlicher Belehrung + Anlage-2-
Formular; Checkout um die zwei Pflicht-Checkboxen + Bestätigungsmail ergänzen.
Amtliche Mustertexte 1:1 vom Anwalt einsetzen lassen (Wortlaut ist normiert).

---

## Was bereits umgesetzt ist (P1+P2, live-fähig)
- Impressum: tote EU-OS-Plattform entfernt (Abschaltung 20.07.2025),
  § 36 VSBG-Hinweis behalten.
- Zentrale `LEGAL_STAND`-Konstante (`src/lib/legal.ts`) — Datum-Drift behoben.
- Datenschutz: Supabase als US-Unternehmen + EU-Datenhaltung + DPF/SCC
  klargestellt; Art.-22-Hinweis ergänzt; allgemeiner DPA-Hinweis.
- AVV: Supabase-Drittland klargestellt, Brandfetch als Unterauftragsverarbeiter
  ergänzt, § 2 an die Speicher-Minimierungsaussage angeglichen.
- AGB: Plattform-/App-Domain konsistent, Stand zentralisiert.
