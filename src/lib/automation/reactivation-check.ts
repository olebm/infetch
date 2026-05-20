/**
 * Reaktivierungs-Check — wöchentlich sonntags.
 *
 * Findet Org-Owner deren letzte Rechnung > 30 Tage zurückliegt
 * (aber mindestens 1 Rechnung vorhanden, also aktive Nutzer)
 * und sendet eine Reaktivierungs-Mail — max. 1× pro 30 Tage pro Org.
 *
 * Cron: 0 9 * * 0  (sonntags 9 Uhr)
 */

import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { readJsonSetting, writeJsonSetting } from "@/lib/db/settings-store";
import { sendReactivationEmail } from "@/lib/mail/notify";
import { appConfig } from "@/lib/config/env";

const INACTIVE_DAYS = 30;
const NUDGE_COOLDOWN_DAYS = 30;

export type ReactivationResult = {
  checked: number;
  nudged: number;
  skipped: string;
};

export async function runReactivationCheck(): Promise<ReactivationResult> {
  if (!appConfig.brevo.apiKey) {
    return { checked: 0, nudged: 0, skipped: "no BREVO_API_KEY" };
  }

  // Orgs mit mind. 1 Rechnung, deren letzte Rechnung > 30 Tage zurückliegt
  const rows = await sql<{
    orgId: string;
    ownerEmail: string;
    ownerName: string | null;
    lastInvoiceDate: string;
    daysSince: number;
  }[]>`
    SELECT
      o.id                                              AS "orgId",
      u.email                                           AS "ownerEmail",
      u.name                                            AS "ownerName",
      MAX(i.created_at)                                 AS "lastInvoiceDate",
      EXTRACT(EPOCH FROM (NOW() - MAX(i.created_at))) / 86400 AS "daysSince"
    FROM organizations o
    INNER JOIN users u ON u.id = o.owner_user_id
    INNER JOIN invoices i ON i.organization_id = o.id
    WHERE o.deleted_at IS NULL
    GROUP BY o.id, u.email, u.name
    HAVING EXTRACT(EPOCH FROM (NOW() - MAX(i.created_at))) / 86400 > ${INACTIVE_DAYS}
    ORDER BY "daysSince" DESC
  `;

  let nudged = 0;

  for (const row of rows) {
    const settingKey = `reactivation_nudge_sent_${row.orgId}`;
    const lastSent = await readJsonSetting<string | null>(settingKey, null);

    if (lastSent) {
      const daysSince = (Date.now() - new Date(lastSent).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < NUDGE_COOLDOWN_DAYS) continue;
    }

    const sent = await sendReactivationEmail({
      to: row.ownerEmail,
      name: row.ownerName,
      daysSinceLastInvoice: Math.round(row.daysSince),
    });

    if (sent) {
      await writeJsonSetting(settingKey, new Date().toISOString());
      nudged++;
    }
  }

  return { checked: rows.length, nudged, skipped: "" };
}
