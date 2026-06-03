import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db/client";

// Cross-Tenant-IDOR-Regressionstests für Stream A (security/cross-tenant-idor-fixes).
// Pattern wie tests/integration/tenant-isolation.test.ts: getCurrentAuth wird auf
// Org A festgepinnt, dann werden Actions mit IDs aus Org B aufgerufen — sie dürfen
// nichts modifizieren und müssen Fehler werfen oder still no-op'en.

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ORG_A = `org-a-idor-${SUFFIX}`;
const ORG_B = `org-b-idor-${SUFFIX}`;
const USER_A = `user-a-idor-${SUFFIX}`;
const USER_B = `user-b-idor-${SUFFIX}`;

const hasDb = Boolean(process.env.DATABASE_URL);

// getCurrentAuth → fix auf Org A; einzelne Tests dürfen das nicht ändern (Angriffsperspektive).
vi.mock("@/lib/auth/current", () => ({
  getCurrentAuth: async () => ({
    session: {},
    user: { id: USER_A },
    organization: { id: ORG_A, name: "Org A", slug: "org-a", tier: "pro", ownerUserId: USER_A },
  }),
  requireCurrentAuth: async () => ({
    session: {},
    user: { id: USER_A },
    organization: { id: ORG_A, name: "Org A", slug: "org-a", tier: "pro", ownerUserId: USER_A },
  }),
}));

// next/cache.revalidatePath: in der Test-Umgebung no-op.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Seitenwirkungen (file-names sync, missing-check, runAgentForVendor, etc.) sind für
// die Isolation-Frage irrelevant — wir interessieren uns nur dafür, ob die DB-WHERE-
// Klausel hält.
vi.mock("@/invoices/file-names", () => ({ syncStoredInvoiceFileNamesForInvoice: async () => {} }));
vi.mock("@/invoices/missing-check", () => ({
  runMissingInvoiceCheck: async () => ({ checked: 0, required: 0 }),
}));
vi.mock("@/vendors/auto-alias", () => ({ learnFromManualMatch: async () => ({ learned: false }) }));
vi.mock("@/lib/db/events", () => ({ recordSyncEvent: async () => {} }));
vi.mock("@/senders/discovered-senders", () => ({ blockSender: async () => {} }));
vi.mock("@/portals/agent/session-store", () => ({ invalidateBrowserSession: async () => {} }));
vi.mock("@/portals/credential-meta", () => ({
  resetPortalCredentialMeta: async () => {},
  savePortalCredentialMeta: async () => {},
}));

import { updateInvoiceReview } from "@/invoices/review";
import {
  markInvoicePrivateAction,
  restoreInvoiceFromPrivateAction,
  updateInvoiceReviewAction,
  approveInvoicesAction,
  ignoreInvoicesAction,
} from "@/app/(app)/audit/actions";
import { toggleVendorHiddenAction } from "@/app/(app)/fehlt/actions";
import { removeOnlineAccountAction } from "@/app/(app)/online-accounts/actions";

async function seedUser(id: string) {
  await sql`INSERT INTO users (id, email, name) VALUES (${id}, ${`${id}@idor.local`}, 'IDOR') ON CONFLICT DO NOTHING`;
}

async function seedOrg(id: string, ownerUserId: string) {
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${id}, ${id}, ${id}, 'pro', ${ownerUserId})
    ON CONFLICT DO NOTHING
  `;
}

async function seedInvoice(orgId: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO invoices (organization_id, source, status, confidence, dedupe_key, is_private)
    VALUES (${orgId}, 'manual', 'needs_review', 0.5, ${`idor-${orgId}-${Math.random()}`}, FALSE)
    RETURNING id
  `;
  return row.id;
}

async function seedVendor(orgId: string, key: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO vendors (organization_id, canonical_key, name, category, hidden)
    VALUES (${orgId}, ${`${key}-${orgId}-${SUFFIX}`}, ${key}, 'software', FALSE)
    RETURNING id
  `;
  return row.id;
}

async function seedCredentialRef(orgId: string, vendorKey: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO credential_refs (organization_id, scope, secret_store, secret_ref, label, status)
    VALUES (${orgId}, 'portal', 'encrypted_db', ${`vault:portal:${vendorKey}:${orgId}:${SUFFIX}`}, 'IDOR-Test', 'configured')
    RETURNING id
  `;
  return row.id;
}

