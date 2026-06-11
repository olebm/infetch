import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import { ensureUserProvisioned } from "@/lib/auth/users";

// INFETCH-270: Ein Self-Signup, der eine fremde invited_org_id in seiner
// user_metadata fälscht (kein echter Admin-Invite), darf NICHT in die fremde
// Org joinen. Der Angreifer hat keinen auth.users-Eintrag mit invited_at (bzw.
// auth.users fehlt in der CI-DB) → hasAdminInviteFor liefert false → der User
// bekommt eine eigene Default-Org statt eines Cross-Tenant-Joins.
//
// Umgebungs-unabhängig: prüft genau den fail-closed-Pfad, der in beiden
// DB-Varianten (lokal Supabase / CI vanilla-pg) identisch greift.

const hasDb = Boolean(process.env.DATABASE_URL);
const S = `${Date.now()}`;
const VICTIM_OWNER = `inf270-victim-owner-${S}`;
const VICTIM_ORG = `inf270-victim-org-${S}`;
const ATTACKER_ID = `inf270-attacker-${S}`;
const ATTACKER_EMAIL = `inf270-attacker-${S}@prov.local`;
const USERS = [VICTIM_OWNER, ATTACKER_ID];

async function cleanup() {
  await sql`DELETE FROM export_targets WHERE organization_id IN (SELECT id FROM organizations WHERE owner_user_id = ANY(${USERS}) OR id = ${VICTIM_ORG})`;
  await sql`DELETE FROM org_members WHERE user_id = ANY(${USERS}) OR organization_id = ${VICTIM_ORG}`;
  await sql`DELETE FROM organizations WHERE owner_user_id = ANY(${USERS}) OR id = ${VICTIM_ORG}`;
  await sql`DELETE FROM users WHERE id = ANY(${USERS})`;
}

describe.skipIf(!hasDb)(
  "ensureUserProvisioned — cross-tenant self-join blocked (INFETCH-270)",
  () => {
    beforeEach(cleanup);
    afterEach(cleanup);

    it("forging a foreign invited_org_id does NOT join that org and yields an own org", async () => {
      // Opfer-Org existiert.
      await sql`INSERT INTO users (id, email, name, email_verified_at) VALUES (${VICTIM_OWNER}, ${`victim-${S}@prov.local`}, 'Victim', NOW()::text)`;
      await sql`INSERT INTO organizations (id, name, slug, tier, owner_user_id) VALUES (${VICTIM_ORG}, 'Victim GmbH', ${`victim-${S}`}, 'free', ${VICTIM_OWNER})`;
      await sql`INSERT INTO org_members (organization_id, user_id, role) VALUES (${VICTIM_ORG}, ${VICTIM_OWNER}, 'owner')`;

      // Angreifer registriert sich mit gefälschter Metadata (kein echter Invite).
      const isNew = await ensureUserProvisioned({
        id: ATTACKER_ID,
        email: ATTACKER_EMAIL,
        user_metadata: { invited_org_id: VICTIM_ORG, invited_role: "owner" },
      });
      expect(isNew).toBe(true);

      // Angreifer ist NICHT Mitglied der Opfer-Org.
      const inVictim = await sql<{ c: string }[]>`
      SELECT COUNT(*) c FROM org_members WHERE organization_id = ${VICTIM_ORG} AND user_id = ${ATTACKER_ID}
    `;
      expect(Number(inVictim[0].c)).toBe(0);

      // Opfer-Org hat weiterhin genau ein Mitglied (den Owner) — kein Fremdzugriff.
      const victimMembers = await sql<{ c: string }[]>`
      SELECT COUNT(*) c FROM org_members WHERE organization_id = ${VICTIM_ORG}
    `;
      expect(Number(victimMembers[0].c)).toBe(1);

      // Angreifer hat stattdessen eine eigene Default-Org (als owner) erhalten.
      const ownOrg = await sql<{ c: string }[]>`
      SELECT COUNT(*) c FROM org_members WHERE user_id = ${ATTACKER_ID} AND role = 'owner'
    `;
      expect(Number(ownOrg[0].c)).toBe(1);
    });
  },
);
