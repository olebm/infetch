# Anwalts-Briefing — Rechtsseiten Infetch

> **Zweck:** Mandats-Vorlage für eine:n Fachanwält:in IT-/Datenschutz-/
> Verbraucherrecht. **Dies ist KEINE Rechtsberatung** und wurde von einem
> KI-Assistenten als strukturierte Vorarbeit erstellt. Alle als „P3"
> markierten Punkte und die offene Checkliste müssen anwaltlich final
> formuliert/freigegeben werden, bevor sie produktiv gehen.
>
> Stand: 19. Mai 2026 · Bezug: `src/app/{impressum,datenschutz,agb,avv,ueber-uns}/page.tsx`, `src/lib/legal.ts`, `LEGAL_REVIEW_P3_DRAFTS.md`

## 0. Grundsatzentscheidung (vom Mandanten festgelegt)

**Infetch wird auch an Verbraucher (§ 13 BGB) angeboten (B2C zugelassen).**
→ Volle Verbraucherschutz-Tiefe anwendbar: Widerrufsrecht & -belehrung,
AGB-Inhaltskontrolle §§ 305–310 BGB, vorvertragliche Informationspflichten
(Art. 246/246a EGBGB, § 312i BGB), PAngV. Zielgruppe laut Produkt primär
Freelancer/Agenturen/kleine Teams — also gemischt B2B/B2C.

## 1. Mandant & Setup

- **Betreiber:** betaform | Ole Beekmann (Einzelunternehmen), Glindersweg 34,
  21029 Hamburg. USt-ID DE318609562. Kontakt hallo@infetch.de.
- **Produkt:** Infetch — SaaS, das verbundene E-Mail-Postfächer (IMAP) nach
  Rechnungen durchsucht, per KI extrahiert und an Buchhaltung weiterleitet.
- **Domains:** Marketing `infetch.de`, Anwendung `app.infetch.de`.
- **Login:** Passwortlos, 6-stelliger OTP-Code per E-Mail (Supabase Auth).
- **Hosting/Datenlage:** App-Daten Hetzner Frankfurt (DE). Rechnungs-PDFs +
  Rohtext zusätzlich anwendungsseitig AES-256-GCM verschlüsselt.
- **Rolle:** Ggü. Postfach-/Rechnungsinhalten ist der Kunde Verantwortlicher,
  Infetch Auftragsverarbeiter (Art. 28) — AVV per Click-through.

## 2. Subprozessoren / Drittlandbezug (zur Validierung)

| Dienst | Zweck | Standort/Rechtsträger | Garantie |
|---|---|---|---|
| Hetzner Online GmbH | Hosting/Speicherung | DE (Frankfurt) | ISO 27001 |
| Supabase Inc. | DB/Auth | **US-Rechtsträger**, Datenhaltung EU/Frankfurt (AWS) | DPF / SCC Art. 46 |
| Mistral AI SAS | KI-Extraktion | FR (EU) | kein Training mit Kundendaten |
| Brevo SAS | Transaktionsmails | FR (EU) | ISO 27001 |
| Stripe Payments Europe Ltd. | Zahlung | IE (EU) | PCI DSS |
| Sentry Inc. | Fehler-Monitoring (anonymisiert) | US | SCC Art. 46 |
| Brandfetch Inc. | Anbieter-Logos (nur IP beim Logo-Abruf) | US | SCC Art. 46 |

## 3. Bereits umgesetzt & live (P1+P2, PR #15, deployed 2026-05-19)

- Impressum: toter EU-OS-Plattform-Hinweis entfernt (Plattform-Abschaltung
  20.07.2025); § 36 VSBG-Hinweis beibehalten.
- Zentrale `LEGAL_STAND`-Konstante (`src/lib/legal.ts`) — Datums-Drift behoben.
- Datenschutz: Supabase als US-Unternehmen + EU-Datenhaltung + DPF/SCC
  klargestellt; Abschnitt „keine automatisierte Entscheidung (Art. 22)";
  allgemeiner DPA-Hinweis; Abschnitte neu nummeriert.
