import { afterEach, describe, expect, it, vi } from "vitest";

// INFETCH-269 Layer 2: PORTAL_EGRESS_PROXY zwingt den Portal-Browser durch den
// Egress-Proxy (Squid auf der Worker-Box). Der Hook ist bewusst env-gated:
// ohne Variable bleibt das Verhalten exakt wie vorher (direkter Egress) — das
// sichert dieser Test ab, damit der Merge VOR der Squid-Infra gefahrlos ist.
// appConfig wird beim Import berechnet → pro Test frisch importieren.
describe("appConfig.portalAgent.egressProxy (INFETCH-269)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("ohne PORTAL_EGRESS_PROXY: null → kein proxy-Argument, Verhalten unverändert", async () => {
    vi.stubEnv("PORTAL_EGRESS_PROXY", "");
    vi.resetModules();
    const { appConfig } = await import("@/lib/config/env");
    expect(appConfig.portalAgent.egressProxy).toBeNull();
  });

  it("mit PORTAL_EGRESS_PROXY: liefert den Proxy-Server (getrimmt)", async () => {
    vi.stubEnv("PORTAL_EGRESS_PROXY", " http://127.0.0.1:3128 ");
    vi.resetModules();
    const { appConfig } = await import("@/lib/config/env");
    expect(appConfig.portalAgent.egressProxy).toBe("http://127.0.0.1:3128");
  });
});
