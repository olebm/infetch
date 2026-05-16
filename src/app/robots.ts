import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // (app) ist eine Next.js Route Group — taucht NIE in der URL auf.
        // Daher müssen die echten App-Pfade einzeln ausgeschlossen werden.
        // /landingpage ist die intern gerenderte Quelle für die per Proxy
        // ausgelieferte Root (infetch.de/) — direkter Zugriff = Duplicate
        // Content, deshalb vom Crawling ausschließen (Canonical zeigt auf /).
        disallow: [
          "/api/",
          "/landingpage",
          "/audit",
          "/fehlt",
          "/einstellungen",
          "/konto",
          "/exports",
          "/senders",
          "/online-accounts",
          "/onboarding",
          "/login",
          "/auth/",
        ],
      },
    ],
    sitemap: "https://infetch.de/sitemap.xml",
  };
}
