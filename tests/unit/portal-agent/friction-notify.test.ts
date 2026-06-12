import { describe, expect, it } from "vitest";
import {
  notifyPortalFrictionIfNeeded,
  type FrictionNotifyDeps,
} from "@/portals/agent/friction-notify";

// INFETCH-257: Dedup-Zustandsmaschine der Friktions-Benachrichtigung. DB-/Mail-Grenzen
// sind injiziert (In-Memory-Marker, Fake-Mailer) → reine Logik, kein DB/SMTP.

const ORG = "org-1";
const VK = "telekom";
const KEY = `portal_friction_notified_${ORG}_${VK}`;

function harness(overrides: Partial<FrictionNotifyDeps> = {}) {
  const markers = new Map<string, string | null>();
  const sent: Array<{ to: string; vendorName: string; status: string }> = [];
  const deps: Partial<FrictionNotifyDeps> = {
    readMarker: async (k) => (markers.has(k) ? (markers.get(k) ?? null) : null),
    writeMarker: async (k, v) => {
      markers.set(k, v);
    },
    resolveRecipient: async () => ({ email: "owner@example.com", name: "Max Muster" }),
    resolveVendorName: async (vk) => `Vendor ${vk}`,
    sendEmail: async (o) => {
      sent.push({ to: o.to, vendorName: o.vendorName, status: o.status });
      return true;
    },
    ...overrides,
  };
  return { deps, markers, sent };
}

describe("notifyPortalFrictionIfNeeded — Dedup-Zustandsmaschine", () => {
  it("benachrichtigt beim ersten Friktionsfall (Empfänger + Vendor-Name)", async () => {
    const { deps, sent } = harness();
    const out = await notifyPortalFrictionIfNeeded(
      { vendorKey: VK, organizationId: ORG, status: "login_required" },
      deps,
    );
    expect(out).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "owner@example.com",
      vendorName: "Vendor telekom",
      status: "login_required",
    });
  });

  it("dedupliziert denselben Friktions-Status (kein Spam alle 4h)", async () => {
    const { deps, sent } = harness();
    await notifyPortalFrictionIfNeeded(
      { vendorKey: VK, organizationId: ORG, status: "captcha" },
      deps,
    );
    const out = await notifyPortalFrictionIfNeeded(
      { vendorKey: VK, organizationId: ORG, status: "captcha" },
      deps,
    );
    expect(out).toBe("deduped");
    expect(sent).toHaveLength(1);
  });

  it("benachrichtigt erneut, wenn sich die Art der Friktion ändert", async () => {
    const { deps, sent } = harness();
    await notifyPortalFrictionIfNeeded(
      { vendorKey: VK, organizationId: ORG, status: "login_required" },
      deps,
    );
    const out = await notifyPortalFrictionIfNeeded(
      { vendorKey: VK, organizationId: ORG, status: "captcha" },
      deps,
    );
    expect(out).toBe("sent");
    expect(sent).toHaveLength(2);
  });

  it("setzt den Marker bei Erfolg zurück → späterer Friktionsfall meldet wieder", async () => {
    const { deps, sent } = harness();
    await notifyPortalFrictionIfNeeded(
      { vendorKey: VK, organizationId: ORG, status: "two_factor" },
      deps,
    );
    const reset = await notifyPortalFrictionIfNeeded(
      { vendorKey: VK, organizationId: ORG, status: "success" },
      deps,
    );
    expect(reset).toBe("reset");
    const again = await notifyPortalFrictionIfNeeded(
      { vendorKey: VK, organizationId: ORG, status: "two_factor" },
      deps,
    );
    expect(again).toBe("sent");
    expect(sent).toHaveLength(2);
  });

  it("ignoriert technische Fehler (recipe_broken) ohne Mail oder Marker-Reset", async () => {
    const { deps, markers, sent } = harness();
    await notifyPortalFrictionIfNeeded(
      { vendorKey: VK, organizationId: ORG, status: "captcha" },
      deps,
    );
    expect(markers.get(KEY)).toBe("captcha");
    const out = await notifyPortalFrictionIfNeeded(
      { vendorKey: VK, organizationId: ORG, status: "recipe_broken" },
      deps,
    );
    expect(out).toBe("skipped");
    expect(markers.get(KEY)).toBe("captcha"); // Marker unberührt
    expect(sent).toHaveLength(1);
  });

  it("überspringt, wenn kein Empfänger auflösbar ist (kein Marker gesetzt)", async () => {
    const { deps, markers, sent } = harness({ resolveRecipient: async () => null });
    const out = await notifyPortalFrictionIfNeeded(
      { vendorKey: VK, organizationId: ORG, status: "captcha" },
      deps,
    );
    expect(out).toBe("skipped");
    expect(sent).toHaveLength(0);
    expect(markers.size).toBe(0);
  });

  it("setzt den Marker NICHT, wenn der Mailversand fehlschlägt (Retry nächster Lauf)", async () => {
    const { deps, markers } = harness({ sendEmail: async () => false });
    const out = await notifyPortalFrictionIfNeeded(
      { vendorKey: VK, organizationId: ORG, status: "captcha" },
      deps,
    );
    expect(out).toBe("skipped");
    expect(markers.size).toBe(0);
  });

  it("no_invoices ohne vorherigen Marker → skipped (kein Reset-Effekt)", async () => {
    const { deps, sent } = harness();
    const out = await notifyPortalFrictionIfNeeded(
      { vendorKey: VK, organizationId: ORG, status: "no_invoices" },
      deps,
    );
    expect(out).toBe("skipped");
    expect(sent).toHaveLength(0);
  });
});
