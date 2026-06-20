# Konzept: Mehr Vertrauen auf der Landingpage

**Stand:** 2026-06-20 · **Status:** Stufe 1 freigegeben — Umsetzung gegated auf Copy-Freigabe + Mistral-Plan · **Autor:** Tech Lead (Claude) für Ole

Ausgangsfrage: Wie kommunizieren wir mehr Vertrauen? Vermitteln wir, was unsere
KI tut, dass sie aus der EU kommt (Mistral)? Plus Idee: dem Nutzer Tipps zur
Datensparsamkeit geben (z. B. dediziertes Rechnungs-Postfach).

---

## 1. Ausgangslage — verifiziert am Code, nicht aus Doku

Alle Aussagen unten sind gegen den Live-Code geprüft (`src/app/landingpage/page.tsx`,
`src/app/datenschutz/page.tsx`, `src/lib/config/env.ts`, Security-/Architektur-Doku).

**Was Infetch technisch tut (= unser Trust-Rohmaterial):**

- **Datensparsam by design:** IMAP-Scan ist *attachment-only* — Mails ohne
  PDF-Anhang werden nie heruntergeladen (nur `BODYSTRUCTURE` gelesen). Nur
  erkannte Belege werden dauerhaft gespeichert, AES-256-GCM verschlüsselt.
- **Credentials nie im Klartext:** Postfach-Passwörter liegen im Supabase Vault
  (pgsodium) bzw. Keychain, Entschlüsselung nur über einen SECURITY-DEFINER-
  Chokepoint. Kein OAuth — Verbindung per IMAP-App-Passwort.
- **KI = Mistral AI (Paris, FR/EU):** Default `mistral-small-latest`. An die KI
  geht **nur der extrahierte Rechnungstext** — kein Bild, kein Layout, kein
  Postfach-Inhalt (`AI_SEND_PDF_BINARY=false`). Portal-Automation arbeitet auf
  dem Accessibility-Tree, Vision-Fallback nur maskiert.
- **Kontrolle beim Nutzer:** Auto-Freigabe nur bis 500 € (`autoApprovalMaxAmountCents`),
  darüber manuelles OK. Anbieter pro Mail/Domain ausschließbar. Hard-Delete bei
  Konto-Löschung. Mail-Metadaten 12 Monate Retention.

**Was die LP heute schon an Vertrauen sendet:**
Trust-Strip (AES-256 · EU-Server Frankfurt · KI-Verarbeitung EU · jederzeit
löschbar · AVV), Sicherheit-Sektion „Deine Mails sind deine Sache", Feature
„Privat bleibt privat", FAQ „Liest Infetch wirklich alle meine Mails?". Legal
sauber: Datenschutz, AGB, AVV, Impressum.

**Befund:** Die Substanz ist da — aber sie ist *versteckt, technisch und
defensiv* formuliert. Das stärkste Argument (wie wenig wir sehen) steckt in einer
FAQ-Zeile. Die EU-KI wird wie eine Entschuldigung präsentiert statt als Stärke.

---

## 2. Leitidee

> **Vertrauen durch Architektur, nicht durch Versprechen.**

„Wir sind sicher" behauptet jeder. Glaubwürdig wird Vertrauen, wenn wir *zeigen,
wie wenig wir überhaupt sehen*. Drei Säulen:

1. **Wir sehen so wenig wie möglich.** Datensparsamkeit sichtbar machen
   (attachment-only, nur Belege, privat bleibt privat, nur Text an die KI).
   → ehrlichstes, technisch belegtes, stärkstes Argument.
2. **Europäische KI, die nicht von dir lernt.** Mistral/EU selbstbewusst —
   *vorbehaltlich Plan-Klärung (siehe §5)*.
3. **Du behältst die Kontrolle.** Jederzeit löschen, Anbieter ausschließen, du
   gibst frei — und du kannst Infetch ein eigenes Postfach geben (Oles Idee).

**Marktbeleg (DACH-KMU):** „Daten/Anbieter in DE" ist das stärkste Trust-Argument,
aber kein Aufpreis-Hebel — Türöffner bei gleichem Preis (Bitkom/IONOS 2025: 89 %
halten Datenhoheit für essentiell). Read-only-Charakter + „kein KI-Training" sind
die stärksten *produktspezifischen* Versprechen für Postfach-Zugriff.

---

## 3. Die ehrlichen Grenzen — was wir NICHT behaupten dürfen

Das ist der wichtigste Teil. Mehrere naheliegende Claims sind Greenwashing- oder
Abmahn-Fallen oder werden von unserer eigenen Architektur widerlegt:

