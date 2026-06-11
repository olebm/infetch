import { hostAllowedForVendor } from "@/portals/agent/recipe-player";
import type { Recipe } from "@/portals/agent/types";

/**
 * Install-Zeit-Validierung für Community-Recipes (INFETCH-268).
 *
 * Defense-in-Depth zur Laufzeit-Egress-Allowlist (#139, INFETCH-265): ein
 * vergiftetes Community-Recipe, das die Browser-Session inkl. Credentials auf
 * eine Fremd-Domain leiten würde, soll gar nicht erst aktiviert werden — es wird
 * schon beim Sync abgelehnt, mit Nennung der verletzenden URL(s).
 *
 * Geprüft werden alle navigierenden URLs: die loginUrl plus jeder `goto`-Schritt.
 * Anker (Allowlist-Basis) ist die vertrauenswürdige Vendor-URL
 * (vendor.portalLoginUrl). Fehlt sie, fällt die Prüfung auf die recipe-eigene
 * loginUrl zurück (Selbst-Konsistenz: kein goto darf die deklarierte
 * Login-Domain verlassen). Die schärfere Bindung an die kund:innenseitige
 * portalLoginUrl erfolgt zusätzlich zur Laufzeit.
 */
export function collectRecipeNavigationUrls(recipe: Recipe): string[] {
  const urls: string[] = [];
  if (recipe.loginUrl) urls.push(recipe.loginUrl);
  for (const step of [...(recipe.loginFlow ?? []), ...(recipe.navigationFlow ?? [])]) {
    if (step.type === "goto" && step.url) urls.push(step.url);
  }
  return urls;
}

export function validateRecipeDomains(
  recipe: Recipe,
  trustedVendorUrl: string | null,
): { ok: boolean; violations: string[] } {
  const base = trustedVendorUrl ?? recipe.loginUrl ?? null;
  const violations = collectRecipeNavigationUrls(recipe).filter(
    (url) => !hostAllowedForVendor(url, base),
  );
  return { ok: violations.length === 0, violations };
}
