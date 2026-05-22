import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Infetch – Rechnungen automatisch weiterleiten",
  description:
    "Infetch liest dein Postfach, erkennt jede Rechnung per KI und leitet sie automatisch an deine Buchhaltung weiter. DSGVO-konform, EU-Server, Setup in 4 Minuten.",
  openGraph: {
    title: "Infetch – Rechnungen automatisch weiterleiten",
    description:
      "Dein Postfach scannt sich selbst. Jede Rechnung landet automatisch bei deiner Buchhaltung — ohne manuelle Weiterleitung.",
    url: "https://infetch.de",
    type: "website",
  },
  twitter: {
    title: "Infetch – Rechnungen automatisch weiterleiten",
    description:
      "Dein Postfach scannt sich selbst. Jede Rechnung landet automatisch bei deiner Buchhaltung.",
  },
  alternates: {
    canonical: "https://infetch.de",
  },
};

// JSON-LD: FAQPage-Schema für Google Rich Results
const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Liest Infetch wirklich alle meine Mails?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Nein. Infetch scannt Mails auf Rechnungsmerkmale — Absender-Muster, PDF-Anhänge, Betreff-Stichwörter. Nur erkannte Belege werden vollständig gespeichert. Für alle anderen Mails legen wir nur einen technischen UID-Marker zur Deduplikation an — kein Absender, kein Betreff, kein Inhalt. Private Nachrichten werden nicht verarbeitet und nicht weitergeleitet.",
      },
    },
    {
      "@type": "Question",
      name: "Was passiert, wenn die KI sich irrt?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Unsichere Fälle gehen nicht raus — sie landen im Posteingang und warten auf dein OK. Du korrigierst einmal, der Agent lernt.",
      },
    },
    {
      "@type": "Question",
      name: "Wer sieht meine Rechnungen?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Nur du und die Empfänger, die du selbst hinterlegst. Kein Mensch außer dir hat Zugriff auf deine Belegdaten.",
      },
    },
    {
      "@type": "Question",
      name: "Brauche ich technisches Wissen?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Nein. Postfach verbinden, Empfänger eintragen, fertig. Vier Minuten.",
      },
    },
    {
      "@type": "Question",
      name: "Kann ich Anbieter ausschließen?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Ja, pro Mail oder pro Domain. Spotify, Netflix oder die private Stromabrechnung kommen nie an die Buchhaltung.",
      },
    },
    {
      "@type": "Question",
      name: "Wie kündige ich?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Monatlich kündbar, direkt über dein Stripe-Kundenkonto. Auf Wunsch löschen wir deine Daten vollständig.",
      },
    },
  ],
};

// SoftwareApplication-Schema
const appSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Infetch",
  url: "https://infetch.de",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  offers: [
    {
      "@type": "Offer",
      price: "0",
      priceCurrency: "EUR",
      name: "Free",
    },
    {
      "@type": "Offer",
      price: "19",
      priceCurrency: "EUR",
      name: "Pro",
    },
  ],
  description:
    "Infetch liest dein Postfach, erkennt jede Rechnung per KI und leitet sie automatisch an deine Buchhaltung weiter.",
};

// Organization-Schema — Basis für Knowledge Graph / GEO-Sichtbarkeit
const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Infetch",
  url: "https://infetch.de",
  logo: "https://infetch.de/images/brand/infetch-logo.png",
  email: "hallo@infetch.de",
  description:
    "Infetch ist eine Webanwendung, die Eingangsrechnungen automatisch aus E-Mail-Postfächern erkennt und an Buchhaltungstools oder Steuerberater weiterleitet. DSGVO-konform, EU-Server, KI-basierte Belegerkennung.",
  founder: {
    "@type": "Person",
    name: "Ole Beekmann",
    jobTitle: "Gründer",
  },
  address: {
    "@type": "PostalAddress",
    addressLocality: "Hamburg",
    addressCountry: "DE",
  },
};

// WebSite-Schema
const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Infetch",
  url: "https://infetch.de",
  inLanguage: "de-DE",
  description:
    "Rechnungen automatisch aus dem Postfach erkennen und an die Buchhaltung weiterleiten — DSGVO-konform, EU-Server, Setup in 4 Minuten.",
};

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(appSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
      />
      {children}
    </>
  );
}
