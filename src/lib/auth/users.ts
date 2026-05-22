import crypto from "node:crypto";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { purgeDeadUser, NonEmptyOrgPurgeRefused } from "@/lib/auth/account-teardown";
import type { OrganizationRow, UserRow } from "@/lib/auth/session";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "user";
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await sql<UserRow[]>`
    SELECT id, email, name, email_verified_at AS "emailVerifiedAt", avatar_url AS "avatarUrl"
    FROM users
    WHERE email = ${email.toLowerCase()} AND deleted_at IS NULL
  `;
  return rows[0] ?? null;
}

export async function createUserWithDefaultOrg(input: {
  email: string;
  name?: string | null;
  /** Optionale User-ID (z. B. Supabase-Auth-UUID). Wird generiert falls nicht angegeben. */
  userId?: string;
}): Promise<{ user: UserRow; organization: OrganizationRow }> {
  const email = input.email.toLowerCase();
  const userId = input.userId ?? crypto.randomUUID();
  const orgId = crypto.randomUUID();
  const baseSlug = slugify(input.name || email.split("@")[0] || "user");
  const slug = await ensureUniqueSlug(baseSlug);
  const orgName = input.name ? `${input.name}` : email.split("@")[0];
  const now = new Date().toISOString();

  await sql`
    INSERT INTO users (id, email, name, email_verified_at)
    VALUES (${userId}, ${email}, ${input.name ?? null}, ${now})
  `;

  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${orgId}, ${orgName}, ${slug}, 'free', ${userId})
  `;

  await sql`
    INSERT INTO org_members (organization_id, user_id, role)
    VALUES (${orgId}, ${userId}, 'owner')
  `;

  // SECURITY (Migration 0013): Default-Export-Targets pro Org anlegen,
  // damit die Onboarding-/Settings-UI nicht auf globale Rows zugreift.
  await sql`
    INSERT INTO export_targets (organization_id, target, label, enabled)
    VALUES
      (${orgId}, 'kontist', 'Kontist', FALSE),
      (${orgId}, 'accountable', 'Accountable', FALSE)
    ON CONFLICT (organization_id, target) DO NOTHING
  `;

  return {
    user: {
      id: userId,
      email,
      name: input.name ?? null,
      emailVerifiedAt: now,
      avatarUrl: null,
    },
    organization: {
      id: orgId,
      name: orgName,
      slug,
      tier: "free",
      ownerUserId: userId,
    },
  };
}

/**
 * Legt einen neuen User an und fügt ihn einer bestehenden Organisation hinzu.
 * Wird im Auth-Callback verwendet, wenn ein Nutzer per Einlade-Link kommt.
 */
export async function createUserAndJoinOrg(input: {
  email: string;
  name?: string | null;
  userId?: string;
  organizationId: string;
  role: "owner" | "admin" | "member";
}): Promise<UserRow> {
  const email = input.email.toLowerCase();
  const userId = input.userId ?? crypto.randomUUID();
  const now = new Date().toISOString();

  await sql`
    INSERT INTO users (id, email, name, email_verified_at)
    VALUES (${userId}, ${email}, ${input.name ?? null}, ${now})
    ON CONFLICT (email) DO NOTHING
  `;

  // Hol die tatsächliche User-ID (falls bereits vorhanden)
  const rows = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
  const resolvedUserId = rows[0]?.id ?? userId;

  await sql`
    INSERT INTO org_members (organization_id, user_id, role)
    VALUES (${input.organizationId}, ${resolvedUserId}, ${input.role})
    ON CONFLICT (organization_id, user_id) DO NOTHING
  `;

  return {
    id: resolvedUserId,
    email,
    name: input.name ?? null,
    emailVerifiedAt: now,
    avatarUrl: null,
  };
}

/**
 * Räumt eine soft-gelöschte Leiche aus dem Weg, damit die E-Mail für ein
 * frisches Konto frei wird. Leere Org → harter Purge (Daten restlos weg).
 * Nicht-leere Org → purgeDeadUser verweigert (NonEmptyOrgPurgeRefused, Schutz
 * gegen versehentliche Produktivdaten-Löschung im Login-Pfad); dann wird nur
 * die E-Mail der Leiche per Tombstone suffixt — Org/Daten bleiben unangetastet
 * & recoverable. So landet ein frisch authentifizierter User nicht mehr still
 * im /login-Loop (INFETCH-220).
 */
async function clearDeadLeiche(deadUserId: string): Promise<void> {
  try {
    await purgeDeadUser(deadUserId);
  } catch (err) {
    if (err instanceof NonEmptyOrgPurgeRefused) {
      await tombstoneUserEmail(deadUserId);
    } else {
      throw err;
    }
  }
}

/**
 * Suffixt die E-Mail einer soft-gelöschten Leiche, um die users_email_key-
 * UNIQUE (deckt auch Leichen ab) für einen frischen INSERT freizugeben. Ändert
 * NUR die E-Mail der toten Zeile; Org, Mitgliedschaften und Daten bleiben.
 */
async function tombstoneUserEmail(deadUserId: string): Promise<void> {
  const rows = await sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${deadUserId}`;
  const current = rows[0]?.email;
  if (!current) return;
  const at = current.lastIndexOf("@");
  const local = at >= 0 ? current.slice(0, at) : current;
  const domain = at >= 0 ? current.slice(at + 1) : "tombstone.local";
  const freed = `${local}+deleted-${deadUserId}@${domain}`.slice(0, 320);
  await sql`UPDATE users SET email = ${freed} WHERE id = ${deadUserId} AND deleted_at IS NOT NULL`;
}

