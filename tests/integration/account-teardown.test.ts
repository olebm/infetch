import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import {
  getOptionalOrgColumns,
  hardDeleteOrgData,
  purgeDeadUser,
  NonEmptyOrgPurgeRefused,
} from "@/lib/auth/account-teardown";

// Verifiziert die zwei destruktiven Primitive gegen eine echte DB:
//
//  A) hardDeleteOrgData (von deleteAccountAction genutzt — DARF alles löschen):
//     1. Vollständigkeit — ALLE Tenant-Zeilen weg.
//     2. FK-Reihenfolge  — wirft nicht (korrekte Child→Parent-Folge).
//     3. Invariante      — globaler Vendor (org=NULL) + fremder Mandant bleiben.
//
//  B) purgeDeadUser (Login-Aufräumpfad — DARF NUR leere Leichen löschen):
//     4. Guard          — nicht-leere Org → NonEmptyOrgPurgeRefused, NICHTS
//                          gelöscht (Schutz gegen den 2026-05-19-Incident).
//     5. Happy path     — wirklich leere Leiche → User/Org/Membership weg.

const hasDb = Boolean(process.env.DATABASE_URL);
const S = `${Date.now()}`;

const USER = `teardown-user-${S}`;
const ORG = `teardown-org-${S}`;
const OTHER_USER = `teardown-other-user-${S}`;
const OTHER_ORG = `teardown-other-org-${S}`;
const EMPTY_USER = `teardown-empty-user-${S}`;
const EMPTY_ORG = `teardown-empty-org-${S}`;

const GLOBAL_VENDOR_KEY = `teardown-global-vendor-${S}`;
const ORG_VENDOR_KEY = `teardown-org-vendor-${S}`;
const SECRET_REF = `teardown-secret-${S}`;
const SENDER_ADDR = `teardown-sender-${S}@example.com`;
const INBOUND_ID = `teardown-inbound-${S}`;
const USER_EMAIL = `${USER}@td.local`;
const SECRET_REF_ORPHAN = `teardown-orphan-secret-${S}`; // bleiben — nicht der gelöschten Org

const ORGS = [ORG, OTHER_ORG, EMPTY_ORG];
const USERS = [USER, OTHER_USER, EMPTY_USER];

let invoiceId = 0;
let acctId = 0;
let orgVendorId = 0;
let globalVendorId = 0;
let otherInvoiceId = 0;

async function cleanup() {
  // Strikt Child→Parent geordnet, scoped auf Test-Identifier — robust
  // unabhängig davon, welcher Test wie viel selbst gelöscht hat.
  await sql`DELETE FROM ai_extractions WHERE invoice_id IN (SELECT id FROM invoices WHERE organization_id = ANY(${ORGS}))`;
  await sql`DELETE FROM exports WHERE organization_id = ANY(${ORGS})`;
  await sql`DELETE FROM vendor_month_status WHERE organization_id = ANY(${ORGS}) OR vendor_id IN (SELECT id FROM vendors WHERE canonical_key IN (${GLOBAL_VENDOR_KEY}, ${ORG_VENDOR_KEY}))`;
  await sql`DELETE FROM vendor_aliases WHERE vendor_id IN (SELECT id FROM vendors WHERE canonical_key IN (${GLOBAL_VENDOR_KEY}, ${ORG_VENDOR_KEY}))`;
  await sql`DELETE FROM invoice_files WHERE sha256 LIKE ${`teardown-sha-%-${S}`}`;
  await sql`DELETE FROM invoices WHERE organization_id = ANY(${ORGS})`;
  await sql`DELETE FROM mail_messages WHERE mail_account_id = ${acctId}`;
  await sql`DELETE FROM mail_accounts WHERE organization_id = ANY(${ORGS})`;
  // DSGVO-Test-Reste — bewusst nach den FK-Children, vor credential_refs.
  await sql`DELETE FROM encrypted_secrets WHERE secret_ref IN (${SECRET_REF}, ${SECRET_REF_ORPHAN})`;
  await sql`DELETE FROM credential_refs WHERE secret_ref = ${SECRET_REF}`;
  await sql`DELETE FROM portal_browser_sessions WHERE vendor_key IN (${GLOBAL_VENDOR_KEY}, ${ORG_VENDOR_KEY})`;
  await sql`DELETE FROM portal_run_logs WHERE vendor_key IN (${GLOBAL_VENDOR_KEY}, ${ORG_VENDOR_KEY})`;
  await sql`DELETE FROM usage_events WHERE organization_id = ANY(${ORGS})`;
  await sql`DELETE FROM mail_inbound_addresses WHERE id = ${INBOUND_ID}`;
  await sql`DELETE FROM discovered_senders WHERE from_address = ${SENDER_ADDR}`;
  await sql`DELETE FROM vendors WHERE canonical_key IN (${GLOBAL_VENDOR_KEY}, ${ORG_VENDOR_KEY})`;
  await sql`DELETE FROM org_members WHERE user_id = ANY(${USERS})`;
  await sql`DELETE FROM organizations WHERE id = ANY(${ORGS})`;
  await sql`DELETE FROM users WHERE id = ANY(${USERS})`;
}

