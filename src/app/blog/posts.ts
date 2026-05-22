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
  {
    slug: "rechnungen-automatisch-weiterleiten-vergleich",
    title:
      "Rechnungen automatisch weiterleiten: Infetch, GetMyInvoices, Candis und invoicefetcher im ehrlichen Vergleich",
    description:
      "Welches Tool passt zu welchem Setup? Ein Vergleich aus der Werkstatt — inklusive der Fälle, in denen Infetch nicht die richtige Wahl ist.",
    date: "2026-05-22",
    body: [
      "Wer als Freelancer oder kleines Studio arbeitet, kennt das Spiel: Adobe schickt ins eine Postfach, Hetzner ins andere, GitHub kommt von einer no-reply-Adresse, und am Monatsende sitzt man halt da und sucht. Mittlerweile gibt es vier ernstzunehmende Tools, die das Problem lösen — auf ziemlich unterschiedliche Weise. Wir bauen selbst eines davon (Infetch), und genau deshalb schreiben wir diesen Vergleich ehrlich. Heißt: wir nennen auch die Fälle, in denen ein anderes Tool die bessere Wahl ist.",
      "## Zwei Ansätze, die der Markt eigentlich anbietet",
      "Bevor wir die Tools einzeln durchgehen, lohnt sich ein Blick auf den technischen Unterschied. Es gibt im Kern zwei Wege, an Rechnungen zu kommen.",
      "Portal-Scraping: Das Tool loggt sich für dich in Adobe, Telekom, Hetzner und Co. ein und lädt die PDFs aus den Anbieter-Portalen. Vorteil: man bekommt auch Rechnungen, die nie per Mail kommen. Nachteil: man muss überall Zugangsdaten hinterlegen, und sobald ein Anbieter sein Portal ändert, ist der Connector erst mal kaputt.",
      "Postfach-Scanning mit KI: Das Tool liest dein E-Mail-Postfach mit, erkennt per KI Rechnungs-Merkmale und leitet die Belege weiter. Vorteil: Setup in wenigen Minuten, funktioniert mit jedem Anbieter, der irgendwann mal eine Rechnung per Mail schickt, und das sind heute eben fast alle. Nachteil: reine Portal-Rechnungen ohne Mail-Versand werden nicht erfasst.",
      "Der Großteil aller KMU bekommt seine Rechnungen heute per Mail. Wer aber stark portal-getriebene Anbieter hat (klassisch: Telekom-Geschäftskunden, manche Versicherungen, einige Versorger), sollte das im Hinterkopf behalten.",
      "## GetMyInvoices — der Marktführer für Portal-Setups",
      "GetMyInvoices ist seit Jahren der Platzhirsch beim Thema Portal-Anbindung. Tausende unterstützte Portale, tiefe Integrationen mit lexoffice, sevdesk, DATEV und vielen weiteren Buchhaltungslösungen.",
      "Wann es passt: Wenn ihr ein Team seid, das viele Anbieter mit Portal-Logins hat, eine vollständige Belegerfassung inklusive Freigabe-Workflow braucht, und sich gerne ein paar Stunden Zeit fürs Setup nehmt.",
      "Wo es Reibung gibt: Setup ist deutlich aufwändiger als bei den jüngeren Tools, Pricing ist eher auf Teams zugeschnitten, und für reine SaaS-Postfach-Setups zahlt man halt für Funktionen, die man nie nutzt.",
      "## Candis — Approval-Workflow für Buchhaltungsteams",
      "Candis ist eher ein vollständiges Accounts-Payable-Tool als ein reiner Rechnungs-Sammler. Es deckt den ganzen Prozess vom Rechnungseingang über Freigaben bis zur Übergabe an die Buchhaltung ab.",
      "Wann es passt: Wenn ihr eine Buchhaltungsabteilung habt (oder eine Person, die diese Rolle so halb ausfüllt), mehrere Freigabe-Stufen braucht und tiefe DATEV-Integration wollt.",
      "Wo es Reibung gibt: Für Solo-Selbstständige und kleine Studios ist Candis arg überdimensioniert. Pricing und Komplexität skalieren mit der Featuretiefe, und wer nur 30 Rechnungen pro Monat weiterleiten will, fühlt sich wie jemand, der mit dem Lkw zum Bäcker fährt.",
      "## invoicefetcher — der etablierte deutsche Anbieter",
      "invoicefetcher ist eines der ältesten Tools im deutschen Markt. Klassisches Portal-Scraping mit langer Anbieter-Liste, sehr viele Nutzer im KMU-Segment, eingespielte Integrationen.",
      "Wann es passt: Wenn ihr eine bewährte Lösung wollt, viele Portale anbinden müsst und mit einer etwas älteren UI gut leben könnt.",
      "Wo es Reibung gibt: KI-basiertes Postfach-Scanning gibt es so nicht, die Erkennung läuft primär über Portal-Logins. Wer wenige Portale und viele Mail-Rechnungen hat, nutzt das Tool eben nur zur Hälfte.",
      "## Infetch — wofür wir es gebaut haben",
      "Wir haben Infetch genau für den Fall gebaut, den wir bei uns selbst hatten: ein Freelancer- bzw. Kleinteam-Setup mit vielen SaaS-Abos, in dem niemand Lust hat, jeden Monat 30 Mails von Hand weiterzuleiten.",
      "Wann es passt: Du bist Freelancer, kleines Studio oder Agentur bis etwa 10 Personen, der Großteil deiner Rechnungen kommt per Mail, und du willst in vier Minuten startklar sein. EU-Server (Hetzner Frankfurt), DSGVO-konform inkl. AVV, KI erkennt Anbieter, Betrag und Steuersatz direkt aus dem PDF und leitet an deine Beleg-Adresse weiter — lexoffice, sevdesk, DATEV oder beliebige andere. Eine Funktion, die unsere Nutzer so halb unerwartet richtig gut finden: monatliche Abos werden automatisch erkannt, und wenn eine erwartete Rechnung ausbleibt, melden wir uns, bevor die Buchhaltung fragt.",
      "Wo es Reibung gibt — ehrlich: Wer stark auf Portal-Anbindung angewiesen ist, ist bei GetMyInvoices oder invoicefetcher besser aufgehoben. Wir scannen Postfächer, keine Portale. Wer komplexe Approval-Workflows mit mehreren Freigabe-Stufen braucht, sollte sich Candis ansehen. Wir konzentrieren uns auf den Schritt davor: Rechnung erkennen, weiterleiten, fertig. Und wir sind ein junges Produkt — die Anbieter-Erkennung, die Integrationen und das Featureset wachsen noch. Wenn du Enterprise-Reifegrad mit SLA und dediziertem Account Manager erwartest, sind wir da noch nicht.",
      "## Kurze Entscheidungshilfe",
      "Solo-Freelancer mit vielen SaaS-Abos: Infetch Free (deckt bis 30 Rechnungen/Monat).",
      "Studio oder Agentur, 3–10 Personen, Mail-getrieben: Infetch Pro.",
      "Mittelständler mit Buchhaltungsabteilung und Freigabe-Prozessen: Candis.",
      "Viele Portal-Anbieter (Telekom-Geschäft, klassische Versorger): GetMyInvoices oder invoicefetcher.",
      "Es gibt Überschneidungen, klar. Für manche Setups lohnt sich sogar eine Kombination, etwa Infetch für die Mail-Rechnungen und ein Portal-Tool nebenher für die paar Anbieter, die ausschließlich übers Portal liefern.",
      "## Wenn du unsicher bist",
      "Der ehrlichste Weg ist, das Tool eine Woche im echten Setup laufen zu lassen. Bei Infetch ist der Free-Tarif genau dafür da: Postfach verbinden, Empfänger eintragen, schauen, was passiert. Wenn nach ein paar Tagen der Großteil deiner Belege automatisch dort landet, wo er hingehört, hat sich die Frage so halb von selbst beantwortet. Wenn nicht, weißt du immerhin, dass du ein Portal-Tool brauchst — auch das ist ein Erkenntnisgewinn.",
    ],
  },
];

export function getPost(slug: string): BlogPost | undefined {
  return POSTS.find((p) => p.slug === slug);
}
