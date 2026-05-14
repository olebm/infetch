import type Database from "better-sqlite3";
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

export function recordSenderObservation(
  db: Database.Database,
  observation: SenderObservation,
): { id: number; blocked: boolean } {
  const fromAddress = normalizeAddress(observation.fromAddress);
  if (!fromAddress) {
    throw new Error("recordSenderObservation requires a non-empty fromAddress.");
  }
  const fromDomain = extractDomain(fromAddress);
  const displayName = observation.displayName?.trim() || null;
  const pdfDelta = observation.hadPdfAttachments ? 1 : 0;
  const importedDelta = Math.max(0, observation.pdfsImported);
  const blockedDelta = observation.blockedSkip ? 1 : 0;

  db.prepare(
    `INSERT INTO discovered_senders (
      from_address, from_domain, display_name,
      mail_count, pdf_count, imported_count, blocked_count
    )
    VALUES (?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(from_address) DO UPDATE SET
      mail_count = mail_count + 1,
      pdf_count = pdf_count + excluded.pdf_count,
      imported_count = imported_count + excluded.imported_count,
      blocked_count = blocked_count + excluded.blocked_count,
      display_name = COALESCE(NULLIF(excluded.display_name, ''), discovered_senders.display_name),
      last_seen_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP`,
  ).run(fromAddress, fromDomain, displayName, pdfDelta, importedDelta, blockedDelta);

  const row = db
    .prepare(`SELECT id, blocked FROM discovered_senders WHERE from_address = ?`)
    .get(fromAddress) as { id: number; blocked: number };
  return { id: row.id, blocked: row.blocked === 1 };
}

export function isSenderBlocked(db: Database.Database, fromAddress: string | null | undefined): boolean {
  const normalized = normalizeAddress(fromAddress);
  if (!normalized) return false;
  const row = db
    .prepare(`SELECT blocked FROM discovered_senders WHERE from_address = ?`)
    .get(normalized) as { blocked: number } | undefined;
  return row?.blocked === 1;
}

/**
 * Auto-Ignore-Heuristik: wenn die letzten N PDFs eines Senders alle als
 * 'ignored' markiert wurden UND der Sender in 90 Tagen keine erfolgreiche
 * Rechnung mehr geliefert hat → künftige PDFs überspringen (spart Mistral-Calls).
 *
 * Schutz vor False-Positive: sobald wieder eine echte Rechnung durchgeht,
 * fällt der Sender aus der Auto-Ignore-Logik raus.
 */
export function isSenderAutoIgnored(
  db: Database.Database,
  fromAddress: string | null | undefined,
  options: { minIgnoredStreak?: number; lookbackDays?: number } = {},
): boolean {
  const normalized = normalizeAddress(fromAddress);
  if (!normalized) return false;
  const streak = Math.max(2, options.minIgnoredStreak ?? 3);
  const lookbackDays = Math.max(7, options.lookbackDays ?? 90);

  // Schritt 1: gibt es im Lookback erfolgreiche Imports? Dann kein Skip.
  const hasSuccess = db
    .prepare(
      `SELECT 1 FROM invoices i
       JOIN invoice_files f ON f.invoice_id = i.id
       JOIN mail_messages m ON m.id = CAST(f.source_ref_id AS INTEGER)
       WHERE m.from_address = ?
         AND f.source_type = 'mail'
         AND i.status IN ('ready', 'exported')
         AND i.created_at >= datetime('now', ? || ' days')
       LIMIT 1`,
    )
    .get(normalized, `-${lookbackDays}`) as { 1: number } | undefined;
  if (hasSuccess) return false;

  // Schritt 2: sind die letzten N Imports alle 'ignored'?
  const recent = db
    .prepare(
      `SELECT i.status FROM invoices i
       JOIN invoice_files f ON f.invoice_id = i.id
       JOIN mail_messages m ON m.id = CAST(f.source_ref_id AS INTEGER)
       WHERE m.from_address = ?
         AND f.source_type = 'mail'
       ORDER BY i.created_at DESC
       LIMIT ?`,
    )
    .all(normalized, streak) as Array<{ status: string }>;

  if (recent.length < streak) return false;
  return recent.every((r) => r.status === "ignored");
}

export function listDiscoveredSenders(db: Database.Database): DiscoveredSender[] {
  const rows = db
    .prepare(
      `SELECT
        ds.id,
        ds.from_address AS fromAddress,
        ds.from_domain AS fromDomain,
        ds.display_name AS displayName,
        ds.mail_count AS mailCount,
        ds.pdf_count AS pdfCount,
        ds.imported_count AS importedCount,
        ds.blocked_count AS blockedCount,
        ds.matched_vendor_id AS matchedVendorId,
        ds.blocked,
        ds.blocked_reason AS blockedReason,
        ds.blocked_at AS blockedAt,
        ds.first_seen_at AS firstSeenAt,
        ds.last_seen_at AS lastSeenAt,
        vendors.name AS matchedVendorName
       FROM discovered_senders ds
       LEFT JOIN vendors ON vendors.id = ds.matched_vendor_id
       WHERE ds.pdf_count > 0
       ORDER BY ds.pdf_count DESC, ds.mail_count DESC, ds.last_seen_at DESC`,
    )
    .all() as Array<Omit<DiscoveredSender, "blocked"> & { blocked: number }>;
  return rows.map((row) => ({ ...row, blocked: row.blocked === 1 }));
}

