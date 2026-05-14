/**
 * Vendor display-name + domain utilities.
 * No "use client" — safe in both Server and Client Components.
 */

/**
 * Formats a vendor display name from whatever is available.
 *
 * Priority:
 *   1. `name` if set and non-empty
 *   2. `canonicalKey` slug (e.g. "strato") → "Strato"
 *   3. "Unbekannt"
 */
export function formatVendorName(
  name: string | null | undefined,
  canonicalKey?: string | null,
): string {
  if (name?.trim()) return name.trim();
  if (canonicalKey?.trim()) {
    const segment = canonicalKey.split(".")[0] ?? "";
    return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
  }
  return "Unbekannt";
}

/**
 * Extracts the registrable root domain from any hostname.
 *
 * Examples:
 *   "strato.de"          → "strato.de"   (already root)
 *   "email.claude.com"   → "claude.com"
 *   "enews.vodafone.de"  → "vodafone.de"
 *   "raidboxes.io"       → "raidboxes.io"
 *
 * Limitation: does not handle eTLD+1 edge cases like .co.uk — acceptable
 * for the German/EU vendor set used here.
 */
export function rootDomain(domain: string | null | undefined): string | null {
  if (!domain?.trim()) return null;
  const parts = domain.trim().split(".");
  if (parts.length <= 2) return domain.trim();
  return parts.slice(-2).join(".");
}
