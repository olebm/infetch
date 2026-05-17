// Preset IMAP/SMTP-Konfigurationen für gängige Mailanbieter.
// Einzige Quelle für Provider-Daten — wird in allen Mailbox-Setup-UIs verwendet.

export type MailProvider = {
  id: string;
  name: string;
  domain: string;            // für Logo-Anzeige via Brandfetch
  domains: string[];         // alle bekannten E-Mail-Domains (für Auto-Erkennung)
  hint?: string;             // UX-Hinweis für den User (z. B. "App-Passwort nötig")
  appPasswordUrl?: string;   // Direkt-Link zur App-Passwort-Seite des Anbieters
  imap: {
    host: string;
    port: number;
    secure: boolean;
  };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
  };
};

export const MAIL_PROVIDERS: MailProvider[] = [
  {
    id: "gmail",
    name: "Gmail",
    domain: "gmail.com",
    domains: ["gmail.com", "googlemail.com"],
    hint: "Gmail erfordert ein App-Passwort — kein normales Google-Passwort funktioniert hier.",
    appPasswordUrl: "https://myaccount.google.com/apppasswords",
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
  },
  {
    id: "outlook",
    name: "Outlook",
    domain: "outlook.com",
    domains: ["outlook.com", "outlook.de", "hotmail.com", "live.com", "msn.com"],
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    smtp: { host: "smtp-mail.outlook.com", port: 587, secure: false },
  },
  {
    id: "icloud",
    name: "iCloud",
    domain: "icloud.com",
    domains: ["icloud.com", "me.com", "mac.com"],
    hint: "iCloud erfordert ein App-Passwort unter appleid.apple.com.",
    appPasswordUrl: "https://appleid.apple.com/account/manage",
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
  },
  {
    id: "yahoo",
    name: "Yahoo",
    domain: "yahoo.com",
    domains: ["yahoo.com", "yahoo.de", "ymail.com"],
    hint: "Yahoo erfordert ein App-Passwort in den Sicherheitseinstellungen.",
    appPasswordUrl: "https://login.yahoo.com/account/security",
    imap: { host: "imap.mail.yahoo.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
  },
  {
    id: "gmx",
    name: "GMX",
    domain: "gmx.net",
    domains: ["gmx.de", "gmx.net", "gmx.at", "gmx.ch", "gmx.com"],
    imap: { host: "imap.gmx.net", port: 993, secure: true },
    smtp: { host: "mail.gmx.net", port: 465, secure: true },
  },
  {
    id: "webde",
    name: "web.de",
    domain: "web.de",
    domains: ["web.de"],
    imap: { host: "imap.web.de", port: 993, secure: true },
    smtp: { host: "smtp.web.de", port: 465, secure: true },
  },
  {
    id: "tonline",
    name: "Telekom",
    domain: "t-online.de",
    domains: ["t-online.de", "magenta.de"],
    imap: { host: "secureimap.t-online.de", port: 993, secure: true },
    smtp: { host: "securesmtp.t-online.de", port: 465, secure: true },
  },
  {
    id: "mailboxorg",
    name: "Mailbox.org",
    domain: "mailbox.org",
    domains: ["mailbox.org"],
    imap: { host: "imap.mailbox.org", port: 993, secure: true },
    smtp: { host: "smtp.mailbox.org", port: 465, secure: true },
  },
  {
    id: "fastmail",
    name: "Fastmail",
    domain: "fastmail.com",
    domains: ["fastmail.com", "fastmail.fm"],
    imap: { host: "imap.fastmail.com", port: 993, secure: true },
    smtp: { host: "smtp.fastmail.com", port: 465, secure: true },
  },
  {
    id: "posteo",
    name: "Posteo",
    domain: "posteo.de",
    domains: ["posteo.de", "posteo.net"],
    imap: { host: "posteo.de", port: 993, secure: true },
    smtp: { host: "posteo.de", port: 465, secure: true },
  },
  {
    id: "ionos",
    name: "IONOS",
    domain: "ionos.de",
    domains: ["ionos.de", "ionos.com", "1und1.de", "1und1.com"],
    imap: { host: "imap.ionos.de", port: 993, secure: true },
    smtp: { host: "smtp.ionos.de", port: 465, secure: true },
  },
  {
    id: "strato",
    name: "Strato",
    domain: "strato.de",
    domains: ["strato.de"],
    imap: { host: "imap.strato.de", port: 993, secure: true },
    smtp: { host: "smtp.strato.de", port: 465, secure: true },
  },
  {
    id: "freenet",
    name: "Freenet",
    domain: "freenet.de",
    domains: ["freenet.de"],
    imap: { host: "mx.freenet.de", port: 993, secure: true },
    smtp: { host: "mx.freenet.de", port: 465, secure: true },
  },
  {
    id: "zoho",
    name: "Zoho Mail",
    domain: "zoho.com",
    domains: ["zoho.com", "zoho.eu", "zohomail.com"],
    imap: { host: "imap.zoho.eu", port: 993, secure: true },
    smtp: { host: "smtp.zoho.eu", port: 465, secure: true },
  },
  {
    id: "protonmail",
    name: "Proton Mail",
    domain: "proton.me",
    domains: ["proton.me", "protonmail.com", "pm.me"],
    hint: "Proton Mail benötigt die Proton Mail Bridge — eine lokale App die IMAP für externe Clients freischaltet.",
    appPasswordUrl: "https://proton.me/mail/bridge",
    imap: { host: "127.0.0.1", port: 1143, secure: false },
    smtp: { host: "127.0.0.1", port: 1025, secure: false },
  },
];

/**
 * Backend-Vorlagen für benutzerdefinierte Domains (z. B. @company.com).
 * Wenn die E-Mail-Domain nicht automatisch erkannt wird, kann der User
 * hier seinen Dienst wählen — die Server-Daten werden dann vorausgefüllt.
 */
export type MailBackend = Omit<MailProvider, "domains">;

export const MAIL_BACKENDS: MailBackend[] = [
  {
    id: "google-workspace",
    name: "Google Workspace",
    domain: "google.com",
    hint: "Google Workspace erfordert ein App-Passwort — kein normales Google-Passwort.",
    appPasswordUrl: "https://myaccount.google.com/apppasswords",
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
  },
  {
    id: "microsoft-365",
    name: "Microsoft 365",
    domain: "microsoft.com",
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    smtp: { host: "smtp-mail.outlook.com", port: 587, secure: false },
  },
  {
    id: "ionos-hosting",
    name: "IONOS Hosting",
    domain: "ionos.de",
    imap: { host: "imap.ionos.de", port: 993, secure: true },
    smtp: { host: "smtp.ionos.de", port: 465, secure: true },
  },
  {
    id: "strato-hosting",
    name: "Strato Hosting",
    domain: "strato.de",
    imap: { host: "imap.strato.de", port: 993, secure: true },
    smtp: { host: "smtp.strato.de", port: 465, secure: true },
  },
  {
    id: "zoho-hosting",
    name: "Zoho Mail",
    domain: "zoho.com",
    imap: { host: "imap.zoho.eu", port: 993, secure: true },
    smtp: { host: "smtp.zoho.eu", port: 465, secure: true },
  },
];

/**
 * Erkennt den Mail-Provider anhand der E-Mail-Domain.
 * Gibt null zurück wenn kein bekannter Anbieter — dann müssen Server manuell eingetragen werden.
 */
export function getProviderFromEmail(email: string): MailProvider | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase();
  return MAIL_PROVIDERS.find((p) => p.domains.includes(domain)) ?? null;
}

