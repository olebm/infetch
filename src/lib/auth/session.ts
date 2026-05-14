import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db/client";

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

export function createSession(
  userId: string,
  options: { db?: Database.Database; activeOrganizationId?: string | null } = {},
): SessionRow {
  const db = options.db ?? getDb();
  const id = generateSessionToken();
  const expiresAt = isoExpiresAt(SESSION_TTL_SECONDS);
  db.prepare(
    `INSERT INTO sessions (id, user_id, active_organization_id, expires_at)
     VALUES (?, ?, ?, ?)`,
  ).run(id, userId, options.activeOrganizationId ?? null, expiresAt);
  return {
    id,
    userId,
    activeOrganizationId: options.activeOrganizationId ?? null,
    expiresAt,
    lastUsedAt: new Date().toISOString(),
  };
}

export function loadSession(sessionId: string, db?: Database.Database): SessionRow | null {
  const conn = db ?? getDb();
  const row = conn
    .prepare(
      `SELECT id, user_id AS userId, active_organization_id AS activeOrganizationId,
              expires_at AS expiresAt, last_used_at AS lastUsedAt
       FROM sessions
       WHERE id = ?`,
    )
    .get(sessionId) as SessionRow | undefined;
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    deleteSession(sessionId, conn);
    return null;
  }
  conn
    .prepare(`UPDATE sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(sessionId);
  return row;
}

export function deleteSession(sessionId: string, db?: Database.Database): void {
  const conn = db ?? getDb();
  conn.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
}

export function loadUser(userId: string, db?: Database.Database): UserRow | null {
  const conn = db ?? getDb();
  const row = conn
    .prepare(
      `SELECT id, email, name, email_verified_at AS emailVerifiedAt
       FROM users
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(userId) as UserRow | undefined;
  return row ?? null;
}

export function loadOrganization(
  organizationId: string,
  db?: Database.Database,
): OrganizationRow | null {
  const conn = db ?? getDb();
  const row = conn
    .prepare(
      `SELECT id, name, slug, tier, owner_user_id AS ownerUserId
       FROM organizations
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(organizationId) as OrganizationRow | undefined;
  return row ?? null;
}

export type OrgMemberRow = {
  userId: string;
  name: string | null;
  email: string;
  role: string;
};

export function loadOrgMembers(
  orgId: string,
  db?: Database.Database,
): OrgMemberRow[] {
  const conn = db ?? getDb();
  return conn
    .prepare(
      `SELECT u.id AS userId, u.name, u.email, m.role
       FROM org_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = ? AND u.deleted_at IS NULL
       ORDER BY m.created_at`,
    )
    .all(orgId) as OrgMemberRow[];
}

export type SessionSummary = {
  id: string;
  lastUsedAt: string;
  createdAt: string;
};

export function loadActiveSessions(
  userId: string,
  db?: Database.Database,
): SessionSummary[] {
  const conn = db ?? getDb();
  return conn
    .prepare(
      `SELECT id, last_used_at AS lastUsedAt, created_at AS createdAt
       FROM sessions
       WHERE user_id = ? AND expires_at > CURRENT_TIMESTAMP
       ORDER BY last_used_at DESC`,
    )
    .all(userId) as SessionSummary[];
}

export function invalidateAllOtherSessions(
  userId: string,
  currentSessionId: string,
  db?: Database.Database,
): number {
  const conn = db ?? getDb();
  const result = conn
    .prepare(`DELETE FROM sessions WHERE user_id = ? AND id != ?`)
    .run(userId, currentSessionId);
  return result.changes;
}

export function updateUserName(
  userId: string,
  name: string,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      `UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .run(name, userId);
}

export function updateUserProfile(
  userId: string,
  fields: { name: string; companyName: string; vatId: string },
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      `UPDATE users SET name = ?, company_name = ?, vat_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .run(fields.name, fields.companyName || null, fields.vatId || null, userId);
}

export function getUserProfileFields(
  userId: string,
  db?: Database.Database,
): { companyName: string | null; vatId: string | null } {
  const conn = db ?? getDb();
  const row = conn
    .prepare(`SELECT company_name, vat_id FROM users WHERE id = ?`)
    .get(userId) as { company_name: string | null; vat_id: string | null } | undefined;
  return {
    companyName: row?.company_name ?? null,
    vatId: row?.vat_id ?? null,
  };
}

export function loadUserOrganizations(
  userId: string,
  db?: Database.Database,
): OrganizationRow[] {
  const conn = db ?? getDb();
  return conn
    .prepare(
      `SELECT o.id, o.name, o.slug, o.tier, o.owner_user_id AS ownerUserId
       FROM organizations o
       INNER JOIN org_members m ON m.organization_id = o.id
       WHERE m.user_id = ? AND o.deleted_at IS NULL
       ORDER BY o.created_at`,
    )
    .all(userId) as OrganizationRow[];
}
