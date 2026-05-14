import type Database from "better-sqlite3";

/**
 * Auto-Alias-Lernen: Wenn der User manuell einem unbekannten Lieferanten
 * einen Vendor zuordnet, speichern wir die Sender-Domain als Domain-Alias
 * — damit künftige Mails vom selben Sender automatisch matchen.
 *
 * Das ist die Anti-Cold-Start-Schleife:
 *   Manuelle Zuordnung 1× → Auto-Match alle folgenden
 */

function extractEmailDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  // Akzeptiert auch "Name <user@domain>"-Form
  const match = value.match(/<?\s*([\w.+-]+)@([\w.-]+)\s*>?/);
  if (!match) return null;
  return match[2].toLowerCase();
}

function getSenderFromInvoice(
  db: Database.Database,
  invoiceId: number,
): { fromAddress: string | null; mailMessageId: number | null } {
  // invoice → invoice_files (source_type='mail') → mail_messages.from_address
  const row = db
    .prepare(
      `SELECT mm.from_address AS fromAddress, mm.id AS mailMessageId
       FROM invoice_files inf
       LEFT JOIN mail_messages mm ON CAST(mm.id AS TEXT) = inf.source_ref_id
       WHERE inf.invoice_id = ?
         AND inf.source_type = 'mail'
       ORDER BY inf.created_at DESC
       LIMIT 1`,
    )
    .get(invoiceId) as { fromAddress: string | null; mailMessageId: number | null } | undefined;
  return row ?? { fromAddress: null, mailMessageId: null };
}

export type AutoAliasResult = {
  learned: boolean;
  reason?: string;
  domain?: string;
  senderEmail?: string;
};

/**
 * Lerne aus einer manuellen Vendor-Zuordnung.
 * Wird vom Review-Action aufgerufen, nachdem der User einen Vendor gewaehlt hat.
 *
 * Effekt:
 *   1. Wenn die Sender-Domain noch kein Domain-Alias fuer DIESEN vendor ist
 *      → Alias hinzufuegen
 *   2. discovered_senders.matched_vendor_id auf den neuen Vendor setzen
 *      (falls vorhanden)
 */
export function learnFromManualMatch(
  db: Database.Database,
  input: { invoiceId: number; vendorId: number },
): AutoAliasResult {
  const sender = getSenderFromInvoice(db, input.invoiceId);
  const senderEmail = sender.fromAddress;
  if (!senderEmail) {
    return { learned: false, reason: "no_sender" };
  }

  const domain = extractEmailDomain(senderEmail);
  if (!domain) {
    return { learned: false, reason: "invalid_sender_email" };
  }

  // Blacklist: generische E-Mail-Provider-Domains nicht als Vendor-Alias speichern
  const GENERIC_DOMAINS = new Set([
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "yahoo.com",
    "yahoo.de",
    "icloud.com",
    "me.com",
    "gmx.de",
    "gmx.net",
    "gmx.at",
    "web.de",
    "t-online.de",
    "freenet.de",
    "aol.com",
    "live.com",
    "msn.com",
    "mail.com",
    "mail.de",
    "posteo.de",
    "mailbox.org",
    "fastmail.com",
    "proton.me",
    "protonmail.com",
  ]);
  if (GENERIC_DOMAINS.has(domain)) {
    return { learned: false, reason: "generic_email_provider", domain, senderEmail };
  }

  const existing = db
    .prepare(
      `SELECT id, vendor_id AS vendorId
       FROM vendor_aliases
       WHERE alias = ? AND match_type = 'domain'`,
    )
    .get(domain) as { id: number; vendorId: number } | undefined;

  const tx = db.transaction(() => {
    if (!existing) {
      // Neuer Domain-Alias fuer diesen Vendor
      db.prepare(
        `INSERT OR IGNORE INTO vendor_aliases (vendor_id, alias, match_type, priority)
         VALUES (?, ?, 'domain', 50)`,
      ).run(input.vendorId, domain);
    } else if (existing.vendorId !== input.vendorId) {
      // Domain war bisher anderem Vendor zugeordnet — User korrigiert -> auf neuen Vendor umstellen
      db.prepare(
        `UPDATE vendor_aliases
         SET vendor_id = ?, priority = 50
         WHERE id = ?`,
      ).run(input.vendorId, existing.id);
    }

    // discovered_senders.matched_vendor_id aktualisieren (falls Eintrag existiert)
    db.prepare(
      `UPDATE discovered_senders
       SET matched_vendor_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE from_address = ?`,
    ).run(input.vendorId, senderEmail.toLowerCase());
  });
  tx();

  return {
    learned: true,
    domain,
    senderEmail,
  };
}

/**
 * Re-Match alle Invoices ohne (oder mit niedrig-konfidentem) Vendor.
 * Wird ueber den "Bestehende Rechnungen neu matchen"-Button im Senders-Tab
 * aufgerufen. Nutzt den existierenden vendor-Matcher.
 */
export type RematchSummary = {
  scanned: number;
  matched: number;
  unchanged: number;
};

export function rematchUnmatchedInvoices(
  db: Database.Database,
  matchVendor: (db: Database.Database, signals: string[]) => {
    vendorId: number | null;
    canonicalKey: string | null;
    confidence: number;
  },
): RematchSummary {
  // Kandidaten: Rechnungen ohne vendor_id ODER mit niedrigem Confidence-Score
  const candidates = db
    .prepare(
      `SELECT i.id AS id, i.vendor_id AS vendorId,
              (SELECT inf.original_filename FROM invoice_files inf
               WHERE inf.invoice_id = i.id ORDER BY inf.created_at DESC LIMIT 1) AS filename,
              (SELECT mm.from_address FROM invoice_files inf
               LEFT JOIN mail_messages mm ON CAST(mm.id AS TEXT) = inf.source_ref_id
               WHERE inf.invoice_id = i.id AND inf.source_type = 'mail'
               ORDER BY inf.created_at DESC LIMIT 1) AS fromAddress,
              i.raw_text_path AS rawTextPath
       FROM invoices i
       WHERE i.vendor_id IS NULL OR i.confidence < 0.7`,
    )
    .all() as Array<{
    id: number;
    vendorId: number | null;
    filename: string | null;
    fromAddress: string | null;
    rawTextPath: string | null;
  }>;

  let matched = 0;
  let unchanged = 0;

  for (const candidate of candidates) {
    const signals = [candidate.filename, candidate.fromAddress].filter(Boolean) as string[];
    if (signals.length === 0) {
      unchanged += 1;
      continue;
    }

    const result = matchVendor(db, signals);
    if (result.vendorId && result.vendorId !== candidate.vendorId) {
      db.prepare(
        `UPDATE invoices
         SET vendor_id = ?, confidence = MAX(confidence, ?), updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(result.vendorId, result.confidence, candidate.id);
      matched += 1;
    } else {
      unchanged += 1;
    }
  }

  return {
    scanned: candidates.length,
    matched,
    unchanged,
  };
}
