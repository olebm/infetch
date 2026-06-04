"use server";

import { resolveMx } from "node:dns/promises";
import { requireCurrentAuth } from "@/lib/auth/current";
import { detectHoster, type HosterDetection } from "@/lib/mail-hosters";

export type HosterLookupResult =
  | { status: "found"; detection: HosterDetection }
  | { status: "unknown" };

// Konservative Domain-Form (Labels a–z0–9, Bindestrich nicht am Rand, ≥1 Punkt).
// Verhindert, dass beliebige Strings in resolveMx() laufen.
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/**
 * Erkennt im Hintergrund den Mail-Hoster einer eigenen Domain per MX-Record.
 * Gibt "unknown" zurück bei ungültiger Domain, fehlendem MX oder DNS-Fehler —
 * die UI fällt dann auf manuelle Eingabe zurück (kein harter Fehler).
 */
export async function lookupMailHosterAction(emailOrDomain: string): Promise<HosterLookupResult> {
  await requireCurrentAuth();

  const raw = String(emailOrDomain ?? "");
  const at = raw.lastIndexOf("@");
  const domain = (at >= 0 ? raw.slice(at + 1) : raw).trim().toLowerCase();
  if (!DOMAIN_RE.test(domain)) return { status: "unknown" };

  let records: { exchange: string; priority: number }[];
  try {
    records = await resolveMx(domain);
  } catch {
    return { status: "unknown" }; // keine MX / NXDOMAIN / Timeout → manueller Modus
  }
  if (!records.length) return { status: "unknown" };

  const mxHosts = records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
  const detection = detectHoster(mxHosts, domain);
  return detection ? { status: "found", detection } : { status: "unknown" };
}
