import type { Recipe, RecipeStep } from "@/portals/agent/types";

/**
 * Übersetzt ein Recipe in für Kund:innen lesbare Schritte (INFETCH-267 / AC3).
 *
 * Zweck: Transparenz — „diese Schritte, mehr nicht". Die Liste macht sichtbar,
 * dass der Agent ausschließlich navigiert, Zugangsdaten einträgt und Rechnungen
 * herunterlädt — keine Zahlungen, keine Einstellungsänderungen. Enthält bewusst
 * keine Selektoren/internen Wartezeiten (kein Debug-Rauschen) und natürlich
 * keine Credential-Werte (nur die Tatsache, dass Benutzername/Passwort getippt
 * werden).
 */
export function describeRecipeSteps(recipe: Recipe): string[] {
  const raw: string[] = [];
  const host = safeHost(recipe.loginUrl);
  raw.push(host ? `Öffne die Login-Seite (${host})` : "Öffne die Login-Seite");

  for (const step of [...recipe.loginFlow, ...recipe.navigationFlow]) {
    const line = describeStep(step);
    if (line) raw.push(line);
  }

  raw.push("Öffne die Rechnungsübersicht und lade die PDF-Dateien herunter");

  // Aufeinanderfolgende Duplikate (z. B. mehrere generische Klicks) zusammenfassen.
  return raw.filter((line, i) => line !== raw[i - 1]);
}

function describeStep(step: RecipeStep): string | null {
  switch (step.type) {
    case "goto":
      return `Wechsle zu ${safeHost(step.url) ?? "der nächsten Seite"}`;
    case "fill":
      if (step.valueFrom === "credential.username") return "Trage den Benutzernamen ein";
      if (step.valueFrom === "credential.password") return "Trage das Passwort ein";
      return "Trage den 2FA-Code ein (automatisch generiert)";
    case "click":
      return "Klicke auf eine Schaltfläche";
    case "press":
      return step.key === "Enter" ? "Bestätige mit Enter" : `Drücke ${step.key}`;
    case "waitForUrl":
    case "waitFor":
    case "screenshot":
      // interne Wartezeit/Technik — für Kund:innen nicht relevant
      return null;
    default:
      return null;
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
