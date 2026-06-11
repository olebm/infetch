// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  collectInteractiveNodes,
  REDACTED_VALUE,
  snapshotTree,
} from "@/portals/agent/tree-serializer";

// INFETCH-266 / AC2: Der A11y-Tree an Mistral darf keine literalen
// Eingabewerte enthalten (Username, Kundennr., Betraege). Verifiziert die
// echten Browser-/Node-Funktionen gegen ein DOM (happy-dom).

beforeEach(() => {
  document.body.innerHTML = "";
  // happy-dom hat keine Layout-Engine -> getBoundingClientRect ist 0x0, womit
  // der Sichtbarkeits-Filter alles verwerfen wuerde. Fuer den Test sichtbare
  // Boxen erzwingen.
  Element.prototype.getBoundingClientRect = () =>
    ({
      width: 20,
      height: 20,
      top: 0,
      left: 0,
      right: 20,
      bottom: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
});

describe("collectInteractiveNodes (Browser-seitig)", () => {
  it("gibt NIE den literalen Eingabewert zurueck — nur hasValue", () => {
    document.body.innerHTML = `
      <input id="user" type="text" value="geheim@kunde.de" aria-label="E-Mail" />
      <input id="pw" type="password" value="supersecret" aria-label="Passwort" />
      <input id="empty" type="text" value="" aria-label="Suche" />
    `;

    const nodes = collectInteractiveNodes(60);
    const serialized = JSON.stringify(nodes);

    expect(serialized).not.toContain("geheim@kunde.de");
    expect(serialized).not.toContain("supersecret");

    const user = nodes.find((n) => n.name === "E-Mail");
    expect(user?.hasValue).toBe(true);

    const pw = nodes.find((n) => n.isPassword);
    expect(pw?.hasValue).toBe(false); // Passwort nie als befuellt markiert

    const search = nodes.find((n) => n.name === "Suche");
    expect(search?.hasValue).toBe(false); // leeres Feld
  });
});

describe("snapshotTree (Node-seitige Redaction)", () => {
  it("ersetzt befuellte Felder durch den Marker, nie durch Klartext", async () => {
    document.body.innerHTML = `
      <input id="user" type="text" value="geheim@kunde.de" aria-label="E-Mail" />
      <input id="pw" type="password" value="supersecret" aria-label="Passwort" />
    `;

    // snapshotTree erwartet eine Playwright-Page; wir faken nur page.evaluate,
    // das die ECHTE Browser-Funktion gegen das happy-dom-document ausfuehrt.
    const fakePage = {
      evaluate: async (fn: (max: number) => unknown, arg: number) => fn(arg),
    };

    const { tree } = await snapshotTree(fakePage as never);
    const serialized = JSON.stringify(tree);

    expect(serialized).not.toContain("geheim@kunde.de");
    expect(serialized).not.toContain("supersecret");

    const user = tree.find((n) => n.name === "E-Mail");
    expect(user?.value).toBe(REDACTED_VALUE);

    const pw = tree.find((n) => n.name === "Passwort");
    expect(pw?.value).toBeUndefined(); // Passwort: gar kein value
  });
});