async function cleanup() {
  await sql`DELETE FROM credential_refs WHERE secret_ref LIKE ${`%:${SUFFIX}`}`;
  await sql`DELETE FROM invoices WHERE organization_id IN (${ORG_A}, ${ORG_B})`;
  await sql`DELETE FROM vendors WHERE organization_id IN (${ORG_A}, ${ORG_B})`;
  await sql`DELETE FROM organizations WHERE id IN (${ORG_A}, ${ORG_B})`;
  await sql`DELETE FROM users WHERE id IN (${USER_A}, ${USER_B})`;
}

async function getInvoiceStatus(id: number) {
  const rows = await sql<{ status: string; isPrivate: boolean; vendorId: number | null }[]>`
    SELECT status, is_private AS "isPrivate", vendor_id AS "vendorId"
    FROM invoices WHERE id = ${id}
  `;
  return rows[0];
}

async function getVendorHidden(id: number): Promise<boolean | null> {
  const rows = await sql<{ hidden: boolean }[]>`SELECT hidden FROM vendors WHERE id = ${id}`;
  return rows[0]?.hidden ?? null;
}

async function credentialRefExists(id: number) {
  const rows = await sql<{ id: number }[]>`SELECT id FROM credential_refs WHERE id = ${id}`;
  return rows.length > 0;
}