/**
 * Stellt sicher, dass ein Postgres-Profil für den authentifizierten
 * Supabase-User existiert. Wird vom Magic-Link-Callback UND vom
 * OTP-Code-Login aufgerufen — beide Pfade müssen den Bridge-User anlegen,
 * sonst landet ein frisch verifizierter User ohne Org zurück auf /login.
 *
 * @returns true, wenn der User neu angelegt wurde (Callback leitet dann
 *          direkt aufs Onboarding), false bei bereits existierendem Profil.
 */
export async function ensureUserProvisioned(supabaseUser: {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown> | null;
}): Promise<boolean> {
  const email = supabaseUser.email.toLowerCase();

  const meta = supabaseUser.user_metadata ?? {};
  const invitedOrgId = meta.invited_org_id as string | undefined;
  const invitedRole = (meta.invited_role as string | undefined) ?? "member";
  const validRole = (["owner", "admin", "member"] as const).includes(
    invitedRole as "owner" | "admin" | "member",
  )
    ? (invitedRole as "owner" | "admin" | "member")
    : "member";
  const name = (meta.full_name as string | undefined) ?? null;

  async function provisionFresh(): Promise<void> {
    if (invitedOrgId) {
      await createUserAndJoinOrg({
        email: supabaseUser.email,
        name,
        userId: supabaseUser.id,
        organizationId: invitedOrgId,
        role: validRole,
      });
    } else {
      await createUserWithDefaultOrg({
        email: supabaseUser.email,
        name,
        userId: supabaseUser.id,
      });
      // Keine Sofort-Willkommensmail mehr (INFETCH-201): wer direkt durchs
      // Onboarding laeuft, braucht sie nicht. Echte Drop-outs (24h+ ohne
      // aktives Export-Ziel) erinnert der welcomeNudge-Cron einmalig.
    }
  }

  // Bestehende Zeile per E-Mail OHNE deleted_at-Filter suchen: findUserByEmail
  // filtert deleted_at IS NULL, die users_email_key-UNIQUE-Constraint deckt
  // aber auch soft-gelöschte Zeilen ab — eine übersehene Leiche führte sonst
  // zu doppeltem INSERT + 23505 (Login schlug fehl).
  async function lookup(): Promise<{ id: string; deletedAt: string | null } | undefined> {
    const rows = await sql<{ id: string; deletedAt: string | null }[]>`
      SELECT id, deleted_at AS "deletedAt" FROM users WHERE email = ${email} LIMIT 1
    `;
    return rows[0];
  }

  const existing = await lookup();
  if (existing) {
    // Lebende Zeile → bereits provisioniert.
    if (existing.deletedAt === null) return false;
    // Soft-gelöschte Alt-Leiche (alter Löschpfad). Policy: gelöscht = weg,
    // danach frisches Konto. Leere Org → hart wegräumen; nicht-leere Org →
    // E-Mail-Tombstone statt stillem Loop (INFETCH-220, s. clearDeadLeiche).
    await clearDeadLeiche(existing.id);
  }

  // Self-healing: selbst wenn lookup eine Leiche verfehlt (Race, Edge) darf
  // ein 23505 NICHT als Login-Fehler durchschlagen — re-resolven, eine tote
  // Zeile aufräumen und genau einmal erneut anlegen.
  try {
    await provisionFresh();
  } catch (err) {
    if ((err as { code?: string }).code !== "23505") throw err;
    const again = await lookup();
    if (again?.deletedAt != null) {
      await clearDeadLeiche(again.id);
      await provisionFresh();
    } else if (again) {
      return false; // zwischenzeitlich lebend angelegt → bereits provisioniert
    } else {
      throw err;
    }
  }

  return true;
}

async function ensureUniqueSlug(base: string): Promise<string> {
  let slug = base;
  let attempt = 0;
  while (true) {
    const rows = await sql`SELECT 1 FROM organizations WHERE slug = ${slug} LIMIT 1`;
    if (rows.length === 0) break;
    attempt += 1;
    slug = `${base}-${attempt}`;
  }
  return slug;
}