// Export-Ziele: Wohin Rechnungen verschickt werden (Steuersoftware / Buchhaltung).
// emailPattern "fixed" = feste Adresse für alle User.
// emailPattern "user_specific" = jeder User hat seine eigene Adresse.
export type ExportTarget = {
  id: string;
  name: string;
  domain: string; // für Logo
  email: string; // leer wenn user_specific
  description: string;
  placeholder?: string; // Hint für das E-Mail-Feld
  emailPattern: "fixed" | "user_specific";
};

export const EXPORT_TARGETS: ExportTarget[] = [
  {
    id: "kontist",
    name: "Kontist",
    domain: "kontist.com",
    email: "receipts@kontist.com",
    description: "Belege direkt an Kontist weiterleiten",
    emailPattern: "fixed",
  },
  {
    id: "accountable",
    name: "Accountable",
    domain: "accountable.eu",
    email: "expenses@accountable.eu",
    description: "Ausgaben an Accountable senden",
    emailPattern: "fixed",
  },
  {
    id: "lexoffice",
    name: "Lexoffice",
    domain: "lexoffice.de",
    email: "",
    description: "Persönliche Lexoffice-Inbox",
    placeholder: "vorname.nachname@inbox.lexware.email",
    emailPattern: "user_specific",
  },
  {
    id: "sevdesk",
    name: "sevDesk",
    domain: "sevdesk.de",
    email: "autobox@sevdesk.email",
    description: "AutoBox für automatischen Belegimport",
    emailPattern: "fixed",
  },
];
