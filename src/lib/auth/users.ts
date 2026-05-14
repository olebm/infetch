import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db/client";
import type { OrganizationRow, UserRow } from "@/lib/auth/session";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "user";
}

export function findUserByEmail(email: string, db?: Database.Database): UserRow | null {
  const conn = db ?? getDb();
  const row = conn
    .prepare(
      `SELECT id, email, name, email_verified_at AS emailVerifiedAt
       FROM users
       WHERE email = ? AND deleted_at IS NULL`,
    )
    .get(email.toLowerCase()) as UserRow | undefined;
  return row ?? null;
}

export function createUserWithDefaultOrg(input: {
  email: string;
  name?: string | null;
  db?: Database.Database;
}): { user: UserRow; organization: OrganizationRow } {
  const db = input.db ?? getDb();
  const email = input.email.toLowerCase();
  const userId = crypto.randomUUID();
  const orgId = crypto.randomUUID();
  const baseSlug = slugify(input.name || email.split("@")[0] || "user");
  const slug = ensureUniqueSlug(db, baseSlug);
  const orgName = input.name ? `${input.name}` : email.split("@")[0];

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, email, name, email_verified_at)
       VALUES (?, ?, ?, ?)`,
    ).run(userId, email, input.name ?? null, new Date().toISOString());

    db.prepare(
      `INSERT INTO organizations (id, name, slug, tier, owner_user_id)
       VALUES (?, ?, ?, 'free', ?)`,
    ).run(orgId, orgName, slug, userId);

    db.prepare(
      `INSERT INTO org_members (organization_id, user_id, role)
       VALUES (?, ?, 'owner')`,
    ).run(orgId, userId);
  });
  tx();

  return {
    user: {
      id: userId,
      email,
      name: input.name ?? null,
      emailVerifiedAt: new Date().toISOString(),
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

function ensureUniqueSlug(db: Database.Database, base: string): string {
  let slug = base;
  let attempt = 0;
  while (
    (db.prepare(`SELECT 1 FROM organizations WHERE slug = ?`).get(slug) as unknown) !==
    undefined
  ) {
    attempt += 1;
    slug = `${base}-${attempt}`;
  }
  return slug;
}