- AVV: Supabase-Drittland klargestellt; Brandfetch als Unterauftragsverarbeiter
  ergänzt; § 2 an Speicher-Minimierung angeglichen (nur erkannte Rechnungen
  werden dauerhaft gespeichert, übrige Postfachinhalte nicht).
- AGB: Plattform-/App-Domain konsistent.

→ **Bitte anwaltlich gegenprüfen, ob diese P1/P2-Korrekturen sachlich
vollständig/korrekt sind.**

## 4. P3 — anwaltlich zu fassen (Details in `LEGAL_REVIEW_P3_DRAFTS.md`)

1. **AGB § 11 Zustimmungsfiktion** (Schweigen = Zustimmung): nach BGH
   XI ZR 26/20 für Verbraucher unwirksamkeitsverdächtig. → Differenzierter
   Mechanismus (aktive Zustimmung bei wesentlichen Änderungen).
2. **AGB § 9 Haftung**: § 9(3) „Datenverlust nur bei zumutbaren Sicherungs-
   maßnahmen" als § 254-Regel formulieren; ProdHaftG ausdrücklich unberührt;
   keine Verjährungsverkürzung zulasten Verbraucher.
3. **AGB § 5(4) Widerrufserlöschen digitale Dienstleistung**: an § 356 Abs. 4
   BGB (Fassung seit 2022) anpassen; im Checkout: zwei separate Pflicht-
   Checkboxen + Bestätigung auf dauerhaftem Datenträger (§ 312f BGB).
4. **Fehlende B2C-Pflichtinfos** (Art. 246/246a EGBGB, § 312i BGB):
   Vertragssprache, Vertragstext-Speicherung, technische Schritte zum
   Vertragsschluss + Eingabefehler-Korrektur, **amtliche Widerrufsbelehrung
   (Anlage 1) + amtliches Muster-Widerrufsformular (Anlage 2)** im normierten
   Wortlaut (aktuell nur vereinfacht in AGB § 5) — Empfehlung: eigene Seite
   `/widerruf`.

## 5. Offene Sach-/Entscheidungsfragen (Mandant ⇄ Anwalt)

