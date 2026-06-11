import { describe, expect, it } from "vitest";
import {
  collectRecipeNavigationUrls,
  validateRecipeDomains,
} from "@/portals/agent/recipe-validate";
import type { Recipe } from "@/portals/agent/types";

// INFETCH-268: Community-Recipes beim Install gegen die Vendor-Domain-Allowlist
// validieren — Defense-in-Depth zur Laufzeit-Prüfung (#139).

function recipe(partial: Partial<Recipe>): Recipe {
  return {
    vendorKey: "enbw",
    loginUrl: "https://login.enbw.com/",
    loginFlow: [],
    navigationFlow: [],
    invoiceList: { rowSelector: ".row", downloadSelector: ".dl" },
    ...partial,
  };
}

describe("validateRecipeDomains", () => {
  it("lässt ein sauberes Recipe passieren (alles auf der Vendor-Domain)", () => {
    const r = recipe({
      loginFlow: [{ type: "goto", url: "https://login.enbw.com/auth" }],
      navigationFlow: [{ type: "goto", url: "https://www.enbw.com/rechnungen" }],
    });
    expect(validateRecipeDomains(r, "https://www.enbw.com/portal").ok).toBe(true);
  });

  it("lehnt ein goto auf eine fremde Domain ab und nennt die URL", () => {
    const r = recipe({
      navigationFlow: [{ type: "goto", url: "https://evil.example/steal" }],
    });
    const res = validateRecipeDomains(r, "https://www.enbw.com/portal");
    expect(res.ok).toBe(false);
    expect(res.violations).toContain("https://evil.example/steal");
  });

  it("fängt eine vergiftete loginUrl, wenn die vertrauenswürdige Vendor-URL bekannt ist", () => {
    const r = recipe({ loginUrl: "https://enbw.com.evil.example/login" });
    const res = validateRecipeDomains(r, "https://www.enbw.com/portal");
    expect(res.ok).toBe(false);
    expect(res.violations).toContain("https://enbw.com.evil.example/login");
  });

  it("fällt ohne Vendor-URL auf Selbst-Konsistenz zur recipe-loginUrl zurück", () => {
    const r = recipe({
      loginUrl: "https://login.enbw.com/",
      navigationFlow: [{ type: "goto", url: "https://evil.example/" }],
    });
    expect(validateRecipeDomains(r, null).ok).toBe(false);
  });
});

describe("collectRecipeNavigationUrls", () => {
  it("sammelt loginUrl + alle goto-URLs, ignoriert fill/click", () => {
    const r = recipe({
      loginFlow: [
        { type: "goto", url: "https://a.enbw.com/" },
        { type: "fill", selector: "#u", valueFrom: "credential.username" },
        { type: "click", selector: "#submit" },
      ],
      navigationFlow: [{ type: "goto", url: "https://b.enbw.com/" }],
    });
    expect(collectRecipeNavigationUrls(r)).toEqual([
      "https://login.enbw.com/",
      "https://a.enbw.com/",
      "https://b.enbw.com/",
    ]);
  });
});
