import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import {
  readJsonSetting,
  writeJsonSetting,
  readOrgJsonSetting,
  writeOrgJsonSetting,
} from "@/lib/db/settings-store";

// Regressionstest für die Per-Org-Isolierung des globalen Settings-Stores.
// Die `settings`-Tabelle ist eine globale key→value-Map ohne organization_id;
// user-editierbare Settings (invoice_subject_template, auto_approve_confidence)
// werden über den Key-Suffix `${key}:${orgId}` getrennt. Vorher teilten/
// überschrieben sich alle Mandanten denselben Globalwert.

const hasDb = Boolean(process.env.DATABASE_URL);
const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const KEY = `test_org_setting_${SUFFIX}`;
const ORG_A = `set-a-${SUFFIX}`;
const ORG_B = `set-b-${SUFFIX}`;

async function cleanup() {
  await sql`DELETE FROM settings WHERE key IN (${KEY}, ${`${KEY}:${ORG_A}`}, ${`${KEY}:${ORG_B}`})`;
}

describe.skipIf(!hasDb)("settings store — per-org isolation", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("writeOrgJsonSetting schreibt nur den org-gescopten Key (nicht global)", async () => {
    await writeOrgJsonSetting(KEY, ORG_A, "value-a");
    expect(await readJsonSetting<string>(`${KEY}:${ORG_A}`, "MISS")).toBe("value-a");
    // Globaler Key bleibt unberührt — Mandanten überschreiben sich nicht.
    expect(await readJsonSetting<string>(KEY, "MISS")).toBe("MISS");
  });

  it("ein Mandant sieht den Wert eines anderen NICHT (kein Bleed)", async () => {
    await writeOrgJsonSetting(KEY, ORG_A, "value-a");
    expect(await readOrgJsonSetting<string>(KEY, ORG_A, "default")).toBe("value-a");
    // Org B hat keinen eigenen Wert und es gibt keinen Globalwert → Default.
    expect(await readOrgJsonSetting<string>(KEY, ORG_B, "default")).toBe("default");
  });

  it("Legacy-Global-Fallback: ohne Org-Wert wird der alte Globalkey gelesen, eigener Wert verdrängt ihn", async () => {
    // Bestandswert unter dem alten globalen Key (wie ole's Daten vor der Umstellung).
    await writeJsonSetting(KEY, "legacy-global");
    // Org ohne eigenen Wert sieht den Legacy-Globalwert → null Live-Impact.
    expect(await readOrgJsonSetting<string>(KEY, ORG_A, "default")).toBe("legacy-global");
    // Sobald die Org speichert, gewinnt der org-gescopte Wert.
    await writeOrgJsonSetting(KEY, ORG_A, "value-a");
    expect(await readOrgJsonSetting<string>(KEY, ORG_A, "default")).toBe("value-a");
    // Andere Org sieht weiterhin nur den Legacy-Globalwert, nicht A's Wert.
    expect(await readOrgJsonSetting<string>(KEY, ORG_B, "default")).toBe("legacy-global");
  });

  it("ohne orgId verhält es sich wie der globale Store", async () => {
    await writeOrgJsonSetting(KEY, null, "global-write");
    expect(await readJsonSetting<string>(KEY, "MISS")).toBe("global-write");
    expect(await readOrgJsonSetting<string>(KEY, null, "default")).toBe("global-write");
  });
});