async function seedTenant() {
  await sql`INSERT INTO users (id, email, name) VALUES (${USER}, ${USER_EMAIL}, 'Teardown')`;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${ORG}, ${ORG}, ${ORG}, 'pro', ${USER})
  `;
  await sql`INSERT INTO org_members (organization_id, user_id, role) VALUES (${ORG}, ${USER}, 'owner')`;

  const [inv] = await sql<{ id: number }[]>`
    INSERT INTO invoices (organization_id, source, status, confidence, dedupe_key)
    VALUES (${ORG}, 'manual', 'ready', 0.9, ${`teardown-dedupe-${S}`})
    RETURNING id
  `;
  invoiceId = inv.id;

  await sql`
    INSERT INTO invoice_files (invoice_id, original_filename, stored_path, sha256, size_bytes, mime_type, source_type)
    VALUES (${invoiceId}, 'invoice.pdf', ${`${ORG}/invoice.pdf`}, ${`teardown-sha-1-${S}`}, 100, 'application/pdf', 'manual')
  `;
  await sql`
    INSERT INTO ai_extractions (invoice_id, provider, prompt_version, input_hash, status)
    VALUES (${invoiceId}, 'mistral', 'v1', ${`teardown-hash-${S}`}, 'succeeded')
  `;

  const [et] = await sql<{ id: number }[]>`
    INSERT INTO export_targets (organization_id, target, label)
    VALUES (${ORG}, 'kontist', 'Kontist')
    RETURNING id
  `;
  await sql`
    INSERT INTO exports (invoice_id, export_target_id, status, organization_id)
    VALUES (${invoiceId}, ${et.id}, 'pending', ${ORG})
  `;

  const [cred] = await sql<{ id: number }[]>`
    INSERT INTO credential_refs (scope, label, secret_store, secret_ref, status, organization_id)
    VALUES ('imap', 'IMAP', 'encrypted_db', ${SECRET_REF}, 'configured', ${ORG})
    RETURNING id
  `;
  // DSGVO: verschlüsseltes Passwort in encrypted_secrets — muss bei
  // Konto-Löschung mit verschwinden, sonst bleibt der Ciphertext orphaned.
  await sql`
    INSERT INTO encrypted_secrets (secret_ref, ciphertext)
    VALUES (${SECRET_REF}, ${`encrypted-payload-${S}`})
  `;
  // Fremder Ciphertext, der NICHT der gelöschten Org gehört — muss bleiben.
  await sql`
    INSERT INTO encrypted_secrets (secret_ref, ciphertext)
    VALUES (${SECRET_REF_ORPHAN}, ${`other-payload-${S}`})
  `;
  const [acct] = await sql<{ id: number }[]>`
    INSERT INTO mail_accounts (label, host, port, secure, username, credential_ref_id, status, organization_id)
    VALUES ('Mail', 'imap.test', 993, true, ${`${USER}@td.local`}, ${cred.id}, 'configured', ${ORG})
    RETURNING id
  `;
  acctId = acct.id;
  await sql`
    INSERT INTO mail_messages (mail_account_id, mailbox, uid, uidvalidity, from_address, subject, status)
    VALUES (${acctId}, 'INBOX', 1, 'v1', 'x@example.com', 'Mail', 'pending')
  `;

  await sql`INSERT INTO usage_events (organization_id, event_type) VALUES (${ORG}, 'ai_extraction')`;
  await sql`
    INSERT INTO mail_inbound_addresses (id, organization_id, local_part)
    VALUES (${INBOUND_ID}, ${ORG}, ${`teardown-${S}`})
  `;
  await sql`
    INSERT INTO discovered_senders (from_address, from_domain, organization_id)
    VALUES (${SENDER_ADDR}, 'example.com', ${ORG})
  `;

  // Hinweis: magic_links existiert in der Supabase-Postgres-DB nicht
  // (Legacy-Schema-Eintrag, ersetzt durch Supabase Auth). Der Production-
  // Code in deleteAccountAction hat einen defensiven Schema-Check, daher
  // hier keine Seed-Daten — ein dedizierter Schema-Drift-Test würde nur
  // CI-Lärm produzieren.

  // Org-eigener Custom-Vendor (muss mit) + globaler Vendor (muss bleiben).
  const [ov] = await sql<{ id: number }[]>`
    INSERT INTO vendors (name, canonical_key, category, organization_id)
    VALUES ('Org Vendor', ${ORG_VENDOR_KEY}, 'saas', ${ORG})
    RETURNING id
  `;
  // DSGVO: Portal-Spuren sind vendor_key-bound. Org-Vendor-Sessions/Logs
  // gehören dem gelöschten Tenant und müssen mit verschwinden. Globaler
  // Vendor (NULL) und seine Spuren bleiben unangetastet.
  await sql`
    INSERT INTO portal_browser_sessions (vendor_key, storage_state_path)
    VALUES (${ORG_VENDOR_KEY}, ${`/tmp/${ORG_VENDOR_KEY}.json`})
  `;
  await sql`
    INSERT INTO portal_run_logs (vendor_key, mode, status, started_at)
    VALUES (${ORG_VENDOR_KEY}, 'replay', 'success', CURRENT_TIMESTAMP)
  `;
  await sql`
    INSERT INTO portal_browser_sessions (vendor_key, storage_state_path)
    VALUES (${GLOBAL_VENDOR_KEY}, ${`/tmp/${GLOBAL_VENDOR_KEY}.json`})
  `;
  await sql`
    INSERT INTO portal_run_logs (vendor_key, mode, status, started_at)
    VALUES (${GLOBAL_VENDOR_KEY}, 'replay', 'success', CURRENT_TIMESTAMP)
  `;
  orgVendorId = ov.id;
  await sql`
    INSERT INTO vendor_aliases (vendor_id, alias, match_type)
    VALUES (${orgVendorId}, ${`alias-${S}`}, 'exact')
  `;
  await sql`
    INSERT INTO vendor_month_status
      (vendor_id, year_month, mail_status, portal_status, manual_status, final_status, source_used, organization_id)
    VALUES (${orgVendorId}, '2026-05', 'found', 'not_needed', 'none', 'found', 'mail', ${ORG})
  `;
  const [gv] = await sql<{ id: number }[]>`
    INSERT INTO vendors (name, canonical_key, category, organization_id)
    VALUES ('Global Vendor', ${GLOBAL_VENDOR_KEY}, 'saas', NULL)
    RETURNING id
  `;
  globalVendorId = gv.id;

  // Fremder Mandant — darf NICHT angefasst werden.
  await sql`INSERT INTO users (id, email, name) VALUES (${OTHER_USER}, ${`${OTHER_USER}@td.local`}, 'Other')`;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${OTHER_ORG}, ${OTHER_ORG}, ${OTHER_ORG}, 'free', ${OTHER_USER})
  `;
  await sql`INSERT INTO org_members (organization_id, user_id, role) VALUES (${OTHER_ORG}, ${OTHER_USER}, 'owner')`;
  const [oinv] = await sql<{ id: number }[]>`
    INSERT INTO invoices (organization_id, source, status, confidence, dedupe_key)
    VALUES (${OTHER_ORG}, 'manual', 'ready', 0.5, ${`teardown-other-dedupe-${S}`})
    RETURNING id
  `;
  otherInvoiceId = oinv.id;

  // Wirklich leere Leiche (kein invoices/mail/vendors) — purgeDeadUser darf die.
  await sql`INSERT INTO users (id, email, name) VALUES (${EMPTY_USER}, ${`${EMPTY_USER}@td.local`}, 'Empty')`;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${EMPTY_ORG}, ${EMPTY_ORG}, ${EMPTY_ORG}, 'free', ${EMPTY_USER})
  `;
  await sql`INSERT INTO org_members (organization_id, user_id, role) VALUES (${EMPTY_ORG}, ${EMPTY_USER}, 'owner')`;
}

async function count(query: Promise<{ c: string }[]>): Promise<number> {
  const [row] = await query;
  return Number(row.c);
}

/** Simuliert den Kern von deleteAccountAction: hardDeleteOrgData + User/Members. */
async function hardDeleteAccount(userId: string, orgId: string): Promise<void> {
  const cols = await getOptionalOrgColumns();
  await sql.begin(async (tx) => {
    await hardDeleteOrgData(tx, orgId, cols);
    await tx`DELETE FROM org_members WHERE user_id = ${userId}`;
    await tx`DELETE FROM users WHERE id = ${userId}`;
  });
}

describe.skipIf(!hasDb)("account teardown — hard delete", () => {
  beforeEach(async () => {
    await cleanup();
    await seedTenant();
  });
  afterEach(cleanup);

  it("hardDeleteOrgData removes every tenant row and does not throw on FK order", async () => {
    await expect(hardDeleteAccount(USER, ORG)).resolves.toBeUndefined();

    expect(await count(sql`SELECT COUNT(*) c FROM users WHERE id = ${USER}`)).toBe(0);
    expect(await count(sql`SELECT COUNT(*) c FROM organizations WHERE id = ${ORG}`)).toBe(0);
    expect(await count(sql`SELECT COUNT(*) c FROM org_members WHERE user_id = ${USER}`)).toBe(0);
    expect(await count(sql`SELECT COUNT(*) c FROM invoices WHERE organization_id = ${ORG}`)).toBe(
      0,
    );
    expect(
      await count(sql`SELECT COUNT(*) c FROM invoice_files WHERE invoice_id = ${invoiceId}`),
    ).toBe(0);
    expect(
      await count(sql`SELECT COUNT(*) c FROM ai_extractions WHERE invoice_id = ${invoiceId}`),
    ).toBe(0);
    expect(await count(sql`SELECT COUNT(*) c FROM exports WHERE organization_id = ${ORG}`)).toBe(0);
    expect(
      await count(sql`SELECT COUNT(*) c FROM export_targets WHERE organization_id = ${ORG}`),
    ).toBe(0);
    expect(
      await count(sql`SELECT COUNT(*) c FROM mail_accounts WHERE organization_id = ${ORG}`),
    ).toBe(0);
    expect(
      await count(sql`SELECT COUNT(*) c FROM mail_messages WHERE mail_account_id = ${acctId}`),
    ).toBe(0);
    expect(
      await count(sql`SELECT COUNT(*) c FROM credential_refs WHERE secret_ref = ${SECRET_REF}`),
    ).toBe(0);
    expect(
      await count(sql`SELECT COUNT(*) c FROM usage_events WHERE organization_id = ${ORG}`),
    ).toBe(0);
    expect(
      await count(sql`SELECT COUNT(*) c FROM mail_inbound_addresses WHERE id = ${INBOUND_ID}`),
    ).toBe(0);
    expect(
      await count(
        sql`SELECT COUNT(*) c FROM discovered_senders WHERE from_address = ${SENDER_ADDR}`,
      ),
    ).toBe(0);
    expect(
      await count(sql`SELECT COUNT(*) c FROM vendor_month_status WHERE vendor_id = ${orgVendorId}`),
    ).toBe(0);
    expect(
      await count(sql`SELECT COUNT(*) c FROM vendor_aliases WHERE vendor_id = ${orgVendorId}`),
    ).toBe(0);
    expect(await count(sql`SELECT COUNT(*) c FROM vendors WHERE id = ${orgVendorId}`)).toBe(0);
  });

  it("DSGVO: encrypted_secrets and portal traces all disappear with the tenant", async () => {
    await hardDeleteAccount(USER, ORG);

    // Verschlüsseltes Passwort für die gelöschte Org → weg.
    expect(
      await count(sql`SELECT COUNT(*) c FROM encrypted_secrets WHERE secret_ref = ${SECRET_REF}`),
    ).toBe(0);
    // Ein fremder Ciphertext (nicht der Org zugeordnet) muss BLEIBEN —
    // wir löschen nur die secret_refs der gelöschten Org.
    expect(
      await count(
        sql`SELECT COUNT(*) c FROM encrypted_secrets WHERE secret_ref = ${SECRET_REF_ORPHAN}`,
      ),
    ).toBe(1);

    // Portal-Spuren des org-eigenen Vendors → weg.
    expect(
      await count(
        sql`SELECT COUNT(*) c FROM portal_browser_sessions WHERE vendor_key = ${ORG_VENDOR_KEY}`,
      ),
    ).toBe(0);
    expect(
      await count(sql`SELECT COUNT(*) c FROM portal_run_logs WHERE vendor_key = ${ORG_VENDOR_KEY}`),
    ).toBe(0);

    // Portal-Spuren des globalen Vendors → bleiben.
    expect(
      await count(
        sql`SELECT COUNT(*) c FROM portal_browser_sessions WHERE vendor_key = ${GLOBAL_VENDOR_KEY}`,
      ),
    ).toBe(1);
    expect(
      await count(
        sql`SELECT COUNT(*) c FROM portal_run_logs WHERE vendor_key = ${GLOBAL_VENDOR_KEY}`,
      ),
    ).toBe(1);
  });

  it("hardDeleteOrgData leaves global vendor and a foreign tenant untouched", async () => {
    await hardDeleteAccount(USER, ORG);

    expect(await count(sql`SELECT COUNT(*) c FROM vendors WHERE id = ${globalVendorId}`)).toBe(1);
    expect(await count(sql`SELECT COUNT(*) c FROM users WHERE id = ${OTHER_USER}`)).toBe(1);
    expect(await count(sql`SELECT COUNT(*) c FROM organizations WHERE id = ${OTHER_ORG}`)).toBe(1);
    expect(await count(sql`SELECT COUNT(*) c FROM invoices WHERE id = ${otherInvoiceId}`)).toBe(1);
  });

  /**
   * Drift-Guard: Wenn die Migration eine neue Tabelle mit organization_id-
   * Spalte einführt, die nicht in hardDeleteOrgData gelistet ist, würden
   * Tenant-Daten "vergessen" werden — DSGVO-Verstoß. Dieser Test scannt
   * das Schema und scheitert sobald eine solche Tabelle entdeckt wird, die
   * nicht in der bekannten Lösch-Pipeline berücksichtigt ist.
   */
  it("DSGVO drift-guard: every public table with organization_id is in the teardown sweep", async () => {
    const KNOWN = new Set([
      // explizit in hardDeleteOrgData ODER via FK CASCADE auf organizations
      "organizations",
      "org_members",
      "users", // active_organization_id (SET NULL, kein Daten-Leak)
      "sessions", // active_organization_id (SET NULL)
      "mail_accounts",
      "credential_refs",
      "invoices",
      "vendors",
      "exports",
      "export_targets",
      "integration_targets",
      "discovered_senders",
      "usage_events",
      "mail_inbound_addresses",
      "vendor_month_status",
      "invoice_files",
      "auto_approval_rules",
      "portal_recipes", // org_id seit 0025+ — org-direkter Cleanup
      "portal_run_logs", // org_id seit 0025+ — zusätzlich zum vendor_key-Pfad
      "sync_runs", // org_id seit 0030 — Scan-Runs pro Org
    ]);

    const rows = await sql<{ tableName: string }[]>`
      SELECT DISTINCT table_name AS "tableName"
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'organization_id'
      ORDER BY table_name
    `;
    const unknown = rows.map((r) => r.tableName).filter((t) => !KNOWN.has(t));
    expect(
      unknown,
      `Neue Tabelle mit organization_id-Spalte entdeckt — sie muss in hardDeleteOrgData ` +
        `und in der KNOWN-Liste dieses Drift-Guards aufgenommen werden, ` +
        `sonst bleiben beim Hard-Delete personenbezogene Daten zurück (DSGVO): ${unknown.join(", ")}`,
    ).toEqual([]);
  });

  it("purgeDeadUser REFUSES a non-empty org and deletes nothing", async () => {
    await expect(purgeDeadUser(USER)).rejects.toThrow(NonEmptyOrgPurgeRefused);

    // Guard greift VOR jeder Transaktion → alles muss noch da sein.
    expect(await count(sql`SELECT COUNT(*) c FROM users WHERE id = ${USER}`)).toBe(1);
    expect(await count(sql`SELECT COUNT(*) c FROM organizations WHERE id = ${ORG}`)).toBe(1);
    expect(await count(sql`SELECT COUNT(*) c FROM invoices WHERE organization_id = ${ORG}`)).toBe(
      1,
    );
    expect(
      await count(sql`SELECT COUNT(*) c FROM mail_accounts WHERE organization_id = ${ORG}`),
    ).toBe(1);
  });

  it("purgeDeadUser purges a truly empty leftover", async () => {
    await expect(purgeDeadUser(EMPTY_USER)).resolves.toBeUndefined();

    expect(await count(sql`SELECT COUNT(*) c FROM users WHERE id = ${EMPTY_USER}`)).toBe(0);
    expect(await count(sql`SELECT COUNT(*) c FROM organizations WHERE id = ${EMPTY_ORG}`)).toBe(0);
    expect(await count(sql`SELECT COUNT(*) c FROM org_members WHERE user_id = ${EMPTY_USER}`)).toBe(
      0,
    );
  });
});
