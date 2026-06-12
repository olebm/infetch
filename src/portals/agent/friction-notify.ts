/**
 * Friktions-Benachrichtigung (INFETCH-257): braucht ein Portal-Abruf manuellen
 * Eingriff (CAPTCHA, 2FA, abgelaufener/abgelehnter Login), wird der Org-Owner
 * aktiv per E-Mail informiert — statt es erst beim Dashboard-Blick zu merken.
 *
 * Dedup ohne Spam: pro Org+Vendor merkt ein settings-Marker den zuletzt
 * benachrichtigten Friktions-Status. Wiederholte Fehlläufe (Cron alle 4h) mit
 * demselben Status lösen NICHT erneut aus; ein erfolgreicher Lauf setzt den Marker
 * zurück, sodass ein späterer Friktionsfall wieder benachrichtigt. Wechselt die Art
 * der Friktion (z.B. login_required → captcha), wird erneut informiert.
 *
 * Die DB-/Mail-Grenzen sind injizierbar (deps) — die Dedup-Logik ist damit ohne
 * DB/SMTP unit-testbar.
 */

import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { readJsonSetting, writeJsonSetting } from "@/lib/db/settings-store";
import { sendPortalFrictionEmail, type PortalFrictionStatus } from "@/lib/mail/notify";
import type { RunStatus } from "@/portals/agent/types";

const FRICTION_STATUSES: readonly PortalFrictionStatus[] = [
  "login_required",
  "two_factor",
  "captcha",
];
// Erfolgreiche Läufe (eingeloggt, ggf. ohne neue Rechnungen) heben die Friktion auf.
// Technische Fehler (recipe_broken/failed) lassen den Marker unberührt.
const RESET_STATUSES: readonly RunStatus[] = ["success", "no_invoices"];

function isFriction(status: RunStatus): status is PortalFrictionStatus {
  return (FRICTION_STATUSES as readonly string[]).includes(status);
}

export type FrictionNotifyDeps = {
  readMarker: (key: string) => Promise<string | null>;
  writeMarker: (key: string, value: string | null) => Promise<void>;
  resolveRecipient: (orgId: string) => Promise<{ email: string; name: string | null } | null>;
  resolveVendorName: (vendorKey: string) => Promise<string>;
  sendEmail: typeof sendPortalFrictionEmail;
};

const defaultDeps: FrictionNotifyDeps = {
  readMarker: (key) => readJsonSetting<string | null>(key, null),
  writeMarker: (key, value) => writeJsonSetting(key, value),
  resolveRecipient: defaultResolveRecipient,
  resolveVendorName: defaultResolveVendorName,
  sendEmail: sendPortalFrictionEmail,
};

export type FrictionNotifyOutcome = "sent" | "deduped" | "reset" | "skipped";

export async function notifyPortalFrictionIfNeeded(
  input: { vendorKey: string; organizationId: string; status: RunStatus },
  deps: Partial<FrictionNotifyDeps> = {},
): Promise<FrictionNotifyOutcome> {
  const d = { ...defaultDeps, ...deps };
  const key = `portal_friction_notified_${input.organizationId}_${input.vendorKey}`;

  if (!isFriction(input.status)) {
    if (RESET_STATUSES.includes(input.status)) {
      const last = await d.readMarker(key);
      if (last) {
        await d.writeMarker(key, null);
        return "reset";
      }
    }
    return "skipped";
  }

  const lastNotified = await d.readMarker(key);
  if (lastNotified === input.status) return "deduped"; // schon für genau diese Friktion gemeldet

  const recipient = await d.resolveRecipient(input.organizationId);
  if (!recipient) return "skipped";
  const vendorName = await d.resolveVendorName(input.vendorKey);

  const sent = await d.sendEmail({
    to: recipient.email,
    name: recipient.name,
    vendorName,
    status: input.status,
  });
  if (!sent) return "skipped"; // Marker NICHT setzen → nächster Lauf versucht es erneut

  await d.writeMarker(key, input.status);
  return "sent";
}

async function defaultResolveRecipient(
  orgId: string,
): Promise<{ email: string; name: string | null } | null> {
  const rows = await sql<{ email: string; name: string | null }[]>`
    SELECT u.email AS email, u.name AS name
    FROM organizations o
    INNER JOIN users u ON u.id = o.owner_user_id
    WHERE o.id = ${orgId} AND o.deleted_at IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function defaultResolveVendorName(vendorKey: string): Promise<string> {
  const rows = await sql<{ name: string }[]>`
    SELECT name FROM vendors WHERE canonical_key = ${vendorKey} LIMIT 1
  `;
  return rows[0]?.name ?? vendorKey;
}
