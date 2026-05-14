import crypto from "node:crypto";
import { sql } from "@/lib/db/client";
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
