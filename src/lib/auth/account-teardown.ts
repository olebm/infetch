import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import type postgres from "postgres";

/**
 * Geteilte, geordnete Hard-Delete-Logik für Tenant-Daten.
 *
 * Eine einzige Quelle der Wahrheit für die Lösch-Reihenfolge: sowohl der
 * Self-Service-Konto-Löschpfad (deleteAccountAction) als auch der
 * Login-Provisioning-Pfad (ensureUserProvisioned, Aufräumen einer
 * soft-gelöschten Alt-Leiche) nutzen exakt dieselbe Sequenz. Zwei Kopien
 * würden zwangsläufig auseinanderlaufen und FK-Fehler produzieren.
 */

type Tx = postgres.TransactionSql<Record<string, unknown>>;
type SqlClient = postgres.Sql<Record<string, unknown>>;

/**
 * Drift-Guard: organization_id-Spalten, die erst spätere Migrationen
 * (0013/0019/0020/0022) ergänzt haben, existieren auf dem gedrifteten
 * Prod-Schema evtl. NICHT. Ein DELETE auf eine fehlende Spalte würde die
 * ganze Transaktion abbrechen — also vorab prüfen, welche real da sind.
 */
export async function getOptionalOrgColumns(
  client: SqlClient = sql,
): Promise<Set<string>> {
  const cols = await client<{ tableName: string }[]>`
    SELECT table_name AS "tableName"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'organization_id'
      AND table_name IN (
        'export_targets', 'invoice_files', 'vendor_month_status',
        'discovered_senders', 'integration_targets', 'auto_approval_rules',
        'portal_recipes', 'portal_run_logs'
      )
  `;
  return new Set(cols.map((c) => c.tableName));
}

/**
 * Löscht ALLE Tenant-Daten genau einer Organisation, geordnet Child→Parent,
 * inkl. der organizations-Zeile selbst. Verlässt sich NICHT auf
 * ON DELETE CASCADE. Geteilte/globale Daten (Vendors mit
 * organization_id IS NULL, globale Portal-Recipes) bleiben unangetastet —
 * nur org-eigene Custom-Vendors werden mitgelöscht.
 *
 * Muss innerhalb einer Transaktion laufen.
 */
