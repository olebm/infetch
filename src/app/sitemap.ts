import type { MetadataRoute } from "next";
import { POSTS } from "@/app/blog/posts";

// Statische lastModified-Daten: ein dynamisches `new Date()` bei jedem Request
// signalisiert Crawlern, dass sich ALLES ständig ändert (verbranntes
// Crawl-Budget, entwertete Änderungssignale). Datum nur erhöhen, wenn sich
// der jeweilige Seiteninhalt tatsächlich ändert.
const LEGAL_LAST_MODIFIED = new Date("2026-05-15");
const HOME_LAST_MODIFIED = new Date("2026-05-15");

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://infetch.de";

  return [
    {
      url: base,
      lastModified: HOME_LAST_MODIFIED,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/ueber-uns`,
      lastModified: HOME_LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${base}/agb`,
      lastModified: LEGAL_LAST_MODIFIED,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${base}/datenschutz`,
      lastModified: LEGAL_LAST_MODIFIED,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${base}/impressum`,
      lastModified: LEGAL_LAST_MODIFIED,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: `${base}/avv`,
      lastModified: LEGAL_LAST_MODIFIED,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: `${base}/blog`,
      lastModified: HOME_LAST_MODIFIED,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    ...POSTS.map((post) => ({
      url: `${base}/blog/${post.slug}`,
      lastModified: new Date(post.date),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    // /changelog bewusst NICHT in der Sitemap: Seite ist aktuell ohne Inhalt
    // (Thin/Empty Content). Wieder aufnehmen, sobald echte Einträge existieren.
  ];
}
