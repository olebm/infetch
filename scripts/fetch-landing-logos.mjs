// Erzeugt die lokal gebündelten Marken-SVGs für den Landing-Logo-Pool
// ("Erkennt Rechnungen von"). Quelle: Simple Icons (CC0) via jsDelivr-npm-Mirror
// — dieselbe Quelle/Format wie die 7 bestehenden Logos (INFETCH-132). Die SVGs
// werden brand-coloriert gespeichert und versioniert; zur Laufzeit gibt es damit
// 0 externe Requests. Erneut ausführbar zum Erweitern des Pools:
//   node scripts/fetch-landing-logos.mjs
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

// Neue Marken (B2B-/SaaS-/Hosting-/Dev-/Design-Tools — plausible Rechnungs-
// Absender). Bestehende 7 (google/figma/dropbox/github/zoom/notion/stripe)
// bleiben unangetastet.
const NEW_SLUGS = [
  "slack", "adobe", "atlassian", "asana", "miro", "canva", "mailchimp",
  "zapier", "vercel", "cloudflare", "gitlab", "shopify", "hetzner", "linear",
  "airtable", "sentry", "twilio", "intercom", "digitalocean", "hubspot",
  "trello", "calendly",
];

// Fallback für Marken, die im (jsDelivr-versions-skewen) data-JSON fehlen, deren
// icons/*.svg aber existiert. Offizielle Simple-Icons-Brandfarben + Titel.
const HEX_FALLBACK = { slack: "4A154B", adobe: "FF0000", twilio: "F22F46", canva: "00C4CC" };
const TITLE_FALLBACK = { slack: "Slack", adobe: "Adobe", twilio: "Twilio", canva: "Canva" };

const OUT = path.resolve("public/images/logos");
const iconUrl = (s) => `https://cdn.jsdelivr.net/npm/simple-icons/icons/${s}.svg`;
const DATA_URL = "https://cdn.jsdelivr.net/npm/simple-icons/data/simple-icons.json";

const data = await (await fetch(DATA_URL)).json();
// Simple Icons lässt das `slug`-Feld weg, wenn es dem slugifizierten Titel
// entspricht (gilt für die meisten Marken) → zusätzlich nach normalisiertem
// Titel indexieren, sonst greift der Hex/Title-Lookup nicht.
const norm = (t) =>
  t.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\+/g, "plus").replace(/\./g, "dot").replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
const bySlug = new Map();
for (const d of data) {
  bySlug.set(norm(d.title), d);
  if (d.slug) bySlug.set(d.slug, d);
}

await mkdir(OUT, { recursive: true });

const ok = [];
for (const slug of NEW_SLUGS) {
  const res = await fetch(iconUrl(slug));
  if (!res.ok) {
    console.log(`SKIP ${slug} (HTTP ${res.status})`);
    continue;
  }
  const meta = bySlug.get(slug);
  const hex = meta?.hex ?? HEX_FALLBACK[slug] ?? "000000";
  const title = meta?.title ?? TITLE_FALLBACK[slug] ?? (slug[0].toUpperCase() + slug.slice(1));
  const raw = await res.text();
  // Brandfarbe ins <svg> injizieren (Format wie bestehende Logos).
  const svg = raw.replace(/<svg /, `<svg fill="#${hex}" `);
  await writeFile(path.join(OUT, `${slug}.svg`), svg, "utf8");
  ok.push({ slug, title });
}

// Ausgabe als POOL-Schnipsel für logo-strip.tsx
console.log("\nGENERATED (" + ok.length + "):");
console.log(ok.map((o) => `  { slug: "${o.slug}", alt: "${o.title}" },`).join("\n"));
