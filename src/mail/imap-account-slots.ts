/** Fixed IMAP slots: each has a stable DB label and OS-keychain credential owner id. */
export const IMAP_MAIL_ACCOUNT_SLOTS = [
  { label: "Primary IMAP" as const, ownerId: "primary" as const },
  { label: "Secondary IMAP" as const, ownerId: "secondary" as const },
  { label: "Tertiary IMAP" as const, ownerId: "tertiary" as const },
] as const;

export type ImapMailAccountLabel = (typeof IMAP_MAIL_ACCOUNT_SLOTS)[number]["label"];
export type ImapCredentialOwnerId = (typeof IMAP_MAIL_ACCOUNT_SLOTS)[number]["ownerId"];

const ownerByLabel = new Map<string, string>(
  IMAP_MAIL_ACCOUNT_SLOTS.map((slot) => [slot.label, slot.ownerId]),
);

export function imapCredentialOwnerIdForLabel(label: string): ImapCredentialOwnerId | undefined {
  const owner = ownerByLabel.get(label);
  return owner as ImapCredentialOwnerId | undefined;
}
