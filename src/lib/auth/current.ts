import { redirect } from "next/navigation";
import { sql } from "@/lib/db/client";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findUserByEmail } from "@/lib/auth/users";
import type { OrganizationRow, SessionRow, UserRow } from "@/lib/auth/session";

export type CurrentAuth = {
  session: SessionRow;
  user: UserRow;
  organization: OrganizationRow | null;
};

/**
 * Gibt die aktuelle Auth zurück oder null.
 *
 * Phase-1-Bridge: Supabase verwaltet Session + JWT; Users + Orgs liegen
 * noch in Postgres.
 * Lookup erfolgt per E-Mail, um ID-Abweichungen bei Dev-Usern zu tolerieren.
 */
export async function getCurrentAuth(): Promise<CurrentAuth | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: supabaseUser },
  } = await supabase.auth.getUser();

  if (!supabaseUser?.email) return null;

  // Phase-1-Bridge: per E-Mail nachschlagen (IDs können zwischen Supabase + Postgres abweichen)
  const userRow = await findUserByEmail(supabaseUser.email);
  if (!userRow) return null;

  const orgRows = await sql<OrganizationRow[]>`
    SELECT o.id, o.name, o.slug, o.tier, o.owner_user_id AS "ownerUserId"
    FROM organizations o
    INNER JOIN org_members m ON m.organization_id = o.id
    WHERE m.user_id = ${userRow.id} AND o.deleted_at IS NULL
    ORDER BY m.created_at
    LIMIT 1
  `;
  const orgRow = orgRows[0] ?? null;

  // Synthetische SessionRow für Rückwärtskompatibilität (Phase 1)
  const session: SessionRow = {
    id: supabaseUser.id,
    userId: userRow.id,
    activeOrganizationId: orgRow?.id ?? null,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    lastUsedAt: new Date().toISOString(),
  };

  return {
    session,
    user: userRow,
    organization: orgRow,
  };
}

export async function requireCurrentAuth(): Promise<CurrentAuth> {
  const auth = await getCurrentAuth();
  if (!auth) {
    redirect("/login");
  }
  return auth;
}

// Deprecated: nur noch für Rückwärtskompatibilität (wird in Phase 2 entfernt)
export const SESSION_COOKIE_NAME = "ia_session";
export async function getSessionId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}
