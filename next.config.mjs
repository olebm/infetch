import path from "node:path";
import { fileURLToPath } from "node:url";
import { withSentryConfig } from "@sentry/nextjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Content-Security-Policy ───────────────────────────────────────────────────
// Erlaubte Cross-Origin-Ziele werden aus den Env-URLs abgeleitet, damit die
// CSP zwischen Umgebungen (lokal / staging / prod) automatisch korrekt ist.
function safeOrigin(value) {
  try {
    return value ? new URL(value).origin : "";
  } catch {
    return "";
  }
}

function buildCsp() {
  const isProd = process.env.NODE_ENV === "production";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseOrigin = safeOrigin(supabaseUrl);
  let supabaseWs = "";
  try {
    if (supabaseUrl) supabaseWs = `wss://${new URL(supabaseUrl).host}`;
  } catch {
    /* ignore */
  }
  const sentryOrigin = safeOrigin(process.env.SENTRY_DSN);

  // Plausible (cookielose Analytics): Script + Event-Endpoint freigeben.
  // Origin DIREKT aus NEXT_PUBLIC_PLAUSIBLE_SRC ableiten — exakt die Variable,
  // die auch <PlausibleAnalytics> rendert. Vorher war die CSP auf
  // NEXT_PUBLIC_PLAUSIBLE_DOMAIN gegated; war SRC (Script lädt) ohne DOMAIN
  // gesetzt, blieb der Origin leer → CSP-Verstoß (INFETCH-217).
  const plausibleOrigin = safeOrigin(process.env.NEXT_PUBLIC_PLAUSIBLE_SRC);
  // app.infetch.de — needed when pages are served from infetch.de and RSC fetches
  // cross-origin to app.infetch.de after Coolify's redirect.
  const appOrigin = safeOrigin(process.env.NEXT_PUBLIC_APP_URL);

  const connectSrc = ["'self'", supabaseOrigin, supabaseWs, sentryOrigin, plausibleOrigin, appOrigin]
    .filter(Boolean)
    .join(" ");
  const scriptSrc = ["'self'", "'unsafe-inline'", plausibleOrigin]
    .filter(Boolean)
    .join(" ");

  return [
    "default-src 'self'",
    // Next.js injiziert Inline-Bootstrap-Skripte; im Dev zusätzlich eval (HMR).
    `script-src ${scriptSrc}${isProd ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    // VendorLogo im App-Bereich lädt Icons von Brandfetch-CDN (Token-gated).
    // Landingpage-LogoStrip nutzt lokale SVGs (INFETCH-132); cdn.brandfetch.io
    // bleibt für den authentifizierten App-Bereich (Dashboard, Senders-View etc.).
    // Supabase-Storage-Origin für Avatare (img-src), Brandfetch-CDN für Logos.
    `img-src 'self' data: blob: https://cdn.brandfetch.io${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    // PDF-Vorschau läuft same-origin über /api/invoice-files (+ blob:-Fallback).
    "frame-src 'self' blob:",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "report-uri /api/csp-report",
  ].join("; ");
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["playwright"],
  outputFileTracingRoot: __dirname,
  // Moderne Bildformate: Next liefert große Quell-Bilder automatisch als
  // AVIF/WebP aus (deutlich kleiner als PNG/JPEG) — wichtig für LCP/CWV.
  images: {
    formats: ["image/avif", "image/webp"],
  },
  // SECURITY (INFETCH-91): HTTP Security Headers für alle Routen.
  async headers() {
    return [
      // PERFORMANCE: Statische Marketing-Assets (Fonts, Brand-Logos, Fotos)
      // dürfen aggressiv im Browser- und Edge-Cache liegen — Dateinamen sind
      // versioniert (Hash bei Foto-Updates), Korrekturen erzwingen Rename.
      // Adressiert "Effiziente Cache-Lebensdauer verwenden" in PageSpeed.
      {
        source: "/fonts/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/images/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          // Kein Clickjacking — App darf nicht in fremde iframes eingebettet werden
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Browser soll MIME-Typ nicht raten (wichtig da PDFs ausgeliefert werden)
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Referrer nur an gleiche Origin weitergeben
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // HSTS: 1 Jahr, inkl. Subdomains (nur aktiv wenn HTTPS)
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          // Mikrofon, Kamera etc. deaktivieren — App braucht keine Geräte-APIs
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // CSP zunächst im Report-Only-Modus: meldet Verstöße an
          // /api/csp-report, blockt aber nichts (kein UI-Bruch-Risiko).
          // Nach sauberer Beobachtung auf "Content-Security-Policy" umstellen.
          { key: "Content-Security-Policy-Report-Only", value: buildCsp() },
          // Cross-Origin-Isolation-Härtung
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // Phase 1 (alte technische Routen)
      { source: "/invoices", destination: "/audit", permanent: true },
      { source: "/invoices/:invoiceId", destination: "/audit/:invoiceId", permanent: true },
      { source: "/settings", destination: "/einstellungen", permanent: true },
      { source: "/downloads", destination: "/audit", permanent: true },
      { source: "/runs", destination: "/", permanent: true },
      // Englisch -> Deutsch (frueher Phase A)
      { source: "/inbox", destination: "/audit", permanent: true },
      { source: "/inbox/:invoiceId", destination: "/audit/:invoiceId", permanent: true },
      { source: "/missing", destination: "/fehlt", permanent: true },
      { source: "/setup", destination: "/einstellungen", permanent: true },
      // Portals werden in /fehlt integriert
      { source: "/portals", destination: "/fehlt", permanent: true },
      // Posteingang wird zu Audit (Phase A Glasbox-UX)
      { source: "/posteingang", destination: "/audit", permanent: true },
      { source: "/posteingang/:invoiceId", destination: "/audit/:invoiceId", permanent: true },
      // SEO (INFETCH-125): Direkter Zugriff auf /landingpage wäre Duplicate
      // Content (Canonical zeigt auf https://infetch.de/). Permanenter Redirect
      // sorgt dafür, dass Suchmaschinen + Direktlinks beide Pfade konsolidieren.
      { source: "/landingpage", destination: "/", permanent: true },
    ];
  },
  async rewrites() {
    // SEO (INFETCH-125): Die Public-Root rendert intern die Landingpage. Bisher
    // erledigte ein externer Proxy (Coolify) diese Umschreibung; intern
    // doppelt verriegeln macht Dev- und alternative Deployments self-contained
    // (rewrite, NICHT redirect — User bleibt auf /, Canonical bleibt /).
    return [{ source: "/", destination: "/landingpage" }];
  },
};

export default withSentryConfig(nextConfig, {
  // Sentry-Org und -Projekt aus Env (gesetzt in .env.local / Coolify)
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Source Maps im Client-Bundle verstecken (werden nur an Sentry hochgeladen)
  hideSourceMaps: true,

  // Sentry-Logger-Statements aus dem Bundle entfernen
  disableLogger: true,

  // Kein Performance-Tracing (konsistent mit server-config.ts)
  tracesSampleRate: 0,

  // Nur in CI-/Build-Umgebungen ausgeben — im Dev-Server ruhig bleiben
  silent: !process.env.CI && process.env.NODE_ENV !== "production",

  // Kein automatisches Instrumentation von API-Routes (selbst konfiguriert)
  autoInstrumentServerFunctions: false,
});