- [ ] **Preisangaben:** Werden auf der Pricing-Seite Verbraucherpreise
      PAngV-konform inkl. USt dargestellt? (AGB § 4(3) sagt „zzgl. USt".)
- [ ] **Subprozessor-Vollständigkeit:** Liste in Abschnitt 2 abschließend?
      Hinweis: **Coolify ist self-hosted auf dem Hetzner-Host von betaform**
      (kein Datenfluss an Coolify als Anbieter) → vermutlich kein eigener
      Auftragsverarbeiter — **bitte bestätigen**. Analytics o. Ä. nicht im
      Einsatz (zu bestätigen).
- [ ] **DPA-Nachweise:** Reale DPA-Dokumente/-Stände je Anbieter beibringen
      (Datenschutz verweist aktuell auf „Anbieter-Rechtsseiten / auf Anfrage").
- [ ] **Löschkonzept abbilden:** Konto-Löschung ist seit 2026-05-19 ein
      **echter, unwiderruflicher Hard-Delete** (Code: ordered child→parent,
      drift-robust; E-Mail-Bestätigung erforderlich; Guards gegen versehentl.
      Massenlöschung). Datenschutz-„Speicherdauer" + AVV-Löschklausel sollten
      das exakt so abbilden (statt alter Soft-Delete-Annahme). Backup-/
      Retention: Server-Logs 7 Tage, Backups 7 Tage — bitte bestätigen.
- [ ] **Datenschutzbeauftragter (Art. 37 DSGVO / § 38 BDSG):** Kerntätigkeit
      ist systematische Verarbeitung fremder Postfach-/Rechnungsinhalte.
      Schwellen (≥20 Personen / „großer Umfang" / systematische Überwachung)
      anwaltlich einschätzen — DSB erforderlich oder nicht?
- [ ] **Verzeichnis von Verarbeitungstätigkeiten (Art. 30):** vorhanden? Sonst
      erstellen (auch für kleinen AV empfohlen/teils pflichtig).
- [ ] **TOMs (Art. 32):** AVV Abschnitt 7 enthält eine TOM-Tabelle —
      Angemessenheit/Vollständigkeit prüfen.
- [ ] **AVV-Detailtiefe Art. 28(3):** Audit-/Kontrollrechte des
      Verantwortlichen und Pflicht zur Mitteilung rechtswidriger Weisungen
      sind nur knapp/implizit — ggf. ausformulieren.
- [ ] **Marketing ↔ Vertrag:** Landing-Aussage „nur erkannte Rechnungen
      gespeichert, Rest nie" muss mit Datenschutz/AVV deckungsgleich bleiben
      (technisch: temporärer IMAP-Abruf, dauerhafte Speicherung nur erkannter
      Rechnungen) — Formulierungen konsistent halten.

## 6. Empfohlene Reihenfolge

1. Grundsatz B2B/B2C ist entschieden (B2C zugelassen) → P3 voll relevant.
2. P3-Punkte 1–4 anwaltlich fassen; `/widerruf`-Seite + Checkout-Pflicht-
   elemente konzipieren.
3. Offene Checkliste (Abschnitt 5) gemeinsam abarbeiten.
4. Finale Texte als PR analog #15 (kein Auto-Merge) einspielen.

## 7. Interim-Status (BEWUSST befristet)

**Aktueller Live-Stand ist eine bewusste Übergangslösung**, kein Endzustand:

- Live sind die **eigenen, vorbestehenden Rechtstexte des Betreibers** plus
  rein objektive Korrekturen (P1+P2, PR #15) — **nichts kopiert, nichts frei
  erfunden** → kein Urheberrechts-/Plagiatsrisiko. Der akut abmahnbare Punkt
  (toter EU-OS-Link) ist entfernt.
- **Bewusst offen während des Interims:** P3-Klauseln (AGB §11/§9/§5(4)),
  B2C-Pflichtinfos, kein Aktualisierungsservice. Restrisiko wird **befristet
  und informiert** getragen.
- **Ziel-Datum anwaltliche Ablösung: bis 17. Juli 2026**
  (≈ 8 Wochen; Platzhalter — vom Betreiber zu bestätigen/anzupassen).
  Wird das Datum überschritten, ist der Interim-Status erneut bewusst zu
  entscheiden, nicht stillschweigend zu verlängern.

## 8. Pflege-/Review-Checkliste (ersetzt KEINEN Aktualisierungsservice)

- [ ] **Quartalsweise** (oder bei bekannter Rechtsänderung): alle 5 Seiten
      gegen aktuelle Pflichtangaben sichten; `LEGAL_STAND` in
      `src/lib/legal.ts` nur bei realer inhaltlicher Änderung hochsetzen.
- [ ] Bei jeder Änderung an Subprozessoren/Technik (neuer Dienst, geänderte
      Speicherung, Auth-Flow): Datenschutz **und** AVV synchron nachziehen;
      Subprozessor-Liste = Single Source.
- [ ] Marketing-Aussagen (Landing) und Datenschutz/AVV bei jedem Relaunch
      auf Deckungsgleichheit prüfen (Speicher-Minimierung).
- [ ] Bekannte wiederkehrende Trigger beobachten: Gesetzesänderungen
      (BGB/EGBGB/DSGVO-Leitlinien), Aufsichtsbehörden-Hinweise, Wegfall/
      Änderung von Diensten (z. B. ODR-Plattform-Klasse).
- [ ] Vor Ziel-Datum: anwaltliche Endfassung beauftragen (Abschnitt 5+6).

---
*Erstellt als Vorarbeit, nicht als Rechtsberatung. Verantwortung für die
finalen Texte trägt die anwaltliche Prüfung.*
