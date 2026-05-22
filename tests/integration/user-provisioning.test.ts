import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import { ensureUserProvisioned, findUserByEmail } from "@/lib/auth/users";

// INFETCH-220: Ein soft-gelöschter User (Leiche) mit nicht-leerer Org darf beim
// erneuten Login NICHT still in den /login-Loop laufen. ensureUserProvisioned
// muss die Leiche per E-Mail-Tombstone aus dem Weg räumen (Daten bleiben) und
// ein frisches, lebendes Profil anlegen. Spiegelt den realen order@-Fall
// (Leiche + 1 mail_account/vendor → purgeDeadUser verweigert).

const hasDb = Boolean(process.env.DATABASE_URL);
const S = `${Date.now()}`;

// Fall A: Leiche mit nicht-leerer Org (Tombstone-Pfad)
const EMAIL_A = `inf220-a-${S}@prov.local`;
const LEICHE_A = `inf220-leiche-a-${S}`;
const LEICHE_ORG_A = `inf220-leiche-org-a-${S}`;
const FRESH_A = `inf220-fresh-a-${S}`;
const VENDOR_KEY_A = `inf220-vendor-a-${S}`;

// Fall B: Leiche mit leerer Org (Purge-Pfad via clearDeadLeiche)
const EMAIL_B = `inf220-b-${S}@prov.local`;
const LEICHE_B = `inf220-leiche-b-${S}`;
const LEICHE_ORG_B = `inf220-leiche-org-b-${S}`;
const FRESH_B = `inf220-fresh-b-${S}`;

const ALL_USERS = [LEICHE_A, FRESH_A, LEICHE_B, FRESH_B];

async function cleanup() {
  // Child→Parent, scoped auf die owned Orgs der Test-User (Leiche + Fresh).
  await sql`DELETE FROM export_targets WHERE organization_id IN (SELECT id FROM organizations WHERE owner_user_id = ANY(${ALL_USERS}))`;
  await sql`DELETE FROM vendors WHERE canonical_key = ${VENDOR_KEY_A}`;
  await sql`DELETE FROM org_members WHERE user_id = ANY(${ALL_USERS})`;
  await sql`DELETE FROM organizations WHERE owner_user_id = ANY(${ALL_USERS})`;
  await sql`DELETE FROM users WHERE id = ANY(${ALL_USERS})`;
}

async function seedLeiche(opts: {
  userId: string;
  orgId: string;
  email: string;
  withVendor?: string;
}) {
  await sql`INSERT INTO users (id, email, name, deleted_at) VALUES (${opts.userId}, ${opts.email}, 'Leiche', NOW())`;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id, deleted_at)
    VALUES (${opts.orgId}, ${opts.orgId}, ${opts.orgId}, 'free', ${opts.userId}, NOW())
  `;
  await sql`INSERT INTO org_members (organization_id, user_id, role) VALUES (${opts.orgId}, ${opts.userId}, 'owner')`;
  if (opts.withVendor) {
    // Macht die Org "nicht-leer" → purgeDeadUser verweigert (NonEmptyOrgPurgeRefused).
    await sql`INSERT INTO vendors (name, canonical_key, category, organization_id) VALUES ('Org Vendor', ${opts.withVendor}, 'saas', ${opts.orgId})`;
  }
}

describe.skipIf(!hasDb)("ensureUserProvisioned — soft-deleted leiche recovery (INFETCH-220)", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("non-empty leiche: tombstones the dead email, provisions a fresh live profile, preserves old org", async () => {
    await seedLeiche({ userId: LEICHE_A, orgId: LEICHE_ORG_A, email: EMAIL_A, withVendor: VENDOR_KEY_A });

    const isNew = await ensureUserProvisioned({ id: FRESH_A, email: EMAIL_A, user_metadata: null });
    expect(isNew).toBe(true);

    // Frisches, lebendes Profil unter der kanonischen E-Mail + neuer Auth-ID.
    const live = await findUserByEmail(EMAIL_A);
    expect(live?.id).toBe(FRESH_A);

    // Leiche lebt weiter, aber soft-deleted + E-Mail getombstoned (≠ kanonisch).
    const [leiche] = await sql<{ email: string; deleted_at: string | null }[]>`
      SELECT email, deleted_at::text AS deleted_at FROM users WHERE id = ${LEICHE_A}
    `;
    expect(leiche).toBeTruthy();
    expect(leiche.deleted_at).not.toBeNull();
    expect(leiche.email).not.toBe(EMAIL_A);
    expect(leiche.email).toContain("+deleted-");

    // Frischer User hat genau eine lebende Org-Mitgliedschaft.
    const [member] = await sql<{ c: string }[]>`
      SELECT COUNT(*) c FROM org_members m
      JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ${FRESH_A} AND o.deleted_at IS NULL
    `;
    expect(Number(member.c)).toBe(1);

    // Alte Org + Vendor bleiben unangetastet (recoverable, nicht gelöscht).
    expect(
      Number((await sql<{ c: string }[]>`SELECT COUNT(*) c FROM organizations WHERE id = ${LEICHE_ORG_A}`)[0].c),
    ).toBe(1);
    expect(
      Number((await sql<{ c: string }[]>`SELECT COUNT(*) c FROM vendors WHERE canonical_key = ${VENDOR_KEY_A}`)[0].c),
    ).toBe(1);
  });

  it("empty leiche: hard-purges the dead row and provisions fresh", async () => {
    await seedLeiche({ userId: LEICHE_B, orgId: LEICHE_ORG_B, email: EMAIL_B });

    const isNew = await ensureUserProvisioned({ id: FRESH_B, email: EMAIL_B, user_metadata: null });
    expect(isNew).toBe(true);

    // Leere Leiche → komplett weg (gepurgt), nicht getombstoned.
    expect(
      Number((await sql<{ c: string }[]>`SELECT COUNT(*) c FROM users WHERE id = ${LEICHE_B}`)[0].c),
    ).toBe(0);
    expect(
      Number((await sql<{ c: string }[]>`SELECT COUNT(*) c FROM organizations WHERE id = ${LEICHE_ORG_B}`)[0].c),
    ).toBe(0);

    // Frisches lebendes Profil da.
    const live = await findUserByEmail(EMAIL_B);
    expect(live?.id).toBe(FRESH_B);
  });
});
