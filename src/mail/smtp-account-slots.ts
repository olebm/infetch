export const SMTP_ACCOUNT_SLOTS = [
  { ownerId: "primary", label: "SMTP Postfach 1" },
  { ownerId: "secondary", label: "SMTP Postfach 2" },
] as const;

export type SmtpCredentialOwnerId = (typeof SMTP_ACCOUNT_SLOTS)[number]["ownerId"];
