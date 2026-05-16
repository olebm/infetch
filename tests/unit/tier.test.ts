import { afterEach, describe, expect, it } from "vitest";
import { getEnvTier, getLimits, getScanSinceDate, TIER_LIMITS } from "@/lib/tier";

// ── Pure Funktionen (kein DB nötig) ──────────────────────────────────────────

describe("getEnvTier", () => {
  const original = process.env.INVOICE_AGENT_TIER;

  afterEach(() => {
    if (original === undefined) delete process.env.INVOICE_AGENT_TIER;
    else process.env.INVOICE_AGENT_TIER = original;
  });

  it("gibt 'free' zurück wenn env nicht gesetzt", () => {
    delete process.env.INVOICE_AGENT_TIER;
    expect(getEnvTier()).toBe("free");
  });

  it("gibt 'pro' zurück bei INVOICE_AGENT_TIER=pro", () => {
    process.env.INVOICE_AGENT_TIER = "pro";
    expect(getEnvTier()).toBe("pro");
  });

  it("gibt 'business' zurück bei INVOICE_AGENT_TIER=business", () => {
    process.env.INVOICE_AGENT_TIER = "business";
    expect(getEnvTier()).toBe("business");
  });

  it("fällt auf 'free' zurück bei unbekanntem Wert", () => {
    process.env.INVOICE_AGENT_TIER = "enterprise";
    expect(getEnvTier()).toBe("free");
  });

  it("trimmt Whitespace", () => {
    process.env.INVOICE_AGENT_TIER = "  pro  ";
    expect(getEnvTier()).toBe("pro");
  });
});

describe("getLimits / TIER_LIMITS", () => {
  it("Free-Tier: 15 Rechnungen/Monat, 500 MB, kein Export, keine Bulk-Downloads", () => {
    const limits = getLimits("free");
    expect(limits.maxInvoicesPerMonth).toBe(15);
    expect(limits.maxStorageBytes).toBe(500 * 1024 * 1024);
    expect(limits.exportEnabled).toBe(false);
    expect(limits.bulkDownloadEnabled).toBe(false);
    expect(limits.retroactiveScanEnabled).toBe(false);
    expect(limits.maxMailAccounts).toBe(1);
    expect(limits.priceMonthlyEur).toBe(0);
  });

  it("Pro-Tier: 150 Rechnungen/Monat, 2 GB, Export aktiv", () => {
    const limits = getLimits("pro");
    expect(limits.maxInvoicesPerMonth).toBe(150);
    expect(limits.maxStorageBytes).toBe(2 * 1024 * 1024 * 1024);
    expect(limits.exportEnabled).toBe(true);
    expect(limits.bulkDownloadEnabled).toBe(true);
    expect(limits.retroactiveScanEnabled).toBe(true);
    expect(limits.maxMailAccounts).toBe(3);
    expect(limits.priceMonthlyEur).toBe(19);
  });

  it("Business-Tier: unbegrenzte Rechnungen, Export + Datev aktiv", () => {
    const limits = getLimits("business");
    expect(limits.maxInvoicesPerMonth).toBe(Number.POSITIVE_INFINITY);
    expect(limits.exportEnabled).toBe(true);
    expect(limits.datevExportEnabled).toBe(true);
    expect(limits.maxMailAccounts).toBe(Number.POSITIVE_INFINITY);
  });

  it("autoApproval ist für alle Tiers aktiv", () => {
    expect(TIER_LIMITS.free.autoApprovalEnabled).toBe(true);
    expect(TIER_LIMITS.pro.autoApprovalEnabled).toBe(true);
    expect(TIER_LIMITS.business.autoApprovalEnabled).toBe(true);
  });
});

describe("getScanSinceDate", () => {
  it("Free-Tier: gibt ersten Tag des aktuellen Monats zurück", () => {
    const result = getScanSinceDate("free", 6);
    const now = new Date();
    expect(result.getFullYear()).toBe(now.getFullYear());
    expect(result.getMonth()).toBe(now.getMonth());
    expect(result.getDate()).toBe(1);
  });

  it("Pro-Tier: gibt Datum 6 Monate zurück (syncMonthsBack=6)", () => {
    const result = getScanSinceDate("pro", 6);
    const expected = new Date();
    expected.setMonth(expected.getMonth() - 6);
    // Auf Monat-Ebene vergleichen (Tagesgenauigkeit nicht nötig)
    expect(result.getFullYear()).toBe(expected.getFullYear());
    expect(result.getMonth()).toBe(expected.getMonth());
  });

  it("Pro-Tier: gibt Datum 12 Monate zurück (syncMonthsBack=12)", () => {
    const result = getScanSinceDate("pro", 12);
    const expected = new Date();
    expected.setMonth(expected.getMonth() - 12);
    expect(result.getFullYear()).toBe(expected.getFullYear());
    expect(result.getMonth()).toBe(expected.getMonth());
  });

  it("Business-Tier: verhält sich wie Pro", () => {
    const pro = getScanSinceDate("pro", 3);
    const business = getScanSinceDate("business", 3);
    expect(business.getFullYear()).toBe(pro.getFullYear());
    expect(business.getMonth()).toBe(pro.getMonth());
  });
});
