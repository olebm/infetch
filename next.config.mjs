import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["playwright"],
  outputFileTracingRoot: __dirname,
  webpack(config) {
    config.cache = false;
    return config;
  },
  // SECURITY (INFETCH-91): HTTP Security Headers für alle Routen.
  async headers() {
    return [
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
    ];
  },
};

export default nextConfig;
