import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db/client";

// Regressionstest für Mandanten-Isolation: der App-Pfad nutzt den
// service_role-Client und umgeht RLS — die Trennung hängt also am
// `organization_id`-Filter im Route-Code. Dieser Test fixiert den Kontrakt:
// Org A darf eine Datei von Org B niemals abrufen.

const SUFFIX = `${Date.now()}`;
const ORG_A = `org-a-iso-${SUFFIX}`;
const ORG_B = `org-b-iso-${SUFFIX}`;
const USER_A = `user-a-iso-${SUFFIX}`;
const USER_B = `user-b-iso-${SUFFIX}`;

const hasDb = Boolean(process.env.DATABASE_URL);

// getCurrentAuth → immer Org A (der "angemeldete" Mandant).
vi.mock("@/lib/auth/current", () => ({
  getCurrentAuth: async () => ({
    session: {},
    user: { id: USER_A },
    organization: { id: ORG_A, name: "Org A", slug: "org-a", tier: "pro", ownerUserId: USER_A },
  }),
}));

// Storage nicht real ansprechen — Inhalt ist für den Isolations-Check egal.
vi.mock("@/lib/supabase/storage", () => ({
  BUCKETS: { INVOICES: "invoices", RAW_TEXT: "raw-text", PORTAL_SESSIONS: "portal-sessions" },
  downloadFromStorage: async () => Buffer.from("%PDF-1.7 stub"),
  // Inhalts-Integrität ist hier nicht Gegenstand (Org-Isolation wird getestet);
  // das sha256-Gate ist separat in storage-key.test.ts abgedeckt.
  pdfContentMatches: () => true,
}));

import { GET } from "@/app/api/invoice-files/[fileId]/route";

async function seedOrgWithFile(orgId: string, userId: string): Promise<number> {
  await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${`${userId}@iso.local`}, 'Iso') ON CONFLICT DO NOTHING`;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${orgId}, ${orgId}, ${orgId}, 'pro', ${userId})
    ON CONFLICT DO NOTHING
  `;
  const [inv] = await sql<{ id: number }[]>`
    INSERT INTO invoices (organization_id, source, status, confidence, dedupe_key)
    VALUES (${orgId}, 'manual', 'ready', 0.9, ${`iso-${orgId}-${Math.random()}`})
    RETURNING id
  `;
  const [file] = await sql<{ id: number }[]>`
    INSERT INTO invoice_files (invoice_id, original_filename, stored_path, sha256, size_bytes, mime_type, source_type)
    VALUES (${inv.id}, 'invoice.pdf', ${`${orgId}/invoice.pdf`}, ${`sha-${orgId}-${SUFFIX}`}, 100, 'application/pdf', 'manual')
    RETURNING id
  `;
  return file.id;
}

async function cleanup() {
  await sql`DELETE FROM invoice_files WHERE sha256 LIKE ${`sha-%-${SUFFIX}`}`;
  await sql`DELETE FROM invoices WHERE organization_id IN (${ORG_A}, ${ORG_B})`;
  await sql`DELETE FROM organizations WHERE id IN (${ORG_A}, ${ORG_B})`;
  await sql`DELETE FROM users WHERE id IN (${USER_A}, ${USER_B})`;
}

function call(fileId: number) {
  return GET({} as never, { params: Promise.resolve({ fileId: String(fileId) }) });
}

describe.skipIf(!hasDb)("tenant isolation — invoice file download", () => {
  let fileA = 0;
  let fileB = 0;

  beforeEach(async () => {
    await cleanup();
    fileA = await seedOrgWithFile(ORG_A, USER_A);
    fileB = await seedOrgWithFile(ORG_B, USER_B);
  });
  afterEach(cleanup);

  it("serves a file that belongs to the caller's org", async () => {
    const res = await call(fileA);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  it("returns 404 for a file belonging to a different org (no cross-tenant leak)", async () => {
    const res = await call(fileB);
    expect(res.status).toBe(404);
  });
});
