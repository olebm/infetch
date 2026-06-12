import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// INFETCH-289: Pro-Test-Override. Im Free-only-Launch (proEnabled aus) gelten nur
// explizit in PRO_TEST_ORG_IDS gelistete Orgs als Pro. Der Override-Pfad in
// getOrgTier kehrt VOR dem DB-Lookup zurück → kein DB-Zugriff nötig. appConfig liest
// die Env beim Modul-Load, daher pro Fall resetModules + frischer Import.

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

async function loadGetOrgTier() {
  vi.resetModules();
  return (await import("@/lib/tier")).getOrgTier;
}

describe("getOrgTier — Pro-Test-Override (INFETCH-289)", () => {
  beforeEach(() => {
    // Free-only-Clamp aktiv halten (proEnabled aus).
    vi.stubEnv("NEXT_PUBLIC_PRO_ENABLED", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("gelistete Org → pro trotz Free-only-Clamp", async () => {
    vi.stubEnv("PRO_TEST_ORG_IDS", `${ORG}, ${OTHER}`);
    const getOrgTier = await loadGetOrgTier();
    expect(await getOrgTier(ORG)).toBe("pro");
  });

  it("nicht-gelistete Org → free (Clamp hält)", async () => {
    vi.stubEnv("PRO_TEST_ORG_IDS", OTHER);
    const getOrgTier = await loadGetOrgTier();
    expect(await getOrgTier(ORG)).toBe("free");
  });

  it("ohne PRO_TEST_ORG_IDS → free", async () => {
    vi.stubEnv("PRO_TEST_ORG_IDS", "");
    const getOrgTier = await loadGetOrgTier();
    expect(await getOrgTier(ORG)).toBe("free");
  });

  it("null orgId → free (kein Override ohne Org)", async () => {
    vi.stubEnv("PRO_TEST_ORG_IDS", ORG);
    const getOrgTier = await loadGetOrgTier();
    expect(await getOrgTier(null)).toBe("free");
  });
});
