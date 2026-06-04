/**
 * Hintergrund-Bibliothek zur Hoster-Erkennung per MX-Record.
 *
 * Für eigene Domains (z. B. info@firma.de) verrät der MX-Record, wer die Mails
 * verwaltet. Aus dem erkannten Hoster leiten wir IMAP/SMTP-Server + Ports ab und
 * zeigen dem User nur noch, was wir NICHT selbst wissen können (Progressive
 * Disclosure). Ersetzt den früheren Anbieter-Picker (Button-Liste) durch
 * Erkennung im Hintergrund — der User wählt keinen Anbieter mehr aus.
 *
 * Alle Werte gegen die offizielle Hoster-Doku verifiziert (Stand 2026-06).
 * IMAP: 993 (implizites SSL/TLS). SMTP: 587 (STARTTLS) — NICHT 465 (SSL), weil
 * viele Server-Umgebungen Port 465 ausgehend sperren (u. a. Hetzner, wo Infetch
 * läuft: 587 offen, 465 blockiert). 587 ist der Standard-Submission-Port und
 * wird von allen gelisteten Hostern unterstützt.
 *
 * hostSource bestimmt, woher der konkrete Server-Hostname kommt:
 *  - "fixed"    → fester Server für alle Kunden (steht in imap/smtp.host)
 *  - "mxTarget" → der MX-Hostname IST der Mailserver (webgo, All-Inkl)
 *  - "domain"   → Server = "mail." + E-Mail-Domain (netcup)
 *  - "user"     → kundenspezifisch, nicht ableitbar → User trägt ihn ein
 */

export type HostSource = "fixed" | "mxTarget" | "domain" | "user";

export type MailHoster = {
  id: string;
  name: string;
  domain: string; // für Logo-Anzeige via Brandfetch
  /** Substrings, die im MX-Hostnamen (lowercase) gesucht werden. */
  mxPatterns: string[];
  hostSource: HostSource;
  /** host nur bei hostSource "fixed" gesetzt; sonst zur Laufzeit abgeleitet. */
  imap: { host?: string; port: number; secure: boolean };
  smtp: { host?: string; port: number; secure: boolean };
  hint?: string;
  appPasswordUrl?: string;
  /**
   * Gesetzt, wenn eine Verbindung per Passwort nicht (mehr) möglich ist —
   * z. B. Microsoft 365 (Basic Auth abgeschaltet, nur noch OAuth). Wir erkennen
   * den Hoster, warnen aber ehrlich statt still zu scheitern.
   */
  unsupported?: { reason: string };
};

