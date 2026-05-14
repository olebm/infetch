import { sql } from "@/lib/db/client";

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

async function getSenderFromInvoice(
  invoiceId: number,
): Promise<{ fromAddress: string | null; mailMessageId: number | null }> {
  // invoice → invoice_files (source_type='mail') → mail_messages.from_address
  const rows = await sql<{ fromAddress: string | null; mailMessageId: number | null }[]>`
    SELECT mm.from_address AS "fromAddress", mm.id AS "mailMessageId"
    FROM invoice_files inf
    LEFT JOIN mail_messages mm ON CAST(mm.id AS TEXT) = inf.source_ref_id
    WHERE inf.invoice_id = ${invoiceId}
      AND inf.source_type = 'mail'
    ORDER BY inf.created_at DESC
    LIMIT 1
  `;
  return rows[0] ?? { fromAddress: null, mailMessageId: null };
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
export async function learnFromManualMatch(
  input: { invoiceId: number; vendorId: number },
): Promise<AutoAliasResult> {
  const sender = await getSenderFromInvoice(input.invoiceId);
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

  const existing = await sql<{ id: number; vendorId: number }[]>`
    SELECT id, vendor_id AS "vendorId"
    FROM vendor_aliases
    WHERE alias = ${domain} AND match_type = 'domain'
    LIMIT 1
  `;
  const existingRow = existing[0];

  if (!existingRow) {
    // Neuer Domain-Alias fuer diesen Vendor
    await sql`
      INSERT INTO vendor_aliases (vendor_id, alias, match_type, priority)
      VALUES (${input.vendorId}, ${domain}, 'domain', 50)
      ON CONFLICT DO NOTHING
    `;
  } else if (existingRow.vendorId !== input.vendorId) {
    // Domain war bisher anderem Vendor zugeordnet — User korrigiert -> auf neuen Vendor umstellen
    await sql`
      UPDATE vendor_aliases
      SET vendor_id = ${input.vendorId}, priority = 50
      WHERE id = ${existingRow.id}
    `;
  }

  // discovered_senders.matched_vendor_id aktualisieren (falls Eintrag existiert)
  await sql`
    UPDATE discovered_senders
    SET matched_vendor_id = ${input.vendorId}, updated_at = CURRENT_TIMESTAMP
    WHERE from_address = ${senderEmail.toLowerCase()}
  `;

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

export async function rematchUnmatchedInvoices(
  matchVendor: (signals: string[]) => Promise<{
    vendorId: number | null;
    canonicalKey: string | null;
    confidence: number;
  }>,
): Promise<RematchSummary> {
  // Kandidaten: Rechnungen ohne vendor_id ODER mit niedrigem Confidence-Score
  const candidates = await sql<Array<{
    id: number;
    vendorId: number | null;
    filename: string | null;
    fromAddress: string | null;
    rawTextPath: string | null;
  }>>`
    SELECT i.id AS id, i.vendor_id AS "vendorId",
           (SELECT inf.original_filename FROM invoice_files inf
            WHERE inf.invoice_id = i.id ORDER BY inf.created_at DESC LIMIT 1) AS filename,
           (SELECT mm.from_address FROM invoice_files inf
            LEFT JOIN mail_messages mm ON CAST(mm.id AS TEXT) = inf.source_ref_id
            WHERE inf.invoice_id = i.id AND inf.source_type = 'mail'
            ORDER BY inf.created_at DESC LIMIT 1) AS "fromAddress",
           i.raw_text_path AS "rawTextPath"
    FROM invoices i
    WHERE i.vendor_id IS NULL OR i.confidence < 0.7
  `;

  let matched = 0;
  let unchanged = 0;

  for (const candidate of candidates) {
    const signals = [candidate.filename, candidate.fromAddress].filter(Boolean) as string[];
    if (signals.length === 0) {
      unchanged += 1;
      continue;
    }

    const result = await matchVendor(signals);
    if (result.vendorId && result.vendorId !== candidate.vendorId) {
      await sql`
        UPDATE invoices
        SET vendor_id = ${result.vendorId},
            confidence = GREATEST(COALESCE(confidence, 0), ${result.confidence}),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${candidate.id}
      `;
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
