import { describe, expect, it } from "vitest";
import { hostAllowedForVendor } from "@/portals/agent/recipe-player";

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
