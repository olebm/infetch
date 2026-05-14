# Changelog

**Zweck:** Transparenz, Vertrauen, SEO-Signal für aktive Weiterentwicklung  
**Ton:** Direkt, kurz, aus Nutzerperspektive — „du" statt Passiv  
**Format:** Neuestes oben, Datum + Emojis zur schnellen Orientierung

---

## Aufbau eines Eintrags

```
## Version X.Y · [Datum]

Kurze Zusammenfassung in einem Satz, was sich verändert hat.

### ✨ Neu
- Feature A: Was es macht, warum es nützlich ist

### 🔧 Verbessert
- Komponente B: Was schneller / besser wurde

### 🐛 Behoben
- Problem C: Was nicht mehr passiert
```

---

## Inhaltsvorschlag: Erste Einträge

Die folgenden Einträge müssen mit echten Daten befüllt werden. Datum und Version sind Platzhalter.

---

### v1.0 · [Launch-Datum] — Erster öffentlicher Release

Infetch ist live. Verbinde dein Postfach, und wir kümmern uns um die Rechnungen.

**✨ Funktionen beim Start**
- IMAP-Postfach verbinden (Gmail, Outlook, iCloud, beliebige IMAP-Server)
- Automatische Rechnungserkennung aus E-Mail-Anhängen (PDF)
- KI-Extraktion: Anbieter, Betrag, Datum, Steuersatz
- Auto-Approve: sichere Treffer werden automatisch weitergeleitet
- Review-Modus: unsichere Rechnungen zur manuellen Prüfung
- Export an Empfänger-E-Mail-Adresse
- Anbieter-Übersicht mit Monatsausgaben
- Free-Plan: 30 Rechnungen/Monat, 1 Postfach

---

### v1.1 · [Datum] — Pro-Plan

**✨ Neu**
- Pro-Plan verfügbar: 150 Rechnungen/Monat, 3 Postfächer, 2 GB
- Lexoffice-Integration: Rechnungen direkt in dein Lexoffice-Konto
- sevDesk-Integration: Export zu sevDesk
- Retroaktiver Scan: ältere E-Mails aus den letzten 12 Monaten scannen

---

*Weitere Einträge hier ergänzen — chronologisch, neuestes oben.*

---

## Stil-Hinweise

**Gut:**
> „Rechnungen werden jetzt in unter 30 Sekunden erkannt — vorher waren es bis zu 2 Minuten."

**Nicht gut:**
> „Refactored the import pipeline for performance improvements."

**Gut:**
> „Du siehst jetzt direkt auf der Übersicht, welche Rechnungen diese Woche erwartet werden."

**Nicht gut:**
> „Added missing_invoices column to dashboard view."

---

## Offene Punkte

- [ ] Offizielles Launch-Datum eintragen
- [ ] Versionsnummern-Schema festlegen (SemVer? Datum-basiert?)
- [ ] Alle bisherigen Features in v1.0-Eintrag eintragen
- [ ] Entscheiden: öffentlicher Changelog auf der Website + interner im Code-Repo?
