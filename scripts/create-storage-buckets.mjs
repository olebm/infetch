#!/usr/bin/env node
/**
 * Creates the three private Supabase Storage buckets for Infetch.
 * Uses the Storage REST API directly (no WebSocket / Realtime needed).
 * Run once: node scripts/create-storage-buckets.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Load .env.local if env vars not set
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "../.env.local");
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* .env.local not found */
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("❌ NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
  process.exit(1);
}

const BUCKETS = ["invoices", "raw-text", "portal-sessions"];

for (const name of BUCKETS) {
  const res = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: name, name, public: false }),
  });
  const json = await res.json();
  if (res.ok) {
    console.log(`  ✅ ${name} — created`);
  } else if (json.error === "Duplicate" || json.message?.includes("already exists")) {
    console.log(`  ✓  ${name} — already exists`);
  } else {
    console.error(`  ✗  ${name} — ${json.message ?? JSON.stringify(json)}`);
  }
}
console.log("Done.");
