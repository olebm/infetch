import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getLocale } from "@/lib/i18n";
import { PlausibleAnalytics } from "@/components/analytics/plausible";
import "@/app/globals.css";

// PERFORMANCE (INFETCH-98): Schriften über next/font/google self-hosten statt
// externem Google Fonts CDN. Eliminiert eine externe DNS-Verbindung, nutzt
// automatisches Subset- und Font-Display-Handling durch Next.js.
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Infetch – Rechnungen automatisch weiterleiten",
    template: "%s · Infetch",
  },
  description:
    "Infetch liest dein Postfach, erkennt jede Rechnung per KI und leitet sie automatisch an deine Buchhaltung weiter. DSGVO-konform, EU-Server, Setup in 4 Minuten.",
  metadataBase: new URL("https://infetch.de"),
  openGraph: {
    siteName: "Infetch",
    locale: "de_DE",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Infetch – Rechnungen automatisch weiterleiten",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-image.png"],
  },
  icons: {
    icon: [
      { url: "/images/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/images/icons/icon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/images/icons/icon-96.png", sizes: "96x96", type: "image/png" },
      { url: "/images/brand/infetch-icon.svg", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/images/icons/icon-120.png", sizes: "120x120", type: "image/png" },
      { url: "/images/icons/icon-180.png", sizes: "180x180", type: "image/png" },
    ],
    other: [
      { rel: "mask-icon", url: "/images/brand/infetch-icon.svg" },
    ],
  },
  manifest: "/site.webmanifest",
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // lang muss die tatsächlich ausgelieferte Sprache widerspiegeln (A11y + SEO);
  // vorher war "de" hart codiert, auch bei EN-Inhalt.
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${geist.variable} ${geistMono.variable}`}>
      <head>
        {/* PERFORMANCE: Söhne wird über @font-face in globals.css geladen — der
            Browser entdeckt das aber erst nach CSS-Parsing, was LCP verzögert.
            Explizites Preload bringt die kritischen Gewichte (H1=600, body=400)
            parallel zur CSS-Request ins Netzwerk. */}
        <link
          rel="preload"
          href="/fonts/soehne-halbfett.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/soehne-buch.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/* Vendor-Logos kommen vom Brandfetch-CDN — preconnect spart TCP+TLS-
            Handshake (~100-300 ms RTT). */}
        <link rel="preconnect" href="https://cdn.brandfetch.io" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
      <PlausibleAnalytics />
    </html>
  );
}