export async function hardDeleteOrgData(
  tx: Tx,
  oid: string,
  optOrgCols: Set<string>,
): Promise<void> {
  const hasOrgCol = (t: string) => optOrgCols.has(t);

  // Drift-Guard auf TABELLEN-Ebene: das gedriftete Prod-Schema kann ganze
  // Tabellen vermissen lassen, die in den Migrationen existieren (z. B.
  // mail_inbound_addresses). Ein DELETE auf eine fehlende Tabelle (42P01)
  // würde die ganze Transaktion abbrechen → vorab erfassen, was real da ist,
  // und Statements für fehlende Tabellen überspringen. (Die optOrgCols-
  // Statements sind implizit schon tabellen-sicher: getOptionalOrgColumns
  // liefert eine fehlende Tabelle gar nicht erst zurück.)
  const present = new Set(
    (
      await tx<{ t: string }[]>`
        SELECT table_name t FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN (
          'portal_runs','portal_run_logs','portal_browser_sessions',
          'portal_recipes',
          'ai_extractions','exports','sync_events',
          'vendor_month_status','invoice_files','invoices','mail_messages',
          'mail_accounts','credential_refs','encrypted_secrets','usage_events',
          'mail_inbound_addresses','discovered_senders','vendor_aliases',
          'portal_sessions','auto_approval_rules','vendors','organizations'
        )
      `
    ).map((r) => r.t),
  );
  const run = async (table: string, exec: () => Promise<unknown>) => {
    if (present.has(table)) await exec();
  };

  // ── Invoice-Subgraph ───────────────────────────────────────────────────
  await run("portal_runs", () => tx`
    UPDATE portal_runs SET downloaded_invoice_id = NULL
    WHERE downloaded_invoice_id IN (
      SELECT id FROM invoices WHERE organization_id = ${oid}
    )
  `);
  await run("ai_extractions", () => tx`
    DELETE FROM ai_extractions WHERE invoice_id IN (
      SELECT id FROM invoices WHERE organization_id = ${oid}
    )
  `);
  await run("exports", () => tx`
    DELETE FROM exports
    WHERE organization_id = ${oid}
       OR invoice_id IN (
         SELECT id FROM invoices WHERE organization_id = ${oid}
       )
  `);
  await run("sync_events", () => tx`
    DELETE FROM sync_events WHERE invoice_id IN (
      SELECT id FROM invoices WHERE organization_id = ${oid}
    )
  `);
  await run("vendor_month_status", () => tx`
    DELETE FROM vendor_month_status WHERE invoice_id IN (
      SELECT id FROM invoices WHERE organization_id = ${oid}
    )
  `);
  if (hasOrgCol("vendor_month_status")) {
    await tx`DELETE FROM vendor_month_status WHERE organization_id = ${oid}`;
  }
  await run("invoice_files", () => tx`
    DELETE FROM invoice_files WHERE invoice_id IN (
      SELECT id FROM invoices WHERE organization_id = ${oid}
    )
  `);
  if (hasOrgCol("invoice_files")) {
    await tx`DELETE FROM invoice_files WHERE organization_id = ${oid}`;
  }
  await run("invoices", () => tx`
    UPDATE invoices SET duplicate_of_invoice_id = NULL
    WHERE organization_id = ${oid} AND duplicate_of_invoice_id IS NOT NULL
  `);
  await run("invoices", () => tx`DELETE FROM invoices WHERE organization_id = ${oid}`);

  // ── Mail & Credentials ─────────────────────────────────────────────────
  await run("mail_messages", () => tx`
    DELETE FROM mail_messages WHERE mail_account_id IN (
      SELECT id FROM mail_accounts WHERE organization_id = ${oid}
    )
  `);
  await run("mail_accounts", () => tx`DELETE FROM mail_accounts WHERE organization_id = ${oid}`);
  // DSGVO: verschlüsselte IMAP/SMTP-Passwörter aus encrypted_secrets
  // mitlöschen, BEVOR credential_refs verschwindet — sonst sind die
  // secret_refs nicht mehr ableitbar und das Ciphertext bleibt orphaned
  // in der Tabelle liegen ("vergessene Daten").
  await run("encrypted_secrets", () => tx`
    DELETE FROM encrypted_secrets WHERE secret_ref IN (
      SELECT secret_ref FROM credential_refs WHERE organization_id = ${oid}
    )
  `);
  await run("credential_refs", () => tx`DELETE FROM credential_refs WHERE organization_id = ${oid}`);

  // ── Org-scoped Misc (Basisschema — aber Prod kann driften) ─────────────
  await run("usage_events", () => tx`DELETE FROM usage_events WHERE organization_id = ${oid}`);
  await run("mail_inbound_addresses", () => tx`DELETE FROM mail_inbound_addresses WHERE organization_id = ${oid}`);

  // ── Org-scoped Misc (migrations-spät: nur falls Spalte existiert) ───────
  if (hasOrgCol("export_targets")) {
    await tx`DELETE FROM export_targets WHERE organization_id = ${oid}`;
  }
  if (hasOrgCol("integration_targets")) {
    await tx`DELETE FROM integration_targets WHERE organization_id = ${oid}`;
  }
  if (hasOrgCol("discovered_senders")) {
    await tx`DELETE FROM discovered_senders WHERE organization_id = ${oid}`;
  }

  // ── Org-eigene Custom-Vendors (globale org=NULL bleiben!) ──────────────
  await run("discovered_senders", () => tx`
    UPDATE discovered_senders SET matched_vendor_id = NULL
    WHERE matched_vendor_id IN (
      SELECT id FROM vendors WHERE organization_id = ${oid}
    )
  `);
  await run("vendor_aliases", () => tx`
    DELETE FROM vendor_aliases WHERE vendor_id IN (
      SELECT id FROM vendors WHERE organization_id = ${oid}
    )
  `);
  await run("portal_sessions", () => tx`
    DELETE FROM portal_sessions WHERE vendor_id IN (
      SELECT id FROM vendors WHERE organization_id = ${oid}
    )
  `);
  await run("portal_runs", () => tx`
    DELETE FROM portal_runs WHERE vendor_id IN (
      SELECT id FROM vendors WHERE organization_id = ${oid}
    )
  `);
  await run("vendor_month_status", () => tx`
    DELETE FROM vendor_month_status WHERE vendor_id IN (
      SELECT id FROM vendors WHERE organization_id = ${oid}
    )
  `);
  await run("sync_events", () => tx`
    DELETE FROM sync_events WHERE vendor_id IN (
      SELECT id FROM vendors WHERE organization_id = ${oid}
    )
  `);
  await run("auto_approval_rules", () => tx`
    DELETE FROM auto_approval_rules WHERE vendor_id IN (
      SELECT id FROM vendors WHERE organization_id = ${oid}
    )
  `);
  if (present.has("auto_approval_rules") && hasOrgCol("auto_approval_rules")) {
    await tx`DELETE FROM auto_approval_rules WHERE organization_id = ${oid}`;
  }
  // INFETCH-177: Portal-Spuren (Recipes, Run-Logs, Browser-Sessions) sind
  // historisch über vendor_key statt organization_id gebunden. Da
  // vendors.canonical_key historisch global UNIQUE war, entspricht ein
  // vendor_key eines org-eigenen Vendors implizit dieser Org → mitlöschen,
  // BEVOR vendors verschwinden. Migration 0026 hat zusätzlich organization_id
  // direkt auf portal_recipes/portal_run_logs gelegt; der zweite DELETE-
  // Block deckt Zeilen ab, die ohne vendor-FK direkt zur Org gehören.
  await run("portal_browser_sessions", () => tx`
    DELETE FROM portal_browser_sessions WHERE vendor_key IN (
      SELECT canonical_key FROM vendors WHERE organization_id = ${oid}
    )
  `);
  await run("portal_run_logs", () => tx`
    DELETE FROM portal_run_logs WHERE vendor_key IN (
      SELECT canonical_key FROM vendors WHERE organization_id = ${oid}
    )
  `);
  if (hasOrgCol("portal_run_logs")) {
    await tx`DELETE FROM portal_run_logs WHERE organization_id = ${oid}`;
  }
  await run("portal_recipes", () => tx`
    DELETE FROM portal_recipes WHERE vendor_key IN (
      SELECT canonical_key FROM vendors WHERE organization_id = ${oid}
    )
  `);
  if (hasOrgCol("portal_recipes")) {
    await tx`DELETE FROM portal_recipes WHERE organization_id = ${oid}`;
  }
  await run("vendors", () => tx`DELETE FROM vendors WHERE organization_id = ${oid}`);

  // ── Org selbst ─────────────────────────────────────────────────────────
  await run("organizations", () => tx`DELETE FROM organizations WHERE id = ${oid}`);
}

