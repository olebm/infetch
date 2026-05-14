export type EmailProvider = {
  domains: string[];
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  label: string;
};

export const EMAIL_PROVIDERS: EmailProvider[] = [
  {
    label: "Gmail",
    domains: ["gmail.com", "googlemail.com"],
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
  },
  {
    label: "GMX",
    domains: ["gmx.de", "gmx.net", "gmx.at", "gmx.ch", "gmx.com"],
    imapHost: "imap.gmx.net",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "mail.gmx.net",
    smtpPort: 465,
    smtpSecure: true,
  },
  {
    label: "WEB.DE",
    domains: ["web.de"],
    imapHost: "imap.web.de",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.web.de",
    smtpPort: 465,
    smtpSecure: true,
  },
  {
    label: "Outlook / Microsoft 365",
    domains: ["outlook.com", "outlook.de", "hotmail.com", "live.com", "msn.com"],
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp-mail.outlook.com",
    smtpPort: 587,
    smtpSecure: false,
  },
  {
    label: "T-Online",
    domains: ["t-online.de", "magenta.de"],
    imapHost: "secureimap.t-online.de",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "securesmtp.t-online.de",
    smtpPort: 465,
    smtpSecure: true,
  },
  {
    label: "Hostinger",
    domains: ["hostinger.com"],
    imapHost: "imap.hostinger.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.hostinger.com",
    smtpPort: 465,
    smtpSecure: true,
  },
  {
    label: "Apple iCloud",
    domains: ["icloud.com", "me.com", "mac.com"],
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    smtpSecure: false,
  },
  {
    label: "Yahoo",
    domains: ["yahoo.com", "yahoo.de", "ymail.com"],
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 465,
    smtpSecure: true,
  },
];

export function detectEmailProvider(email: string): EmailProvider | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase();
  return EMAIL_PROVIDERS.find((p) => p.domains.includes(domain)) ?? null;
}
