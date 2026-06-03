import crypto from "node:crypto";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 Tage

export type SessionRow = {
  id: string;
  userId: string;
  activeOrganizationId: string | null;
  expiresAt: string;
  lastUsedAt: string;
};

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  emailVerifiedAt: string | null;
  avatarUrl: string | null;
};

export type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  tier: "free" | "pro";
  ownerUserId: string;
};

function isoExpiresAt(secondsFromNow: number): string {
  return new Date(Date.now() + secondsFromNow * 1000).toISOString();
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function createSession(
  userId: string,
  options: { activeOrganizationId?: string | null } = {},
): Promise<SessionRow> {
  const id = generateSessionToken();
  const expiresAt = isoExpiresAt(SESSION_TTL_SECONDS);
  await sql`
    INSERT INTO sessions (id, user_id, active_organization_id, expires_at)
    VALUES (${id}, ${userId}, ${options.activeOrganizationId ?? null}, ${expiresAt})
  `;
  return {
    id,
    userId,
    activeOrganizationId: options.activeOrganizationId ?? null,
    expiresAt,
    lastUsedAt: new Date().toISOString(),
  };
}

export async function loadSession(sessionId: string): Promise<SessionRow | null> {
  const rows = await sql<SessionRow[]>`
    SELECT id, user_id AS "userId", active_organization_id AS "activeOrganizationId",
           expires_at AS "expiresAt", last_used_at AS "lastUsedAt"
    FROM sessions
    WHERE id = ${sessionId}
  `;
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    await deleteSession(sessionId);
    return null;
  }
  await sql`UPDATE sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ${sessionId}`;
  return row;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE id = ${sessionId}`;
}

export async function loadUser(userId: string): Promise<UserRow | null> {
  const rows = await sql<UserRow[]>`
    SELECT id, email, name, email_verified_at AS "emailVerifiedAt", avatar_url AS "avatarUrl"
    FROM users
    WHERE id = ${userId} AND deleted_at IS NULL
  `;
  return rows[0] ?? null;
}

export async function loadOrganization(organizationId: string): Promise<OrganizationRow | null> {
  const rows = await sql<OrganizationRow[]>`
    SELECT id, name, slug, tier, owner_user_id AS "ownerUserId"
    FROM organizations
    WHERE id = ${organizationId} AND deleted_at IS NULL
  `;
  return rows[0] ?? null;
}

export type OrgMemberRow = {
  userId: string;
  name: string | null;
  email: string;
  role: string;
};

export async function loadOrgMembers(orgId: string): Promise<OrgMemberRow[]> {
  return sql<OrgMemberRow[]>`
    SELECT u.id AS "userId", u.name, u.email, m.role
    FROM org_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.organization_id = ${orgId} AND u.deleted_at IS NULL
    ORDER BY m.created_at
  `;
}

export type SessionSummary = {
  id: string;
  lastUsedAt: string;
  createdAt: string;
};

export async function loadActiveSessions(userId: string): Promise<SessionSummary[]> {
  try {
    const rows = await sql<{ id: string; lastUsedAt: string; createdAt: string }[]>`
      SELECT
        id,
        COALESCE(refreshed_at, created_at) AS "lastUsedAt",
        created_at AS "createdAt"
      FROM auth.sessions
      WHERE user_id = ${userId}
        AND (not_after IS NULL OR not_after > CURRENT_TIMESTAMP)
      ORDER BY COALESCE(refreshed_at, created_at) DESC
    `;
    return rows;
  } catch {
    return [];
  }
}

/**
 * Beendet alle Supabase-Sessions des Nutzers außer der aktuellen.
 * Erfordert das JWT der laufenden Session (scope='others' lässt diese bestehen).
 * Gibt true zurück wenn die Admin-API erfolgreich war.
 */
export async function invalidateAllOtherSessions(currentJwt: string): Promise<boolean> {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.signOut(currentJwt, "others");
  if (error) throw new Error(error.message);
  return true;
}

export async function updateUserName(userId: string, name: string): Promise<void> {
  await sql`
    UPDATE users SET name = ${name}, updated_at = CURRENT_TIMESTAMP WHERE id = ${userId}
  `;
}

export async function updateUserProfile(
  userId: string,
  fields: { name: string; companyName: string; vatId: string },
): Promise<void> {
  await sql`
    UPDATE users
    SET name = ${fields.name},
        company_name = ${fields.companyName || null},
        vat_id = ${fields.vatId || null},
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${userId}
  `;
}

export async function getUserProfileFields(userId: string): Promise<{
  companyName: string | null;
  vatId: string | null;
  avatarUrl: string | null;
  notifyWeekly: boolean;
}> {
  const rows = await sql<
    {
      company_name: string | null;
      vat_id: string | null;
      avatar_url: string | null;
      notify_weekly: boolean;
    }[]
  >`
    SELECT company_name, vat_id, avatar_url, notify_weekly FROM users WHERE id = ${userId}
  `;
  const row = rows[0];
  return {
    companyName: row?.company_name ?? null,
    vatId: row?.vat_id ?? null,
    avatarUrl: row?.avatar_url ?? null,
    notifyWeekly: row?.notify_weekly ?? false,
  };
}

export async function updateUserAvatar(userId: string, avatarUrl: string | null): Promise<void> {
  await sql`
    UPDATE users SET avatar_url = ${avatarUrl}, updated_at = CURRENT_TIMESTAMP WHERE id = ${userId}
  `;
}

export async function loadUserOrganizations(userId: string): Promise<OrganizationRow[]> {
  return sql<OrganizationRow[]>`
    SELECT o.id, o.name, o.slug, o.tier, o.owner_user_id AS "ownerUserId"
    FROM organizations o
    INNER JOIN org_members m ON m.organization_id = o.id
    WHERE m.user_id = ${userId} AND o.deleted_at IS NULL
    ORDER BY o.created_at
  `;
}

export type PendingInvitation = {
  userId: string;
  email: string;
  role: string;
  invitedAt: string;
};

/**
 * Lädt offene (nicht akzeptierte) Einladungen für eine Organisation.
 * Nutzt Supabase Auth — eingeladene, aber nicht bestätigte Nutzer haben
 * `email_confirmed_at IS NULL` und `invited_org_id` in ihren Metadaten.
 */
export async function loadPendingInvitations(orgId: string): Promise<PendingInvitation[]> {
  try {
    const rows = await sql<
      { id: string; email: string; raw_user_meta_data: unknown; invited_at: string | null }[]
    >`
      SELECT id, email, raw_user_meta_data, invited_at
      FROM auth.users
      WHERE email_confirmed_at IS NULL
        AND invited_at IS NOT NULL
        AND raw_user_meta_data->>'invited_org_id' = ${orgId}
      ORDER BY invited_at DESC
    `;
    return rows.map((r) => ({
      userId: r.id,
      email: r.email,
      role: (r.raw_user_meta_data as Record<string, string> | null)?.invited_role ?? "member",
      invitedAt: r.invited_at ?? new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}
