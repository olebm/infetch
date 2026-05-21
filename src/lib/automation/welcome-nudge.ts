/**
 * Welcome-Nudge — stupst User an, die nach dem Sign-Up das Onboarding NICHT
 * abgeschlossen haben (kein aktives Export-Ziel = Setup unvollstaendig).
 *
 * Ersetzt die fruehere Sofort-Mail bei Account-Anlage (createUserWithDefaultOrg):
 * wer direkt durchs Onboarding laeuft, bekommt gar keine Mail mehr — nur
 * echte Drop-outs werden fruehestens ~24h spaeter EINMALIG erinnert.
 *
 * Cron: alle 6h. Dedup ueber settings-store (1x pro User, kein DB-Schema noetig).
 */
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { readJsonSetting, writeJsonSetting } from "@/lib/db/settings-store";
import { sendOnboardingEmail } from "@/lib/mail/notify";
import { appConfig } from "@/lib/config/env";

const MIN_AGE_HOURS = 24; // fruehestens 24h nach Sign-Up nudgen
const MAX_AGE_DAYS = 14; // aeltere Drop-outs nicht mehr behelligen

export type WelcomeNudgeResult = {
  checked: number;
  nudged: number;
  skipped: string;
};

export async function runWelcomeNudge(): Promise<WelcomeNudgeResult> {
  if (!appConfig.brevo.apiKey) {
    return { checked: 0, nudged: 0, skipped: "no BREVO_API_KEY" };
  }

  // Cutoffs in JS berechnen — created_at ist TEXT, daher gebundene
  // timestamptz-Parameter statt INTERVAL-Interpolation.
  const now = Date.now();
  const minCutoff = new Date(now - MIN_AGE_HOURS * 3_600_000).toISOString();
  const maxCutoff = new Date(now - MAX_AGE_DAYS * 86_400_000).toISOString();

  // Owner deren Org KEIN aktives Export-Ziel hat (= Onboarding nicht
  // abgeschlossen), Account 24h..14d alt, nicht geloescht.
  const rows = await sql<{ userId: string; email: string; name: string | null }[]>`
    SELECT u.id AS "userId", u.email AS "email", u.name AS "name"
    FROM users u
    JOIN organizations o ON o.owner_user_id = u.id
    WHERE u.deleted_at IS NULL
      AND u.created_at::timestamptz < ${minCutoff}::timestamptz
      AND u.created_at::timestamptz > ${maxCutoff}::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM export_targets et
        WHERE et.organization_id = o.id AND et.enabled = TRUE
      )
  `;

  let nudged = 0;
  for (const row of rows) {
    const key = `welcome_nudge_sent:${row.userId}`;
    const already = await readJsonSetting<boolean>(key, false);
    if (already) continue;
    try {
      await sendOnboardingEmail({ to: row.email, name: row.name });
      await writeJsonSetting(key, true);
      nudged += 1;
    } catch (err) {
      console.error("[welcome-nudge] send failed:", err);
    }
  }

  return { checked: rows.length, nudged, skipped: "" };
}