/**
 * Fehler, wenn purgeDeadUser eine Org mit echten Daten löschen würde.
 * Bewusst NICHT abfangen-und-weiter: der Aufrufer (Login-Pfad) soll lieber
 * sauber fehlschlagen als Produktivdaten vernichten.
 */
export class NonEmptyOrgPurgeRefused extends Error {
  constructor(orgId: string, counts: Record<string, number>) {
    super(
      `Refusing to auto-purge org ${orgId}: not empty (${JSON.stringify(counts)})`,
    );
    this.name = "NonEmptyOrgPurgeRefused";
  }
}

/**
 * Räumt eine soft-gelöschte LEERE Alt-Leiche weg: vom toten Nutzer besessene
 * Organisationen hart abbauen, dann Mitgliedschaften + users-Zeile löschen.
 * Danach ist die E-Mail frei → ensureUserProvisioned legt frisch an.
 *
 * HARTER GUARD: Enthält eine besessene Org Daten (Invoices, Mail-Konten oder
 * org-eigene Vendors), wird der Purge VOR jedem Schreibzugriff abgebrochen
 * ({@link NonEmptyOrgPurgeRefused}). Hintergrund: Migration 0022 hat alle
 * Legacy-Orphan-Invoices einer designierten Org zugeordnet — die kann unter
 * einem (versehentlich) soft-gelöschten Account hängen. Ein Auto-Purge im
 * Login-Pfad darf solche Produktivdaten NIEMALS löschen.
 */
export async function purgeDeadUser(deadUserId: string): Promise<void> {
  const optOrgCols = await getOptionalOrgColumns();
  const ownedOrgs = await sql<{ id: string }[]>`
    SELECT id FROM organizations WHERE owner_user_id = ${deadUserId}
  `;

  // Emptiness-Guard VOR der Transaktion (rein lesend, keine Mutation).
  for (const org of ownedOrgs) {
    const [c] = await sql<
      { invoices: number; mailAccounts: number; orgVendors: number }[]
    >`
      SELECT
        (SELECT COUNT(*) FROM invoices WHERE organization_id = ${org.id})      AS "invoices",
        (SELECT COUNT(*) FROM mail_accounts WHERE organization_id = ${org.id}) AS "mailAccounts",
        (SELECT COUNT(*) FROM vendors WHERE organization_id = ${org.id})       AS "orgVendors"
    `;
    if (c.invoices > 0 || c.mailAccounts > 0 || c.orgVendors > 0) {
      throw new NonEmptyOrgPurgeRefused(org.id, {
        invoices: c.invoices,
        mailAccounts: c.mailAccounts,
        orgVendors: c.orgVendors,
      });
    }
  }

  await sql.begin(async (tx) => {
    for (const org of ownedOrgs) {
      await hardDeleteOrgData(tx, org.id, optOrgCols);
    }
    await tx`DELETE FROM org_members WHERE user_id = ${deadUserId}`;
    await tx`DELETE FROM users WHERE id = ${deadUserId}`;
  });
}
