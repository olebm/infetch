/**
 * Generische E-Mail-Provider-Domains. Mails von diesen Absendern stammen i. d. R.
 * von Privatpersonen, nicht von einem Lieferanten — daraus darf kein Vendor
 * abgeleitet werden (weder als Domain-Alias noch als auto-angelegter Vendor),
 * sonst verschmutzt der Katalog. Geteilt von learnFromManualMatch (manuelle
 * Zuordnung) und autoAssignSenders (automatischer Lever).
 */
export const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "yahoo.de",
  "icloud.com",
  "me.com",
  "gmx.de",
  "gmx.net",
  "gmx.at",
  "web.de",
  "t-online.de",
  "freenet.de",
  "aol.com",
  "live.com",
  "msn.com",
  "mail.com",
  "mail.de",
  "posteo.de",
  "mailbox.org",
  "fastmail.com",
  "proton.me",
  "protonmail.com",
]);

/** True, wenn die Domain ein generischer Free-Mail-Provider ist. */
export function isGenericEmailDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  return GENERIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}
