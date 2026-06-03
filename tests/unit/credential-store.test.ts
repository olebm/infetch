import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import {
  buildSecretRef,
  hasConfiguredCredential,
  maskIdentifier,
} from "@/lib/secrets/credential-store";

// NOTE: hasConfiguredCredential now uses the global postgres sql client.
// Tests that query credential_refs require a real Postgres connection.

describe("credential store metadata", () => {
  it("builds stable secret refs without leaking owner identifiers", () => {
    const ref = buildSecretRef("imap", "rechnung@example.com");

    expect(ref).toBe(buildSecretRef("imap", "rechnung@example.com"));
    expect(ref).toMatch(/^invoice-agent:imap:[a-f0-9]{16}$/);
    expect(ref).not.toContain("rechnung");
    expect(ref).not.toContain("example.com");
  });

  it("produces distinct refs for different organizations (cross-tenant isolation)", () => {
    // Regression for MULTITENANCY_HARDENING_PLAN.md 1.2 — without an
    // organizationId, two orgs sharing the same scope+ownerId would collide
    // on a single shared secret. With organizationId woven in, the hash
    // differs deterministically.
    const refOrgA = buildSecretRef("lexoffice", "default", "org-A");
    const refOrgB = buildSecretRef("lexoffice", "default", "org-B");
    const refNoOrg = buildSecretRef("lexoffice", "default");

    expect(refOrgA).not.toBe(refOrgB);
    expect(refOrgA).not.toBe(refNoOrg);
    expect(refOrgB).not.toBe(refNoOrg);

    // Stable per org (same inputs → same ref)
    expect(buildSecretRef("lexoffice", "default", "org-A")).toBe(refOrgA);
  });

  it("masks visible identifiers", () => {
    expect(maskIdentifier("rechnung@example.com")).toBe("re***@example.com");
    expect(maskIdentifier("abcdef")).toBe("ab***ef");
  });

  it("detects configured credential refs without reading the secret", async () => {
    const secretRef = buildSecretRef("imap", "primary-test");

    await sql`
      INSERT INTO credential_refs (scope, owner_id, label, secret_store, secret_ref, status)
      VALUES ('imap', 'primary-test', 'Primary IMAP Password Test', 'os_keychain', ${secretRef}, 'configured')
      ON CONFLICT DO NOTHING
    `;

    expect(await hasConfiguredCredential("imap", "primary-test")).toBe(true);
    expect(await hasConfiguredCredential("smtp", "primary-test")).toBe(false);

    // Cleanup
    await sql`DELETE FROM credential_refs WHERE owner_id = 'primary-test'`;
  });
});
