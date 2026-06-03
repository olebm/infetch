# Brief — <Aufgabe in einer Zeile>

Der Brief ist die flüchtige Schicht: der Auftrag für *eine* Aufgabe. Er vergeht danach,
also bleibt ihm keine Zeit zu driften. Akzeptanzkriterien möglichst als ausführbarer Check.

## Aufgabe

<eine Zeile>

## Akzeptanzkriterien (möglichst als Check)

- [ ] <ausführbar: Test X grün / Route Y liefert Z / `npm run ci` grün>
- [ ] <...>

## Kontext / Constraints

- Stufe: 2 (Multi-Tenant / PII). Geltende Gates: `npm run ci` + CI (siehe `docs/adr/0000-stufe-und-gates.md`).
- Relevante ADRs: <Verweise>
- Daten/Tenant-Berührung? <ja/nein — wenn ja, welche Isolation greift>

## Nicht-Ziele

- <was bewusst draußen bleibt — gegen Feature-Creep>

## Beleg bei „fertig"

- Testausgabe / reproduzierbarer Befehl (vorher/nachher). Kein „fertig" ohne grünen Lauf.
