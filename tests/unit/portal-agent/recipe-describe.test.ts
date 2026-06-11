import { describe, expect, it } from "vitest";
import { describeRecipeSteps } from "@/portals/agent/recipe-describe";
import type { Recipe } from "@/portals/agent/types";

// INFETCH-267 / AC3: Recipe als für Kund:innen lesbare Schritte —
// „diese Schritte, mehr nicht". Keine Selektoren, keine internen Wartezeiten,
// keine Credential-Werte.

const base: Recipe = {
  vendorKey: "enbw",
  loginUrl: "https://login.enbw.com/",
  loginFlow: [
    { type: "fill", selector: "#user", valueFrom: "credential.username" },
    { type: "fill", selector: "#pw", valueFrom: "credential.password" },
    { type: "click", selector: "#submit" },
    { type: "waitForUrl", pattern: "**/dashboard" },
  ],
  navigationFlow: [{ type: "click", selector: "#invoices" }],
  invoiceList: { rowSelector: ".row", downloadSelector: ".dl" },
};

describe("describeRecipeSteps", () => {
  it("erzeugt lesbare, credential-sichere Schritte", () => {
    const steps = describeRecipeSteps(base);

    expect(steps[0]).toContain("login.enbw.com");
    expect(steps).toContain("Trage den Benutzernamen ein");
    expect(steps).toContain("Trage das Passwort ein");
    expect(steps[steps.length - 1]).toContain("lade die PDF");

    const joined = steps.join(" ");
    expect(joined).not.toContain("#pw"); // keine Selektoren
    expect(joined).not.toContain("waitForUrl"); // keine internen Wartezeiten
  });

  it("nennt den 2FA-Schritt als automatisch", () => {
    const withTotp: Recipe = {
      ...base,
      loginFlow: [...base.loginFlow, { type: "fill", selector: "#otp", valueFrom: "totp" }],
    };
    expect(describeRecipeSteps(withTotp).some((s) => s.includes("2FA-Code"))).toBe(true);
  });

  it("fasst aufeinanderfolgende identische Klicks zusammen", () => {
    const manyClicks: Recipe = {
      ...base,
      loginFlow: [
        { type: "click", selector: "#a" },
        { type: "click", selector: "#b" },
        { type: "click", selector: "#c" },
      ],
      navigationFlow: [],
    };
    const clickLines = describeRecipeSteps(manyClicks).filter(
      (s) => s === "Klicke auf eine Schaltfläche",
    );
    expect(clickLines.length).toBe(1);
  });
});
