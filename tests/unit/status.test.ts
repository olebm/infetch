import { describe, expect, it } from "vitest";
import { resolveVendorMonthStatus, shouldRunPortalFallback } from "@/invoices/status";

describe("vendor month status", () => {
  it("prioritizes manual over mail and portal", () => {
    expect(
      resolveVendorMonthStatus({
        manualStatus: "imported",
        mailStatus: "found",
        portalStatus: "found",
      }),
    ).toEqual({ finalStatus: "found", sourceUsed: "manual" });
  });

  it("skips portal fallback when mail found an invoice", () => {
    expect(
      shouldRunPortalFallback({
        manualStatus: "none",
        mailStatus: "found",
        portalStatus: "required",
      }),
    ).toBe(false);
  });

  it("allows a not_found portal month to be retried manually", () => {
    expect(
      shouldRunPortalFallback({
        manualStatus: "none",
        mailStatus: "missing",
        portalStatus: "not_found",
      }),
    ).toBe(true);
  });
});
