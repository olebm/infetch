/**
 * Seed-Recipes: hand-kuratierte Klick-Sequenzen fuer ausgewaehlte Portale.
 * Diese landen einmalig in der portal_recipes Tabelle, sobald der Vendor das erste Mal
 * aufgerufen wird. Wenn das Replay spaeter fehlschlaegt, springt der Recipe-Recorder ein
 * und ersetzt die Seed-Recipe durch eine selbst-aufgenommene Version.
 */

import type { Recipe } from "@/portals/agent/types";

export const SEED_RECIPES: Record<string, Recipe> = {
  // EnBW: Beispiel-Recipe als Startpunkt fuer Phase 1.
  // Die echten Selektoren muessen beim ersten echten Lauf verifiziert werden — sie sind hier
  // bewusst defensiv (mit aria-labels und Texten statt brittler CSS-Klassen).
  enbw: {
    vendorKey: "enbw",
    loginUrl: "https://www.enbw.com/meine-rechnungen/",
    loginFlow: [
      { type: "goto", url: "https://login.enbw.com/" },
      { type: "fill", selector: "input[type='email'], input[name='username']", valueFrom: "credential.username" },
      { type: "fill", selector: "input[type='password']", valueFrom: "credential.password" },
      { type: "click", selector: "button[type='submit']" },
      { type: "waitForUrl", pattern: "**/meine-rechnungen*" },
    ],
    navigationFlow: [
      { type: "waitFor", selector: "[data-testid='invoice-list'], table.invoices, ul.invoice-list" },
    ],
    invoiceList: {
      rowSelector: "[data-testid='invoice-row'], table.invoices tr, ul.invoice-list > li",
      dateSelector: "[data-testid='invoice-date'], time, .date",
      downloadSelector: "a[download], a[href*='.pdf'], button[aria-label*='herunter']",
    },
  },
};

export function getSeedRecipe(vendorKey: string): Recipe | null {
  return SEED_RECIPES[vendorKey] ?? null;
}
