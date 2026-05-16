/**
 * Minimaler Blog-Content-Registry. Neue Artikel als Eintrag ergänzen.
 * Bewusst ohne CMS/MDX gehalten — erst Funnel validieren, dann ausbauen.
 */
export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  date: string; // ISO, für <time> + Article-Schema
  /** Einfache Absätze; Strings mit "## " werden als H2 gerendert. */
  body: string[];
};

export const POSTS: BlogPost[] = [
  {
    slug: "rechnungen-automatisch-weiterleiten",
    title: "Rechnungen automatisch an die Buchhaltung weiterleiten",
    description:
      "Wie Selbstständige und kleine Teams Eingangsrechnungen aus dem Postfach automatisch erkennen und an Steuerberater oder Buchhaltungstool weiterleiten — ohne manuelles Suchen.",
    date: "2026-05-15",
    body: [
      "Jeder Anbieter schickt seine Rechnung anders: als PDF im Anhang, als Link im Newsletter, von einer wechselnden Absenderadresse. Wer das jeden Monat manuell sortiert, verliert Stunden — und übersieht trotzdem Belege.",
      "## Das eigentliche Problem",
      "Es gibt selten ein System. Rechnungen liegen verstreut in einem oder mehreren Postfächern, der Steuerberater fragt nach, und die Suche beginnt von vorne. Automatisierung setzt genau hier an: Das Postfach wird regelmäßig auf Rechnungsmerkmale geprüft, erkannte Belege werden extrahiert und an die richtige Stelle weitergeleitet.",
      "## Worauf es bei der Automatisierung ankommt",
      "Drei Dinge entscheiden über den Nutzen: zuverlässige Erkennung (Anbieter, Betrag, Steuersatz direkt aus dem PDF), Kontrolle über unsichere Fälle (nichts geht ungeprüft raus) und Datenschutz (EU-Hosting, keine Verarbeitung in US-Clouds, ein AVV nach Art. 28 DSGVO).",
      "## Wie Infetch das löst",
      "Infetch verbindet sich mit Gmail, Outlook, iCloud oder einem beliebigen IMAP-Postfach, erkennt Rechnungen per KI und leitet sie automatisch an deinen hinterlegten Empfänger weiter — etwa lexoffice, sevDesk, DATEV oder eine beliebige E-Mail-Adresse. Unsichere Erkennungen warten auf deine Bestätigung. Die Einrichtung dauert etwa vier Minuten.",
    ],
  },
];

export function getPost(slug: string): BlogPost | undefined {
  return POSTS.find((p) => p.slug === slug);
}
