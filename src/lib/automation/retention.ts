/**
 * Datensparsamkeit: löscht alte Mail-Scan-Metadaten (`mail_messages`).
 *
 * `mail_messages` speichert Absender, Betreff und Datum *jeder* gescannten
 * Mail — auch von Mails ohne Rechnung. Diese Metadaten werden nach Ablauf
 * der Aufbewahrungsfrist gelöscht. Rechnungen (`invoices`) sind die
 * eigentlichen Nutzdaten und werden NICHT automatisch entfernt.
 *
 * Frist via RETENTION_MAIL_METADATA_MONTHS (Default: 12 Monate).
 */

import { sql } from "@/lib/db/client";

export function getRetentionMonths(): number {
  const raw = Number(process.env.RETENTION_MAIL_METADATA_MONTHS);
  return Number.isFinite(raw) && raw > 0 ? raw : 12;
}

export async function runRetention(): Promise<{ deletedMailMessages: number; cutoffMonths: number }> {
  const months = getRetentionMonths();
  const rows = await sql<{ id: number }[]>`
    DELETE FROM mail_messages
    WHERE seen_at IS NOT NULL
      AND seen_at::timestamptz < (NOW() - (${months} || ' months')::interval)
    RETURNING id
  `;
  return { deletedMailMessages: rows.length, cutoffMonths: months };
}
