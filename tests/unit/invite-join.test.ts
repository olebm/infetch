import { describe, expect, it } from "vitest";
import { resolveInviteJoin } from "@/lib/auth/users";

// INFETCH-270: user_metadata ist beim Signup client-kontrolliert
// (supabase.auth.signInWithOtp({ options: { data } }) mit dem öffentlichen
// Anon-Key). resolveInviteJoin ist die reine Sicherheits-Entscheidung, ob ein
// frisch provisionierter User einer EINGELADENEN Org beitritt. Zwei Invarianten
// halten die Tenant-Grenze, unabhängig davon was im Metadata steht:
//   1. Ohne server-seitig belegten Invite (genuineInvite=false) NIE ein Join.
//   2. "owner" wird NIE aus Metadata übernommen (max. admin/member).
describe("resolveInviteJoin (INFETCH-270)", () => {
  it("verweigert den Join ohne echten Invite — selbst mit owner-Metadata (der Angriff)", () => {
    expect(
      resolveInviteJoin({ invited_org_id: "victim-org", invited_role: "owner" }, false),
    ).toEqual({ join: false });
  });

  it("verweigert den Join bei fehlender/leerer org-id trotz echtem Invite", () => {
    expect(resolveInviteJoin({ invited_role: "admin" }, true)).toEqual({ join: false });
    expect(resolveInviteJoin({ invited_org_id: "" }, true)).toEqual({ join: false });
  });

  it("verweigert den Join, wenn invited_org_id kein String ist (Injection-Schutz)", () => {
    expect(resolveInviteJoin({ invited_org_id: 123 }, true)).toEqual({ join: false });
    expect(resolveInviteJoin({ invited_org_id: { sub: "x" } }, true)).toEqual({ join: false });
  });

  it("kappt owner aus Metadata auf member — auch bei echtem Invite", () => {
    expect(resolveInviteJoin({ invited_org_id: "org-1", invited_role: "owner" }, true)).toEqual({
      join: true,
      organizationId: "org-1",
      role: "member",
    });
  });

  it("übernimmt admin nur bei echtem Invite", () => {
    expect(resolveInviteJoin({ invited_org_id: "org-1", invited_role: "admin" }, true)).toEqual({
      join: true,
      organizationId: "org-1",
      role: "admin",
    });
  });

  it("defaultet auf member ohne Rollenangabe", () => {
    expect(resolveInviteJoin({ invited_org_id: "org-1" }, true)).toEqual({
      join: true,
      organizationId: "org-1",
      role: "member",
    });
  });
});
