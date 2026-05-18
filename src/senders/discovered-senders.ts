import { sql } from "@/lib/db/client";
import { matchVendor } from "@/vendors/matcher";

export type DiscoveredSender = {
  id: number;
  fromAddress: string;
  fromDomain: string;
  displayName: string | null;
  mailCount: number;
  pdfCount: number;
  importedCount: number;
  blockedCount: number;
  matchedVendorId: number | null;
  matchedVendorName: string | null;
  blocked: boolean;
  blockedReason: string | null;
  blockedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type SenderObservation = {
  organizationId: string | null;
  fromAddress: string;
  displayName?: string | null;
  hadPdfAttachments: boolean;
  pdfsImported: number;
  blockedSkip?: boolean;
};

export function normalizeAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

export function extractDomain(address: string): string {
  const at = address.lastIndexOf("@");
  return at >= 0 ? address.slice(at + 1) : "";
}

export async function recordSenderObservation(
  observation: SenderObservation,
): Promise<{ id: number; blocked: boolean }> {
  const fromAddress = normalizeAddress(observation.fromAddress);
  if (!fromAddress) {
    throw new Error("recordSenderObservation requires a non-empty fromAddress.");
  }
  const fromDomain = extractDomain(fromAddress);
  const displayName = observation.displayName?.trim() || null;
  const pdfDelta = observation.hadPdfAttachments ? 1 : 0;
  const importedDelta = Math.max(0, observation.pdfsImported);
  const blockedDelta = observation.blockedSkip ? 1 : 0;

  await sql`
    INSERT INTO discovered_senders (
      organization_id, from_address, from_domain, display_name,
      mail_count, pdf_count, imported_count, blocked_count
    )
    VALUES (${observation.organizationId}, ${fromAddress}, ${fromDomain}, ${displayName}, 1, ${pdfDelta}, ${importedDelta}, ${blockedDelta})
    ON CONFLICT(organization_id, from_address) DO UPDATE SET
      mail_count = discovered_senders.mail_count + 1,
      pdf_count = discovered_senders.pdf_count + excluded.pdf_count,
      imported_count = discovered_senders.imported_count + excluded.imported_count,
      blocked_count = discovered_senders.blocked_count + excluded.blocked_count,
      display_name = COALESCE(NULLIF(excluded.display_name, ''), discovered_senders.display_name),
      last_seen_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `;

  const rows = await sql<{ id: number; blocked: boolean }[]>`
    SELECT id, blocked FROM discovered_senders
    WHERE from_address = ${fromAddress}
      AND organization_id IS NOT DISTINCT FROM ${observation.organizationId}
  `;
  const row = rows[0];
  return { id: row.id, blocked: Boolean(row.blocked) };
}

export async function isSenderBlocked(
  fromAddress: string | null | undefined,
  organizationId: string | null,
): Promise<boolean> {
  const normalized = normalizeAddress(fromAddress);
  if (!normalized) return false;
  const rows = await sql<{ blocked: boolean }[]>`
    SELECT blocked FROM discovered_senders
    WHERE from_address = ${normalized}
      AND organization_id IS NOT DISTINCT FROM ${organizationId}
  `;
  return Boolean(rows[0]?.blocked);
}

/**
 * Auto-Ignore-Heuristik: wenn die letzten N PDFs eines Senders alle als
 * 'ignored' markiert wurden UND der Sender in 90 Tagen keine erfolgreiche
 * Rechnung mehr geliefert hat → künftige PDFs überspringen (spart Mistral-Calls).
 *
 * Schutz vor False-Positive: sobald wieder eine echte Rechnung durchgeht,
 * fällt der Sender aus der Auto-Ignore-Logik raus.
 */
export async function isSenderAutoIgnored(
  fromAddress: string | null | undefined,
  organizationId: string | null,
  options: { minIgnoredStreak?: number; lookbackDays?: number } = {},
): Promise<boolean> {
  const normalized = normalizeAddress(fromAddress);
  if (!normalized) return false;
  const streak = Math.max(2, options.minIgnoredStreak ?? 3);
  const lookbackDays = Math.max(7, options.lookbackDays ?? 90);

  // Schritt 1: gibt es im Lookback erfolgreiche Imports? Dann kein Skip.
  const hasSuccess = await sql`
    SELECT 1 FROM invoices i
    JOIN invoice_files f ON f.invoice_id = i.id
    JOIN mail_messages m ON m.id = CAST(f.source_ref_id AS INTEGER)
    WHERE m.from_address = ${normalized}
      AND f.source_type = 'mail'
      AND i.status IN ('ready', 'exported')
      AND i.organization_id IS NOT DISTINCT FROM ${organizationId}
      AND i.created_at::TIMESTAMPTZ >= NOW() - (${lookbackDays} || ' days')::INTERVAL
    LIMIT 1
  `;
  if (hasSuccess.length > 0) return false;

  // Schritt 2: sind die letzten N Imports alle 'ignored'?
  const recent = await sql<Array<{ status: string }>>`
    SELECT i.status FROM invoices i
    JOIN invoice_files f ON f.invoice_id = i.id
    JOIN mail_messages m ON m.id = CAST(f.source_ref_id AS INTEGER)
    WHERE m.from_address = ${normalized}
      AND f.source_type = 'mail'
      AND i.organization_id IS NOT DISTINCT FROM ${organizationId}
    ORDER BY i.created_at DESC
    LIMIT ${streak}
  `;

  if (recent.length < streak) return false;
  return recent.every((r) => r.status === "ignored");
}

export async function listDiscoveredSenders(
  organizationId: string | null,
): Promise<DiscoveredSender[]> {
  const rows = await sql<Array<Omit<DiscoveredSender, "blocked"> & { blocked: boolean }>>`
    SELECT
      ds.id,
      ds.from_address AS "fromAddress",
      ds.from_domain AS "fromDomain",
      ds.display_name AS "displayName",
      ds.mail_count AS "mailCount",
      ds.pdf_count AS "pdfCount",
      ds.imported_count AS "importedCount",
      ds.blocked_count AS "blockedCount",
      ds.matched_vendor_id AS "matchedVendorId",
      ds.blocked,
      ds.blocked_reason AS "blockedReason",
      ds.blocked_at AS "blockedAt",
      ds.first_seen_at AS "firstSeenAt",
      ds.last_seen_at AS "lastSeenAt",
      vendors.name AS "matchedVendorName"
    FROM discovered_senders ds
    LEFT JOIN vendors ON vendors.id = ds.matched_vendor_id
    WHERE ds.pdf_count > 0
      AND ds.organization_id IS NOT DISTINCT FROM ${organizationId}
    ORDER BY ds.pdf_count DESC, ds.mail_count DESC, ds.last_seen_at DESC
  `;
  return rows.map((row) => ({ ...row, blocked: Boolean(row.blocked) }));
}

export async function blockSender(
  senderId: number,
  reason: string | null,
  organizationId: string | null,
): Promise<void> {
  await sql`
    UPDATE discovered_senders
    SET blocked = TRUE, blocked_reason = ${reason || null}, blocked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${senderId}
      AND organization_id IS NOT DISTINCT FROM ${organizationId}
  `;
}

export async function unblockSender(
  senderId: number,
  organizationId: string | null,
): Promise<void> {
  await sql`
    UPDATE discovered_senders
    SET blocked = FALSE, blocked_reason = NULL, blocked_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${senderId}
      AND organization_id IS NOT DISTINCT FROM ${organizationId}
  `;
}

export async function linkSenderToVendor(
  senderId: number,
  vendorId: number | null,
  organizationId: string | null,
): Promise<void> {
  await sql`
    UPDATE discovered_senders
    SET matched_vendor_id = ${vendorId}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${senderId}
      AND organization_id IS NOT DISTINCT FROM ${organizationId}
  `;
}

export type BackfillResult = {
  scanned: number;
  upserts: number;
  withPdfs: number;
};

export async function backfillFromMailMessages(): Promise<BackfillResult> {
  // Pro Org gruppieren — Org via mail_account herleiten.
  const summary = await sql<Array<{
    organizationId: string | null;
    fromAddress: string;
    mailCount: string;
    pdfCount: string;
    importedCount: string;
    firstSeen: string;
    lastSeen: string;
  }>>`
    SELECT
      ma.organization_id AS "organizationId",
      LOWER(mm.from_address) AS "fromAddress",
      COUNT(*) AS "mailCount",
      SUM(CASE WHEN mm.status NOT IN ('no_pdf', 'pending') THEN 1 ELSE 0 END) AS "pdfCount",
      SUM(CASE WHEN mm.status = 'processed' THEN 1 ELSE 0 END) AS "importedCount",
      MIN(COALESCE(mm.date, mm.seen_at, CURRENT_TIMESTAMP::TEXT)) AS "firstSeen",
      MAX(COALESCE(mm.date, mm.seen_at, CURRENT_TIMESTAMP::TEXT)) AS "lastSeen"
    FROM mail_messages mm
    JOIN mail_accounts ma ON ma.id = mm.mail_account_id
    WHERE mm.from_address IS NOT NULL AND mm.from_address != ''
    GROUP BY ma.organization_id, LOWER(mm.from_address)
    HAVING SUM(CASE WHEN mm.status NOT IN ('no_pdf', 'pending') THEN 1 ELSE 0 END) > 0
  `;

  let upserts = 0;
  let withPdfs = 0;

  for (const row of summary) {
    const address = row.fromAddress.trim();
    if (!address) continue;
    const mailCount = Number(row.mailCount);
    const pdfCount = Number(row.pdfCount);
    const importedCount = Number(row.importedCount);

    await sql`
      INSERT INTO discovered_senders (
        organization_id, from_address, from_domain, display_name,
        mail_count, pdf_count, imported_count, blocked_count,
        first_seen_at, last_seen_at
      )
      VALUES (${row.organizationId}, ${address}, ${extractDomain(address)}, NULL, ${mailCount}, ${pdfCount}, ${importedCount}, 0, ${row.firstSeen}, ${row.lastSeen})
      ON CONFLICT(organization_id, from_address) DO UPDATE SET
        mail_count = GREATEST(discovered_senders.mail_count, excluded.mail_count),
        pdf_count = GREATEST(discovered_senders.pdf_count, excluded.pdf_count),
        imported_count = GREATEST(discovered_senders.imported_count, excluded.imported_count),
        first_seen_at = LEAST(discovered_senders.first_seen_at, excluded.first_seen_at),
        last_seen_at = GREATEST(discovered_senders.last_seen_at, excluded.last_seen_at),
        updated_at = CURRENT_TIMESTAMP
    `;
    upserts += 1;
    if (pdfCount > 0) withPdfs += 1;
  }

  return { scanned: summary.length, upserts, withPdfs };
}

export type AutoAssignResult = {
  scanned: number;
  matched: number;
  created: number;
  skipped: number;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function nameFromDomain(domain: string): string {
  const parts = domain.split(".");
  const base = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export async function autoAssignSenders(): Promise<AutoAssignResult> {
  const unmatched = await sql<Array<{
    id: number;
    organizationId: string | null;
    fromAddress: string;
    fromDomain: string;
    displayName: string | null;
    pdfCount: number;
  }>>`
    SELECT id, organization_id AS "organizationId", from_address AS "fromAddress",
      from_domain AS "fromDomain", display_name AS "displayName", pdf_count AS "pdfCount"
    FROM discovered_senders
    WHERE matched_vendor_id IS NULL AND blocked = FALSE
  `;

  let matched = 0;
  let created = 0;
  let skipped = 0;

  for (const sender of unmatched) {
    const signals = [sender.fromAddress, sender.fromDomain, sender.displayName || ""].filter(Boolean);
    const match = await matchVendor(signals);

    if (match.vendorId && match.confidence >= 0.7) {
      await sql`
        UPDATE discovered_senders SET matched_vendor_id = ${match.vendorId}, updated_at = CURRENT_TIMESTAMP WHERE id = ${sender.id}
      `;
      await sql`
        INSERT INTO vendor_aliases (vendor_id, alias, match_type, priority)
        VALUES (${match.vendorId}, ${sender.fromDomain}, 'domain', 50)
        ON CONFLICT DO NOTHING
      `;
      await sql`
        INSERT INTO vendor_aliases (vendor_id, alias, match_type, priority)
        VALUES (${match.vendorId}, ${sender.fromAddress}, 'exact', 30)
        ON CONFLICT DO NOTHING
      `;
      matched++;
      continue;
    }

    if (sender.pdfCount === 0) {
      skipped++;
      continue;
    }

    const rawName = (sender.displayName?.trim() || nameFromDomain(sender.fromDomain)).trim();
    const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const baseKey = slugify(name) || slugify(sender.fromDomain) || `vendor-${sender.id}`;

    // Find unique key
    let key = baseKey;
    let suffix = 2;
    while (true) {
      const existing = await sql`SELECT 1 FROM vendors WHERE canonical_key = ${key} LIMIT 1`;
      if (existing.length === 0) break;
      key = `${baseKey}-${suffix++}`;
    }

    const inserted = await sql<{ id: number }[]>`
      INSERT INTO vendors (organization_id, name, canonical_key, category, portal_enabled, mail_enabled, manual_enabled)
      VALUES (${sender.organizationId}, ${name}, ${key}, 'service', FALSE, TRUE, TRUE)
      RETURNING id
    `;
    const newVendorRow = inserted[0];
    if (!newVendorRow) {
      skipped++;
      continue;
    }

    await sql`
      INSERT INTO vendor_aliases (vendor_id, alias, match_type, priority)
      VALUES (${newVendorRow.id}, ${sender.fromDomain}, 'domain', 50)
      ON CONFLICT DO NOTHING
    `;
    await sql`
      INSERT INTO vendor_aliases (vendor_id, alias, match_type, priority)
      VALUES (${newVendorRow.id}, ${sender.fromAddress}, 'exact', 30)
      ON CONFLICT DO NOTHING
    `;
    await sql`
      UPDATE discovered_senders SET matched_vendor_id = ${newVendorRow.id}, updated_at = CURRENT_TIMESTAMP WHERE id = ${sender.id}
    `;
    created++;
  }

  return { scanned: unmatched.length, matched, created, skipped };
}
