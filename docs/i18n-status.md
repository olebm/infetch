# i18n-Status

Infetch unterstützt aktuell Deutsch (Default) und Englisch über Cookie-basiertes Locale-Switching.

## Was funktioniert

- `messages/de.json` und `messages/en.json` enthalten einen Starter-Set Strings (Navigation, Status-Wörter, Onboarding-Schritte, Tier-Texte).
- `src/lib/i18n.ts` liefert `getLocale()`, `getMessages()`, `getTranslator()` — alles Server-Side.
- `LocaleSwitcher`-Komponente im Header schaltet zwischen DE und EN um (Cookie `invoice-agent-locale`).
- `<html lang>` wird dynamisch aus dem Locale gesetzt.

## Was noch fehlt (deferred)

Der bestehende Code hat hartkodierte deutsche Strings in zahlreichen Komponenten. Diese sind **nicht** automatisch übersetzt. Migration läuft komponentenweise:

1. Hardcoded String identifizieren.
2. Eintrag in `messages/de.json` + `messages/en.json` ergänzen.
3. Komponente auf `const t = await getTranslator();` umstellen und `t("path.to.key")` verwenden.

Server Components können `getTranslator()` direkt awaiten. Für Client Components muss die Übersetzung als Prop von einer Server Component übergeben werden, oder ein dünner Client-Context-Provider gebaut werden (Folgearbeit).

## Reihenfolge der Migration

Empfohlene Reihenfolge:

1. `src/components/layout/nav-links.tsx` (Nav-Labels) — über Server-Component-Wrapper Pattern
2. `src/components/onboarding/onboarding-wizard.tsx` (Wizard-Texte)
3. `src/components/status/status-badge.tsx` (Status-Labels)
4. `src/components/layout/quick-actions.tsx` (Header-Buttons)
5. Posteingang + Detail-Seite
6. Einstellungen + Online-Konten

## URL-Strategie

Die URL-Slugs bleiben deutsch (`/posteingang`, `/fehlt`, `/einstellungen`) — auch wenn das Locale auf Englisch steht. Begründung:

- Deeplinks und Bookmarks bleiben stabil.
- Setup-Wizard-Output ist konsistent.
- Englisch ist als sekundäre Sprache positioniert, nicht als gleichberechtigte zweite URL-Struktur.

Wenn lokalisierte URLs später gewünscht sind (`/inbox`, `/missing`, `/settings`), ist das eine separate Migration mit `next-intl` Routing.

## Beitrag von Übersetzungen

Siehe [CONTRIBUTING.md](../CONTRIBUTING.md) → "Translations".