export function blockSender(db: Database.Database, senderId: number, reason: string | null): void {
  db.prepare(
    `UPDATE discovered_senders
     SET blocked = 1, blocked_reason = ?, blocked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(reason || null, senderId);
}

export function unblockSender(db: Database.Database, senderId: number): void {
  db.prepare(
    `UPDATE discovered_senders
     SET blocked = 0, blocked_reason = NULL, blocked_at = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(senderId);
}

export function linkSenderToVendor(
  db: Database.Database,
  senderId: number,
  vendorId: number | null,
): void {
  db.prepare(
    `UPDATE discovered_senders
     SET matched_vendor_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(vendorId, senderId);
}

export type BackfillResult = {
  scanned: number;
  upserts: number;
  withPdfs: number;
};

export function backfillFromMailMessages(db: Database.Database): BackfillResult {
  const summary = db
    .prepare(
      `SELECT
        LOWER(mm.from_address) AS fromAddress,
        COUNT(*) AS mailCount,
        SUM(CASE WHEN mm.status NOT IN ('no_pdf', 'pending') THEN 1 ELSE 0 END) AS pdfCount,
        SUM(CASE WHEN mm.status = 'processed' THEN 1 ELSE 0 END) AS importedCount,
        MIN(COALESCE(mm.date, mm.seen_at, CURRENT_TIMESTAMP)) AS firstSeen,
        MAX(COALESCE(mm.date, mm.seen_at, CURRENT_TIMESTAMP)) AS lastSeen
       FROM mail_messages mm
       WHERE mm.from_address IS NOT NULL AND mm.from_address != ''
       GROUP BY LOWER(mm.from_address)
       HAVING pdfCount > 0`,
    )
    .all() as Array<{
      fromAddress: string;
      mailCount: number;
      pdfCount: number;
      importedCount: number;
      firstSeen: string;
      lastSeen: string;
    }>;

  let upserts = 0;
  let withPdfs = 0;
  const upsert = db.prepare(
    `INSERT INTO discovered_senders (
      from_address, from_domain, display_name,
      mail_count, pdf_count, imported_count, blocked_count,
      first_seen_at, last_seen_at
    )
    VALUES (?, ?, NULL, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(from_address) DO UPDATE SET
      mail_count = MAX(discovered_senders.mail_count, excluded.mail_count),
      pdf_count = MAX(discovered_senders.pdf_count, excluded.pdf_count),
      imported_count = MAX(discovered_senders.imported_count, excluded.imported_count),
      first_seen_at = MIN(discovered_senders.first_seen_at, excluded.first_seen_at),
      last_seen_at = MAX(discovered_senders.last_seen_at, excluded.last_seen_at),
      updated_at = CURRENT_TIMESTAMP`,
  );

  const tx = db.transaction((rows: typeof summary) => {
    for (const row of rows) {
      const address = row.fromAddress.trim();
      if (!address) continue;
      upsert.run(
        address,
        extractDomain(address),
        row.mailCount,
        row.pdfCount,
        row.importedCount,
        row.firstSeen,
        row.lastSeen,
      );
      upserts += 1;
      if (row.pdfCount > 0) withPdfs += 1;
    }
  });
  tx(summary);

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

export function autoAssignSenders(db: Database.Database): AutoAssignResult {
  const unmatched = db
    .prepare(
      `SELECT id, from_address AS fromAddress, from_domain AS fromDomain,
        display_name AS displayName, pdf_count AS pdfCount
       FROM discovered_senders
       WHERE matched_vendor_id IS NULL AND blocked = 0`,
    )
    .all() as Array<{ id: number; fromAddress: string; fromDomain: string; displayName: string | null; pdfCount: number }>;

  let matched = 0;
  let created = 0;
  let skipped = 0;

  const linkSender = db.prepare(
    `UPDATE discovered_senders SET matched_vendor_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  );
  const insertAlias = db.prepare(
    `INSERT OR IGNORE INTO vendor_aliases (vendor_id, alias, match_type, priority) VALUES (?, ?, ?, ?)`,
  );
  const createVendorStmt = db.prepare(
    `INSERT INTO vendors (name, canonical_key, category, portal_enabled, mail_enabled, manual_enabled)
     VALUES (?, ?, 'service', 0, 1, 1)`,
  );
  const getVendorByKey = db.prepare(`SELECT id FROM vendors WHERE canonical_key = ?`);

  const tx = db.transaction((senders: typeof unmatched) => {
    for (const sender of senders) {
      const signals = [sender.fromAddress, sender.fromDomain, sender.displayName || ""].filter(Boolean);
      const match = matchVendor(db, signals);

      if (match.vendorId && match.confidence >= 0.7) {
        linkSender.run(match.vendorId, sender.id);
        insertAlias.run(match.vendorId, sender.fromDomain, "domain", 50);
        insertAlias.run(match.vendorId, sender.fromAddress, "exact", 30);
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

      let key = baseKey;
      let suffix = 2;
      while (getVendorByKey.get(key)) {
        key = `${baseKey}-${suffix++}`;
      }

      createVendorStmt.run(name, key);
      const row = getVendorByKey.get(key) as { id: number } | undefined;
      if (!row) {
        skipped++;
        continue;
      }

      insertAlias.run(row.id, sender.fromDomain, "domain", 50);
      insertAlias.run(row.id, sender.fromAddress, "exact", 30);
      linkSender.run(row.id, sender.id);
      created++;
    }
  });

  tx(unmatched);
  return { scanned: unmatched.length, matched, created, skipped };
}
