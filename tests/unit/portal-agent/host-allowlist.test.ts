import { describe, expect, it } from "vitest";
import { egressAllowed, hostAllowedForVendor } from "@/portals/agent/recipe-player";

// INFETCH-265: Replay darf nur auf die (vertrauenswürdige) Vendor-Domain
// navigieren. Schützt vor vergifteten Community-Recipes, die Credentials auf
// eine Fremd-Domain leiten würden.

const vendor = "https://www.enbw.com/meine-rechnungen";

describe("hostAllowedForVendor (Egress-Allowlist)", () => {
  it("erlaubt dieselbe Domain und Subdomains", () => {
    expect(hostAllowedForVendor("https://www.enbw.com/login", vendor)).toBe(true);
    expect(hostAllowedForVendor("https://login.enbw.com/", vendor)).toBe(true);
  });

  it("blockt fremde Domains (auch Look-alikes)", () => {
    expect(hostAllowedForVendor("https://evil.example/steal", vendor)).toBe(false);
    expect(hostAllowedForVendor("https://enbw.com.evil.example/", vendor)).toBe(false);
  });

  it("behandelt zweistufige TLDs korrekt (co.uk)", () => {
    const v = "https://portal.kunde.co.uk/";
    expect(hostAllowedForVendor("https://login.kunde.co.uk/", v)).toBe(true);
    expect(hostAllowedForVendor("https://kunde.co.uk.evil.example/", v)).toBe(false);
  });

  it("ohne Vendor-URL nicht erzwingbar (true); unparsebares Ziel → false", () => {
    expect(hostAllowedForVendor("https://anything.example/", null)).toBe(true);
    expect(hostAllowedForVendor("not-a-url", vendor)).toBe(false);
  });
});

// INFETCH-273: egressAllowed ist die Laufzeit-Variante — wird für den goto-Pre-
// Check UND den Post-Navigations-Recheck (Redirect/Click) genutzt und ist
// fail-closed: ohne vertrauenswürdige Vendor-URL keine Navigation.
describe("egressAllowed (Laufzeit, fail-closed)", () => {
  it("erlaubt die Vendor-Domain und Subdomains", () => {
    expect(egressAllowed("https://login.enbw.com/", vendor)).toBe(true);
  });

  it("blockt ein fremdes Redirect-/Navigations-Ziel", () => {
    expect(egressAllowed("https://evil.example/steal", vendor)).toBe(false);
    expect(egressAllowed("https://enbw.com.evil.example/", vendor)).toBe(false);
  });

  it("ist fail-closed ohne Vendor-URL (Kontrast: hostAllowedForVendor ist fail-open)", () => {
    expect(egressAllowed("https://anything.example/", null)).toBe(false);
    expect(egressAllowed("https://anything.example/", undefined)).toBe(false);
    expect(egressAllowed("https://anything.example/", "")).toBe(false);
    expect(hostAllowedForVendor("https://anything.example/", null)).toBe(true);
  });

  it("blockt interne/IP-Ziele (SSRF), da nicht die Vendor-Domain", () => {
    expect(egressAllowed("http://169.254.169.254/latest/meta-data/", vendor)).toBe(false);
    expect(egressAllowed("http://127.0.0.1:8080/", vendor)).toBe(false);
    expect(egressAllowed("http://[::1]/", vendor)).toBe(false);
  });

  it("blockt unparsebare Ziele", () => {
    expect(egressAllowed("not-a-url", vendor)).toBe(false);
  });
});
