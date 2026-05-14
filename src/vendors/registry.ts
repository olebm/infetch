export type VendorSeed = {
  canonicalKey: string;
  name: string;
  category: "hosting" | "ai" | "saas" | "energy" | "hardware" | "telecom";
  aliases: Array<{ alias: string; matchType?: "exact" | "contains" | "domain" | "regex"; priority?: number }>;
};

// PortalDefinition entfernt — Online-Konten werden vom User manuell hinzugefuegt
// oder organisch aus dem Mail-Postfach gelesen (siehe vendors-Tabelle).

export const vendorSeeds: VendorSeed[] = [
  {
    canonicalKey: "webgo",
    name: "webgo",
    category: "hosting",
    aliases: [
      { alias: "webgo" },
      { alias: "webgo GmbH" },
      { alias: "webgo.de", matchType: "domain", priority: 10 },
    ],
  },
  {
    canonicalKey: "strato",
    name: "STRATO",
    category: "hosting",
    aliases: [{ alias: "strato" }, { alias: "STRATO AG" }],
  },
  {
    canonicalKey: "hetzner",
    name: "Hetzner",
    category: "hosting",
    aliases: [{ alias: "hetzner" }, { alias: "Hetzner Online GmbH" }, { alias: "Hetzner Cloud" }],
  },
  {
    canonicalKey: "anthropic",
    name: "Anthropic",
    category: "ai",
    aliases: [
      { alias: "anthropic" },
      { alias: "Anthropic PBC" },
      { alias: "Claude" },
      { alias: "claude.ai", matchType: "domain", priority: 10 },
    ],
  },
  {
    canonicalKey: "openai",
    name: "OpenAI",
    category: "ai",
    aliases: [{ alias: "openai" }, { alias: "OpenAI Ireland Ltd." }, { alias: "OpenAI, L.L.C." }],
  },
  {
    canonicalKey: "hostinger",
    name: "Hostinger",
    category: "hosting",
    aliases: [{ alias: "hostinger" }, { alias: "Hostinger International" }],
  },
  {
    canonicalKey: "adobe",
    name: "Adobe",
    category: "saas",
    aliases: [{ alias: "adobe" }, { alias: "Adobe Systems" }, { alias: "Adobe Ireland" }],
  },
  {
    canonicalKey: "raidboxes",
    name: "Raidboxes",
    category: "hosting",
    aliases: [{ alias: "raidboxes" }, { alias: "Raidboxes GmbH" }],
  },
  {
    canonicalKey: "enbw",
    name: "EnBW",
    category: "energy",
    aliases: [{ alias: "enbw" }, { alias: "EnBW mobility+" }, { alias: "EnBW Energie Baden-Wuerttemberg" }],
  },
  {
    canonicalKey: "mistral",
    name: "Mistral AI",
    category: "ai",
    aliases: [{ alias: "mistral" }, { alias: "Mistral AI" }, { alias: "Mistral AI SAS" }],
  },
  {
    canonicalKey: "oura",
    name: "Oura Ring",
    category: "hardware",
    aliases: [{ alias: "oura" }, { alias: "Oura Health" }, { alias: "Oura Ring" }],
  },
  {
    canonicalKey: "vodafone",
    name: "Vodafone",
    category: "telecom",
    aliases: [{ alias: "vodafone" }, { alias: "Vodafone GmbH" }, { alias: "Vodafone Deutschland" }],
  },
];

export type PortalCategoryKey =
  | "energy"
  | "telecom"
  | "hosting"
  | "software"
  | "ai"
  | "hardware"
  | "banking"
  | "ecommerce"
  | "other";

// Optionale Kategorie-Labels fuer die UI (z.B. Filter-Chips). Vendors koennen sich freiwillig
// einer Kategorie zuordnen, muessen aber nicht.
export const PORTAL_CATEGORIES: Record<PortalCategoryKey, { label: string }> = {
  energy: { label: "Strom & Gas" },
  telecom: { label: "Telekommunikation" },
  hosting: { label: "Webhosting" },
  software: { label: "Software" },
  ai: { label: "KI-Dienste" },
  hardware: { label: "Hardware" },
  banking: { label: "Banken" },
  ecommerce: { label: "Online-Shops" },
  other: { label: "Sonstige" },
};