| Verlockender Claim | Warum er nicht geht | Ehrliche Alternative |
|---|---|---|
| „100 % EU / US-frei / souveräne KI" | Wir nutzen Supabase (US-Konzern, CLOUD Act — steht in unserer Datenschutz-Seite), Mistral nutzt selbst US-Infra (Azure/GCP), Stripe. Die „US-freie Festung" hält die Architektur nicht. | „EU-Hosting in Frankfurt · europäisches KI-Modell · DSGVO · AVV" |
| „Kein KI-Training mit deinen Daten" | Nur wahr bei bezahltem Mistral-Plan. Unsere Datenschutz-Seite sagt selbst: „Training-Opt-out abhängig vom Plan". **Erst klären (§5).** | Bis geklärt: „An die KI geht nur der Rechnungstext — kein Bild, kein Postfach." (verifiziert wahr) |
| „EU-AI-Act-konform/-zertifiziert" | Inhaltsleer für Rechnungsextraktion (minimal risk), keine solche Zertifizierung existiert. | weglassen |
| „Wir können nichts senden/löschen" (SaneBox-Stil Read-only) | Falsch — Infetch *versendet* aktiv Rechnungen. | „Wir lesen aus deinem Postfach und leiten an *deine eigenen* Empfänger weiter — in deinem Postfach löschen oder verändern wir nichts." |
| „Militärische/bankübliche Verschlüsselung", Siegel-Wand, „Schütz dich vor Hackern!" | FUD senkt Vertrauen messbar (NIST „Security Fatigue"). „military-grade" ist ein leerer Begriff (jedes HTTPS nutzt AES-256). | Konkret + ruhig: „AES-256, Server in Frankfurt". Ein Trust-Satz, Tiefe auf verlinkter Seite. |

**Konsequenz:** Die Trust-Story bewusst auf *„EU-Hosting + EU-KI-Modell +
Datensparsamkeit + Kontrolle"* begrenzen. Stark genug — und zu 100 % durch die
Architektur gedeckt.

---

## 4. Bausteine

**A. KI-Story selbstbewusst statt defensiv.**
Aus „Mistral AI, Frankreich — keine Weitergabe an Werbung durch uns" wird ein
positiver Block: **„Europäische KI."** + „Wir nutzen Mistral AI (Paris). An die
KI geht nur der Text der Rechnung — kein Bild, kein Layout, nicht dein Postfach."
[Training-Claim erst nach §5.]

**B. Datensparsamkeit sichtbar machen** (aktuell in FAQ versteckt → hochziehen).
Kleines Visual „Was wir sehen — und was nicht":
✓ Mails mit Rechnungsanhang · ✗ Mails ohne Anhang (laden wir nie) · ✗ Private
Mails/Newsletter · ✗ dein Passwort (nie im Klartext).

**C. Kontrolle bündeln** (Plaid-Muster „you're always in control"): du gibst frei
(>500 € immer manuell), jederzeit löschen, Anbieter ausschließen.

**D. Oles Idee — dediziertes Rechnungs-Postfach.**
Positionierung: **Kontroll-Geschenk, nicht Angst-Warnung.** Etabliertes Muster
(sevDesk, lexoffice), aber nie mit „dein Hauptpostfach ist gefährdet" bewerben.
Formulierung: *„Maximale Trennung? Deine Wahl. Leg dir eine Adresse nur für
Rechnungen an, hinterlege sie bei deinen Anbietern, verbinde nur dieses Postfach.
So sieht Infetch ausschließlich Rechnungen."*
Zwei Spielarten (Trade-off):
- **D1 — Tipp + Onboarding-Hinweis.** Nutzer legt selbst ein Postfach an,
  verbindet es per IMAP. **Kein Backend nötig**, nutzt bestehende Architektur.
  Datensparsamkeit maximal. Risiko: Setup-Aufwand beim Nutzer; falsch
  eingerichtete Weiterleitung → Beleg verloren (im Onboarding adressieren).
- **D2 — Infetch stellt eine Einsende-Adresse bereit** (`…@in.infetch.de`,
  Dauerweiterleitung). Bequemer, aber: Mail-Ingestion-Infra, Spam/Abuse, eigene
  Domain. **Hinweis:** Feature-Flag `ENABLE_INBOUND_MAIL` existiert bereits (aus)
  — die Variante ist architektonisch angedacht. Eigenes Epic.

**E. Trust-Transparenz.** Sub-Prozessor-Liste (Supabase, Hetzner, Mistral,
Stripe, Brevo) aus der Datenschutz-Seite als sichtbare, ehrliche Tabelle
(Differenzierer — kaum ein Wettbewerber zeigt sie). AVV-Link ist schon im Footer.

**F. Tonalität.** Ein ruhiger Trust-Satz im Sichtbaren, Tiefe auf verlinkter
Seite (Progressive Disclosure). Understatement + Konkretheit > Superlative.

---

## 5. Offene Klärungen (Gates)

1. **Mistral-Plan (Faktum, blockiert KI-Claim):** Free La Plateforme /
   kostenpflichtig mit AVV + Training-Ausschluss / unklar? Entscheidet, ob „kein
   Training mit deinen Daten" und „AVV mit dem KI-Anbieter" überhaupt sagbar sind.
2. **Ausbaustufe (Produkt-Intent):** Stufe 1 / 1+2 / inkl. D2 — siehe §6.
3. **Supabase-US-Spannung:** Empfehlung — Trust-Story bewusst auf „EU-Hosting +
   EU-KI" begrenzen, nicht „souverän/US-frei". (Auto-Entscheidung, §7.)

---

## 6. Gestufter Implementierungsplan

**Stufe 1 — Trust-Schärfung (Copy + bestehende Sektionen, kein Backend).** ✅ **Gewählt (2026-06-20).**
1. KI-Block „Europäische KI" aufwerten (positiv, „nur Text"-Argument).
2. „Was wir sehen — und was nicht" als Visual in der Sicherheit-Sektion.
3. Dediziertes-Postfach-Hinweis (D1) als ruhiger Block + FAQ-Eintrag.
4. Sub-Prozessor-Transparenz (kleine Tabelle/Link).
5. Tonalitäts-Pass: defensive → selbstbewusste Formulierungen.
- *Verifikation:* axe (A11y), Lighthouse (LP-Budget), Build/Lint/Typecheck grün,
  visueller Preview-Check, Claims konsistent mit Datenschutz-Seite.

**Issue-Schnitt für Plane (WIP=1):**
- **Issue A — LP-Copy & KI-Story schärfen** (Bausteine A, C-Bündelung, D1, F).
  AC: (1) „Europäische KI"-Block ersetzt defensive Kachel, Claim deckungsgleich
  mit Datenschutz-Seite, **kein** unbelegter Trainings-Claim. (2) Dediziertes-
  Postfach-Hinweis (D1) als ruhiger Block + 1 FAQ-Eintrag, keine Angst-Sprache.
  (3) Ton-Pass: „keine Weitergabe an Werbung durch uns" & Co. selbstbewusst.
  (4) `npm run ci` grün. Out of Scope: neues Visual, Inbound-Feature.
- **Issue B — „Was wir sehen / was nicht"-Visual + Sub-Prozessoren** (B, E).
  AC: (1) ✓/✗-Matrix, inhaltlich gegen attachment-only verifiziert. (2) Sub-
  Prozessor-Tabelle (Supabase/Hetzner/Mistral/Stripe/Brevo), ehrlich (Supabase=US
  nicht verschweigen), konsistent mit Datenschutz-Seite. (3) axe ohne Violations,
  Kontrast AA. (4) Lighthouse-LP-Budget gehalten.

**Stufe 2 — Trust-Center (`/sicherheit` als Vollseite).**
Datensparsamkeits-Architektur erklärt, Sub-Prozessoren, TOMs-Auszug,
AVV-Download, KI-Erklärung, Lösch-Garantie. Verlinkt aus LP („Wie wir deine Daten
schützen →").

**Stufe 3 — Dediziertes Postfach als Feature (D2, eigenes Epic, optional).**
Inbound-Adresse (`ENABLE_INBOUND_MAIL`), Onboarding-Flow, Abuse/Spam-Schutz.

---

## 7. Auto-Entscheidungen (dokumentiert)

→ Trust-Leitidee: „Architektur/Datensparsamkeit zeigen" statt Siegel-Wand [Auto: DACH-KMU-Best-Practice + NIST Security Fatigue]
→ KI-Positionierung: Mistral/EU selbstbewusst, ohne „US-frei/souverän"-Übertreibung [Auto: EU-Default + Ehrlichkeit, Supabase-US-Realität]
→ Verschlüsselungs-Sprache: konkret (AES-256/Frankfurt), kein „military-grade" [Auto: Anti-FUD]
→ Dediziertes Postfach: als Kontroll-Angebot framen, nicht als Angst [Auto: Tonalität-Recherche]
→ Start-Variante: D1 (Tipp, kein Backend) vor D2 (Inbound-Feature) [Auto: Datensparsamkeit + geringster Aufwand]
→ „Kein-Training"-Claim: zurückhalten bis Mistral-Plan geklärt [Auto: DSGVO-konservativ + ehrliche Verifikation]
→ Start-Stufe: Stufe 1 empfohlen [Auto: schnell sichtbar, kein Backend-Risiko] — **Freigabe durch Ole offen**