describe.skipIf(!hasDb)("cross-tenant IDOR fixes (Stream A)", () => {
  let invoiceA = 0;
  let invoiceB = 0;
  let vendorA = 0;
  let vendorB = 0;
  let credentialA = 0;
  let credentialB = 0;
  const vendorKey = "idor-acme";

  beforeEach(async () => {
    await cleanup();
    await seedUser(USER_A);
    await seedUser(USER_B);
    await seedOrg(ORG_A, USER_A);
    await seedOrg(ORG_B, USER_B);
    invoiceA = await seedInvoice(ORG_A);
    invoiceB = await seedInvoice(ORG_B);
    vendorA = await seedVendor(ORG_A, vendorKey);
    vendorB = await seedVendor(ORG_B, vendorKey);
    credentialA = await seedCredentialRef(ORG_A, vendorKey);
    credentialB = await seedCredentialRef(ORG_B, vendorKey);
  });

  afterEach(cleanup);

  describe("updateInvoiceReview (Pflicht-Param organizationId)", () => {
    it("blockt Update einer fremden Org-Rechnung", async () => {
      await expect(
        updateInvoiceReview({
          organizationId: ORG_A,
          invoiceId: invoiceB,
          vendorId: null,
          invoiceNumber: null,
          invoiceDate: null,
          servicePeriodStart: null,
          servicePeriodEnd: null,
          amountGross: null,
          amountNet: null,
          vatAmount: null,
          currency: null,
          status: "ignored",
          duplicateOfInvoiceId: null,
          vatRate: null,
          docType: null,
          preferredExportTargetId: null,
        }),
      ).rejects.toThrow(/nicht gefunden/i);

      // Org B's Invoice ist unverändert.
      const after = await getInvoiceStatus(invoiceB);
      expect(after.status).toBe("needs_review");
    });

    it("erlaubt Update einer eigenen Org-Rechnung", async () => {
      await updateInvoiceReview({
        organizationId: ORG_A,
        invoiceId: invoiceA,
        vendorId: null,
        invoiceNumber: null,
        invoiceDate: null,
        servicePeriodStart: null,
        servicePeriodEnd: null,
        amountGross: null,
        amountNet: null,
        vatAmount: null,
        currency: null,
        status: "ignored",
        duplicateOfInvoiceId: null,
        vatRate: null,
        docType: null,
        preferredExportTargetId: null,
      });
      const after = await getInvoiceStatus(invoiceA);
      expect(after.status).toBe("ignored");
    });

    it("blockt Zuweisung eines Vendors aus fremder Org", async () => {
      await expect(
        updateInvoiceReview({
          organizationId: ORG_A,
          invoiceId: invoiceA,
          vendorId: vendorB,
          invoiceNumber: null,
          invoiceDate: null,
          servicePeriodStart: null,
          servicePeriodEnd: null,
          amountGross: null,
          amountNet: null,
          vatAmount: null,
          currency: null,
          status: "needs_review",
          duplicateOfInvoiceId: null,
          vatRate: null,
          docType: null,
          preferredExportTargetId: null,
        }),
      ).rejects.toThrow(/Vendor existiert nicht/i);
    });
  });

  describe("updateInvoiceReviewAction (Server Action)", () => {
    it("blockt Action mit fremder Invoice-ID", async () => {
      const fd = new FormData();
      fd.set("invoiceId", String(invoiceB));
      fd.set("intent", "mark_ignored");
      fd.set("reviewStatus", "needs_review");
      const res = await updateInvoiceReviewAction({ status: "idle", message: "" }, fd);
      expect(res.status).toBe("error");
      const after = await getInvoiceStatus(invoiceB);
      expect(after.status).toBe("needs_review");
    });
  });

  describe("markInvoicePrivate / restoreInvoiceFromPrivate", () => {
    it("blockt markInvoicePrivate auf fremder Rechnung", async () => {
      await expect(markInvoicePrivateAction(invoiceB)).resolves.toBeUndefined();
      const after = await getInvoiceStatus(invoiceB);
      expect(after.isPrivate).toBe(false);
    });

    it("markInvoicePrivate auf eigener Rechnung funktioniert", async () => {
      await markInvoicePrivateAction(invoiceA);
      const after = await getInvoiceStatus(invoiceA);
      expect(after.isPrivate).toBe(true);
    });

    it("blockt restoreInvoiceFromPrivate auf fremder Rechnung", async () => {
      // Org B's Invoice vorab privat setzen (direkt in DB, Action umgehen).
      await sql`UPDATE invoices SET is_private = TRUE WHERE id = ${invoiceB}`;
      await restoreInvoiceFromPrivateAction(invoiceB);
      const after = await getInvoiceStatus(invoiceB);
      expect(after.isPrivate).toBe(true);
    });
  });

  describe("approveInvoicesAction / ignoreInvoicesAction (Bulk)", () => {
    it("approve: eigene Rechnung wird ready, fremde bleibt unverändert (auch bei gemischten IDs)", async () => {
      await approveInvoicesAction([invoiceA, invoiceB]);
      expect((await getInvoiceStatus(invoiceA)).status).toBe("ready"); // eigene → ready
      expect((await getInvoiceStatus(invoiceB)).status).toBe("needs_review"); // fremde unverändert
    });

    it("ignore: fremde Rechnung bleibt unverändert", async () => {
      await ignoreInvoicesAction([invoiceB]);
      expect((await getInvoiceStatus(invoiceB)).status).toBe("needs_review");
    });
  });

  describe("toggleVendorHidden", () => {
    it("blockt Toggle eines Vendors aus fremder Org", async () => {
      const fd = new FormData();
      fd.set("vendorId", String(vendorB));
      fd.set("hidden", "1");
      await toggleVendorHiddenAction(fd);
      const after = await getVendorHidden(vendorB);
      expect(after).toBe(false);
    });

    it("erlaubt Toggle eines eigenen Vendors", async () => {
      const fd = new FormData();
      fd.set("vendorId", String(vendorA));
      fd.set("hidden", "1");
      await toggleVendorHiddenAction(fd);
      const after = await getVendorHidden(vendorA);
      expect(after).toBe(true);
    });
  });

  describe("removeOnlineAccount Cascade", () => {
    it("löscht NUR credential_refs der eigenen Org", async () => {
      const fd = new FormData();
      fd.set("vendorKey", vendorKey);
      await removeOnlineAccountAction(fd);
      expect(await credentialRefExists(credentialA)).toBe(false);
      expect(await credentialRefExists(credentialB)).toBe(true);
    });
  });
});
