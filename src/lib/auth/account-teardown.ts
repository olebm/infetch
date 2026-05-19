import { sql } from "@/lib/db/client";
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
        'discovered_senders', 'integration_targets', 'auto_approval_rules'
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

  // ── Invoice-Subgraph ───────────────────────────────────────────────────
  await tx`
    UPDATE portal_runs SET downloaded_invoice_id = NULL
    WHERE downloaded_invoice_id IN (
      SELECT id FROM invoices WHERE organization_id = ${oid}
    )
  `;
  await tx`
    DELETE FROM ai_extractions WHERE invoice_id IN (
      SELECT id FROM invoices WHERE organization_id = ${oid}
    )
  `;
  await tx`
    DELETE FROM exports
    WHERE organization_id = ${oid}
       OR invoice_id IN (
         SELECT id FROM invoices WHERE organization_id = ${oid}
       )
  `;
  await tx`
    DELETE FROM sync_events WHERE invoice_id IN (
      SELECT id FROM invoices WHERE organization_id = ${oid}
    )
  `;
  await tx`
    DELETE FROM vendor_month_status WHERE invoice_id IN (
      SELECT id FROM invoices WHERE organization_id = ${oid}
    )
  `;
  if (hasOrgCol("vendor_month_status")) {
    await tx`DELETE FROM vendor_month_status WHERE organization_id = ${oid}`;
  }
  await tx`
    DELETE FROM invoice_files WHERE invoice_id IN (
      SELECT id FROM invoices WHERE organization_id = ${oid}
    )
  `;
  if (hasOrgCol("invoice_files")) {
    await tx`DELETE FROM invoice_files WHERE organization_id = ${oid}`;
  }
  await tx`
    UPDATE invoices SET duplicate_of_invoice_id = NULL
    WHERE organization_id = ${oid} AND duplicate_of_invoice_id IS NOT NULL
  `;
  await tx`DELETE FROM invoices WHERE organization_id = ${oid}`;

  // ── Mail & Credentials (Basisschema-Spalten, immer vorhanden) ──────────
  await tx`
    DELETE FROM mail_messages WHERE mail_account_id IN (
      SELECT id FROM mail_accounts WHERE organization_id = ${oid}
    )
  `;
  await tx`DELETE FROM mail_accounts WHERE organization_id = ${oid}`;
  await tx`DELETE FROM credential_refs WHERE organization_id = ${oid}`;

  // ── Org-scoped Misc (0001-Spalten: immer vorhanden) ────────────────────
  await tx`DELETE FROM usage_events WHERE organization_id = ${oid}`;
  await tx`DELETE FROM mail_inbound_addresses WHERE organization_id = ${oid}`;

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
  await tx`
    UPDATE discovered_senders SET matched_vendor_id = NULL
    WHERE matched_vendor_id IN (
      SELECT id FROM vendors WHERE organization_id = ${oid}
    )
  `;
  await tx`
    DELETE FROM vendor_aliases WHERE vendor_id IN (
      SELECT id FROM vendors WHERE organization_id = ${oid}
    )
  `;
  await tx`
    DELETE FROM portal_sessions WHERE vendor_id IN (
      SELECT id FROM vendors WHERE organization_id = ${oid}
    )
  `;
  await tx`
    DELETE FROM portal_runs WHERE vendor_id IN (
      SELECT id FROM vendors WHERE organization_id = ${oid}
    )
  `;
  await tx`
    DELETE FROM vendor_month_status WHERE vendor_id IN (
      SELECT id FROM vendors WHERE organization_id = ${oid}
    )
  `;
  await tx`
    DELETE FROM sync_events WHERE vendor_id IN (
      SELECT id FROM vendors WHERE organization_id = ${oid}
    )
  `;
  await tx`
    DELETE FROM auto_approval_rules WHERE vendor_id IN (
      SELECT id FROM vendors WHERE organization_id = ${oid}
    )
  `;
  if (hasOrgCol("auto_approval_rules")) {
    await tx`DELETE FROM auto_approval_rules WHERE organization_id = ${oid}`;
  }
  await tx`DELETE FROM vendors WHERE organization_id = ${oid}`;

  // ── Org selbst ─────────────────────────────────────────────────────────
  await tx`DELETE FROM organizations WHERE id = ${oid}`;
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
