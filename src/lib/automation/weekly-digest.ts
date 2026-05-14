/**
 * Wöchentlicher Digest — Kernlogik.
 *
 * Verschickt jeweils montags um 8 Uhr eine Wochenzusammenfassung
 * an alle Org-Owner via Resend.
 *
 * Wird aufgerufen von:
 *   - auto-pilot.ts  (Cron: 0 8 * * 1)
 *   - /api/cron/weekly-digest  (HTTP-Trigger für externe Scheduler)
 */

import { sql } from "@/lib/db/client";
import { sendWeeklyDigest } from "@/lib/mail/notify";
import { appConfig } from "@/lib/config/env";

export type WeeklyDigestResult = {
  results: Array<{ email: string; sent: boolean }>;
  skipped?: string;
};

export async function runWeeklyDigest(): Promise<WeeklyDigestResult> {
  if (!appConfig.brevo.apiKey) {
    return { results: [], skipped: "no BREVO_API_KEY" };
  }

  const owners = await sql<{ email: string; orgId: string }[]>`
    SELECT u.email, o.id AS "orgId"
    FROM users u
    INNER JOIN organizations o ON o.owner_user_id = u.id
  `;

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19);

  const results: Array<{ email: string; sent: boolean }> = [];

  for (const { email, orgId } of owners) {
    const statsRows = await sql<{ sent: string; reviewed: string; pending: string }[]>`
      SELECT
        COUNT(CASE WHEN status = 'exported' AND updated_at >= ${oneWeekAgo}::timestamp THEN 1 END)::text AS sent,
        COUNT(CASE WHEN status IN ('ready','exported') AND updated_at >= ${oneWeekAgo}::timestamp AND source != 'auto' THEN 1 END)::text AS reviewed,
        COUNT(CASE WHEN status = 'needs_review' THEN 1 END)::text AS pending
      FROM invoices
      WHERE organization_id = ${orgId} OR organization_id IS NULL
    `;
    const stats = statsRows[0] ?? { sent: "0", reviewed: "0", pending: "0" };

    const ok = await sendWeeklyDigest({
      to: email,
      sent: Number(stats.sent),
      reviewed: Number(stats.reviewed),
      pending: Number(stats.pending),
    });
    results.push({ email, sent: ok });
  }

  return { results };
}
