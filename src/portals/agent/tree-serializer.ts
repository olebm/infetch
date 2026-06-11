/**
 * Tree-Serializer fuer den Agent-Loop.
 *
 * Statt der entfernten `page.accessibility.snapshot()`-API enumerieren wir die
 * relevanten interaktiven Elemente per `page.evaluate` direkt aus dem DOM.
 * Jeder Knoten bekommt eine ID ("el-1", "el-2", ...).
 *
 * Datenschutz (INFETCH-266): Der literale Inhalt von Eingabefeldern verlaesst
 * den Browser-Kontext NIE. `collectInteractiveNodes` gibt pro Feld nur
 * `hasValue` (befuellt ja/nein) zurueck — niemals den getippten Wert.
 * Passwoerter werden ohnehin nie als befuellt markiert. Node-seitig wird
 * `hasValue` zu einem neutralen Marker (REDACTED_VALUE), damit der LLM weiss,
 * dass ein Feld befuellt ist, ohne Credentials/PII (Username, Kundennr.,
 * Betraege) zu sehen.
 */

import type { Page } from "playwright";

export type TreeNode = {
  id: string;
  role: string;
  name?: string;
  value?: string;
  required?: boolean;
  checked?: boolean;
};

export type LocatorHint = {
  role: string;
  name?: string;
};

export type SerializedTree = {
  tree: TreeNode[];
  locatorById: Map<string, LocatorHint>;
};

export type RawNode = {
  role: string;
  name: string | null;
  hasValue: boolean;
  required: boolean | null;
  checked: boolean | null;
  isPassword: boolean;
};

/** Marker, der dem LLM signalisiert: Feld ist befuellt — Inhalt redacted. */
export const REDACTED_VALUE = "[redacted]";

const MAX_NODES = 60;

/**
 * Laeuft im Browser-Kontext (page.evaluate) — MUSS self-contained sein (keine
 * Imports, keine Closures ueber Modul-Scope), damit Playwright die Funktion
 * serialisieren kann. Gibt bewusst nur `hasValue` statt des literalen
 * Eingabewerts zurueck (INFETCH-266), damit kein Klartext an den LLM oder in
 * Logs gelangt.
 */
export function collectInteractiveNodes(max: number): RawNode[] {
  function visibleAndInteractable(el: Element): boolean {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    return true;
  }

  function inferRole(el: Element): string {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return "link";
    if (tag === "input") {
      const type = (el as HTMLInputElement).type.toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "submit" || type === "button") return "button";
      if (type === "password") return "textbox";
      if (type === "search") return "search";
      return "textbox";
    }
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "li") return "listitem";
    if (tag === "tr") return "row";
    if (tag === "td" || tag === "th") return "cell";
    if (tag === "form") return "form";
    return "";
  }

  function accessibleName(el: Element): string | null {
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl?.textContent) return labelEl.textContent.trim();
    }
    const titleAttr = el.getAttribute("title");
    if (titleAttr) return titleAttr.trim();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.placeholder) return el.placeholder.trim();
      const id = el.id;
      if (id) {
        const label = document.querySelector(`label[for="${id}"]`);
        if (label?.textContent) return label.textContent.trim();
      }
      const wrappingLabel = el.closest("label");
      if (wrappingLabel?.textContent) return wrappingLabel.textContent.trim();
    }
    const text = el.textContent?.trim();
    if (text && text.length > 0 && text.length <= 100) return text;
    return null;
  }

  const selector =
    "button, a[href], input:not([type=hidden]), select, textarea, [role='button'], [role='link'], [role='textbox'], [role='combobox'], [role='checkbox'], [role='menuitem'], [role='tab']";
  const elements = Array.from(document.querySelectorAll(selector));

  const result: RawNode[] = [];
  for (const el of elements) {
    if (result.length >= max) break;
    if (!visibleAndInteractable(el)) continue;
    const role = inferRole(el);
    if (!role) continue;
    const name = accessibleName(el);
    const isPassword = el instanceof HTMLInputElement && el.type === "password";
    // INFETCH-266: nur Praesenz, nie der literale Wert. Passwoerter nie befuellt.
    const hasValue =
      !isPassword &&
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
      (el.value ?? "").trim().length > 0;
    const required =
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
        ? el.required
        : null;
    const checked =
      el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")
        ? el.checked
        : null;
    result.push({ role, name, hasValue, required, checked, isPassword });
  }
  return result;
}

export async function snapshotTree(page: Page): Promise<SerializedTree> {
  const rawNodes = await page.evaluate(collectInteractiveNodes, MAX_NODES);

  const tree: TreeNode[] = [];
  const locatorById = new Map<string, LocatorHint>();

  rawNodes.forEach((node, idx) => {
    const id = `el-${idx + 1}`;
    const treeNode: TreeNode = {
      id,
      role: node.role,
    };
    if (node.name) treeNode.name = truncate(node.name);
    // Befuelltes Feld -> neutraler Marker statt Klartext (INFETCH-266).
    if (node.hasValue) treeNode.value = REDACTED_VALUE;
    if (node.required !== null) treeNode.required = node.required;
    if (node.checked !== null) treeNode.checked = node.checked;
    tree.push(treeNode);
    locatorById.set(id, {
      role: node.role,
      name: node.name ?? undefined,
    });
  });

  return { tree, locatorById };
}

function truncate(value: string, max = 120): string {
  if (value.length <= max) return value;
  return value.slice(0, max) + "...";
}
