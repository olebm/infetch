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
  // seen_at ist eine TEXT-Spalte. Ein einzelner nicht-ISO-parsbarer Wert würde
  // sonst den gesamten DELETE mit Cast-Fehler abbrechen (Retention läuft nie).
  // CASE garantiert, dass ::timestamptz nur ausgewertet wird, wenn der Wert
  // einem ISO-Datumspräfix entspricht; alles andere wird übersprungen.
  const rows = await sql<{ id: number }[]>`
    DELETE FROM mail_messages
    WHERE seen_at IS NOT NULL
      AND (
        CASE
          WHEN seen_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          THEN seen_at::timestamptz
        END
      ) < (NOW() - (${months} || ' months')::interval)
    RETURNING id
  `;
  return { deletedMailMessages: rows.length, cutoffMonths: months };
}
