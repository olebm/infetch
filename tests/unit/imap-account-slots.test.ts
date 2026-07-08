import { describe, expect, it } from "vitest";
import { IMAP_MAIL_ACCOUNT_SLOTS, imapCredentialOwnerIdForLabel } from "@/mail/imap-account-slots";

/**
 * IMAP_MAIL_ACCOUNT_SLOTS ist die Single-Source-of-Truth für die Empfangs-
 * Postfächer: Scanner (listConfiguredImapAccounts), Persist-Actions und die
 * Einstellungen-UI leiten sich daraus ab. Pro erlaubt 3 Postfächer
 * (TIER_LIMITS.pro.maxMailAccounts) — dieser Test fixiert, dass auch 3 Slots
 * existieren, damit die Preistabelle und die Realität nicht wieder auseinander-
 * laufen (INFETCH-290).
 */
describe("IMAP mailbox slots", () => {
  it("defines exactly three receiving slots (Pro = 3 Postfächer)", () => {
    expect(IMAP_MAIL_ACCOUNT_SLOTS).toHaveLength(3);
    expect(IMAP_MAIL_ACCOUNT_SLOTS.map((s) => s.ownerId)).toEqual([
      "primary",
      "secondary",
      "tertiary",
    ]);
    expect(IMAP_MAIL_ACCOUNT_SLOTS.map((s) => s.label)).toEqual([
      "Primary IMAP",
      "Secondary IMAP",
      "Tertiary IMAP",
    ]);
  });

  it("maps each slot label back to its credential owner id", () => {
    expect(imapCredentialOwnerIdForLabel("Primary IMAP")).toBe("primary");
    expect(imapCredentialOwnerIdForLabel("Secondary IMAP")).toBe("secondary");
    expect(imapCredentialOwnerIdForLabel("Tertiary IMAP")).toBe("tertiary");
    expect(imapCredentialOwnerIdForLabel("Unknown IMAP")).toBeUndefined();
  });
});