export const MAIL_HOSTERS: MailHoster[] = [
  // ── Fester Server: App füllt alles, User gibt nur das Passwort ──────────────
  {
    id: "ionos-hosting",
    name: "IONOS",
    domain: "ionos.de",
    mxPatterns: ["ionos.", "1and1.com"],
    hostSource: "fixed",
    imap: { host: "imap.ionos.de", port: 993, secure: true },
    smtp: { host: "smtp.ionos.de", port: 587, secure: false },
  },
  {
    id: "strato-hosting",
    name: "Strato",
    domain: "strato.de",
    mxPatterns: ["rzone.de"], // Strato-MX = mailin.rzone.de (NICHT strato.de)
    hostSource: "fixed",
    imap: { host: "imap.strato.de", port: 993, secure: true },
    smtp: { host: "smtp.strato.de", port: 587, secure: false },
  },
  {
    id: "hetzner",
    name: "Hetzner",
    domain: "hetzner.com",
    mxPatterns: ["your-server.de"],
    hostSource: "fixed", // Client-Host fest = mail.your-server.de (≠ MX-Ziel!)
    imap: { host: "mail.your-server.de", port: 993, secure: true },
    smtp: { host: "mail.your-server.de", port: 587, secure: false },
  },
  {
    id: "domainfactory",
    name: "DomainFactory",
    domain: "df.eu",
    mxPatterns: ["ispgateway.de"], // MX = mx*.ispgateway.de (nicht df.eu — zu unspezifisch als Substring)
    hostSource: "fixed",
    imap: { host: "sslin.df.eu", port: 993, secure: true },
    smtp: { host: "sslout.df.eu", port: 587, secure: false },
  },
  {
    id: "mittwald",
    name: "Mittwald",
    domain: "mittwald.de",
    mxPatterns: ["agenturserver.de"],
    hostSource: "fixed",
    imap: { host: "mail.agenturserver.de", port: 993, secure: true },
    smtp: { host: "mail.agenturserver.de", port: 587, secure: false },
  },
  {
    id: "1blu",
    name: "1blu",
    domain: "1blu.de",
    mxPatterns: ["1blu.de"],
    hostSource: "fixed",
    imap: { host: "imap.1blu.de", port: 993, secure: true },
    smtp: { host: "smtp.1blu.de", port: 587, secure: false },
  },
  {
    id: "google-workspace",
    name: "Google Workspace",
    domain: "google.com",
    mxPatterns: ["aspmx.l.google.com", "googlemail.com"],
    hostSource: "fixed",
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 587, secure: false },
    hint: "Google verlangt ein App-Passwort (nicht dein normales Passwort) bei aktiver 2-Faktor-Anmeldung.",
    appPasswordUrl: "https://myaccount.google.com/apppasswords",
  },
  {
    id: "zoho-eu",
    name: "Zoho Mail",
    domain: "zoho.eu",
    mxPatterns: ["zoho.eu"],
    hostSource: "fixed",
    imap: { host: "imappro.zoho.eu", port: 993, secure: true },
    smtp: { host: "smtppro.zoho.eu", port: 587, secure: false },
    hint: "Zoho verlangt bei aktiver 2-Faktor-Anmeldung ein anwendungsspezifisches Passwort.",
    appPasswordUrl: "https://accounts.zoho.eu/home#security/security_pwd",
  },
  // ── Server aus der Domain ableitbar (mail.<domain>) ─────────────────────────
  {
    id: "netcup",
    name: "Netcup",
    domain: "netcup.de",
    mxPatterns: ["netcup.net"],
    hostSource: "domain",
    imap: { port: 993, secure: true },
    smtp: { port: 587, secure: false },
  },
  // ── Server = MX-Ziel: App liest ihn aus, User gibt nur das Passwort ─────────
  {
    id: "webgo",
    name: "webgo",
    domain: "webgo.de",
    mxPatterns: ["goserver.host", "webgo24.de"],
    hostSource: "mxTarget",
    imap: { port: 993, secure: true },
    smtp: { port: 587, secure: false },
  },
  {
    id: "all-inkl",
    name: "ALL-INKL",
    domain: "all-inkl.com",
    mxPatterns: ["kasserver.com"],
    hostSource: "mxTarget",
    imap: { port: 993, secure: true },
    smtp: { port: 587, secure: false },
  },
  // ── Kundenspezifischer Server: App setzt Ports, User trägt den Server ein ───
  {
    id: "hosteurope",
    name: "Host Europe",
    domain: "hosteurope.de",
    mxPatterns: ["hosteurope.de", "server-he.de"],
    hostSource: "user",
    imap: { port: 993, secure: true },
    smtp: { port: 587, secure: false },
    hint: "Deinen Server findest du in der KIS-Verwaltung: Empfang wpXXXXXXX.mail.server-he.de, Versand wpXXXXXXX.mailout.server-he.de.",
  },
  {
    id: "alfahosting",
    name: "Alfahosting",
    domain: "alfahosting.de",
    mxPatterns: ["alfahosting", "secure-mailgate.com"], // Default-Spamfilter-MX
    hostSource: "user",
    imap: { port: 993, secure: true },
    smtp: { port: 587, secure: false },
    hint: "Deinen Server (webXX.alfahosting-server.de) findest du im Kundencenter unter Server-Info.",
  },
  // ── Erkannt, aber Passwort-Login abgeschaltet → ehrlich warnen ──────────────
  {
    id: "microsoft365",
    name: "Microsoft 365",
    domain: "microsoft.com",
    mxPatterns: ["mail.protection.outlook.com"],
    hostSource: "fixed",
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    smtp: { host: "smtp.office365.com", port: 587, secure: false },
    unsupported: {
      reason:
        "Microsoft hat den Passwort-Login für externe Mail-Programme abgeschaltet. Dieses Postfach lässt sich aktuell nicht per Passwort verbinden — nutze ein anderes Absende-Konto.",
    },
  },
];

/** Serialisierbares Erkennungs-Ergebnis (Action → Client). */
export type HosterDetection = {
  hosterId: string;
  hosterName: string;
  hosterDomain: string;
  hostSource: HostSource;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  hint?: string;
  appPasswordUrl?: string;
  unsupportedReason?: string;
};

function resolveHost(
  hoster: MailHoster,
  proto: "imap" | "smtp",
  matchedMx: string,
  domain: string,
): string {
  switch (hoster.hostSource) {
    case "fixed":
      return hoster[proto].host ?? "";
    case "mxTarget":
      return matchedMx;
    case "domain":
      return `mail.${domain}`;
    case "user":
      return "";
  }
}

/**
 * Findet den Hoster anhand der MX-Hostnamen und leitet die konkreten
 * IMAP/SMTP-Server ab. `mxHosts` = Hostnamen, auf die der MX-Record zeigt
 * (idealerweise nach Priorität sortiert), `domain` = E-Mail-Domain. Pure
 * Funktion ohne DNS/IO — die Server-Action liefert die MX-Daten.
 */
export function detectHoster(mxHosts: string[], domain: string): HosterDetection | null {
  const normalizedMx = mxHosts.map((h) => h.toLowerCase().replace(/\.$/, "")).filter(Boolean);
  const cleanDomain = domain.trim().toLowerCase();

  for (const hoster of MAIL_HOSTERS) {
    const matchedMx = normalizedMx.find((mx) => hoster.mxPatterns.some((p) => mx.includes(p)));
    if (!matchedMx) continue;

    return {
      hosterId: hoster.id,
      hosterName: hoster.name,
      hosterDomain: hoster.domain,
      hostSource: hoster.hostSource,
      imapHost: resolveHost(hoster, "imap", matchedMx, cleanDomain),
      imapPort: hoster.imap.port,
      imapSecure: hoster.imap.secure,
      smtpHost: resolveHost(hoster, "smtp", matchedMx, cleanDomain),
      smtpPort: hoster.smtp.port,
      smtpSecure: hoster.smtp.secure,
      hint: hoster.hint,
      appPasswordUrl: hoster.appPasswordUrl,
      unsupportedReason: hoster.unsupported?.reason,
    };
  }
  return null;
}
