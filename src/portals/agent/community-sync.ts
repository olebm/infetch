/**
 * Community-Recipe-Sync.
 *
 * Lädt regelmäßig ein Meta-File von einem öffentlichen GitHub-Repo und vergleicht es mit
 * den lokalen Recipes. Wenn:
 *   - lokal kein Recipe existiert, ODER
 *   - lokal eine community-Recipe existiert und remote eine neuere Version
 * synct es die neue Recipe ein.
 *
 * Lokale Recipes (recordedBy='local') haben IMMER Vorrang — sie werden niemals durch
 * Community-Recipes überschrieben.
 *
 * Recipes enthalten nur Selektoren und Click-Reihenfolge — KEINE Credentials, KEINE
 * Rechnungs-Daten, KEINE PII.
 */

import { getActiveRecipe, listRecipes, saveRecipe } from "@/portals/agent/recipe-cache";
import { findVendorByCanonicalKey } from "@/lib/db/queries";
import { validateRecipeDomains } from "@/portals/agent/recipe-validate";
import type { Recipe } from "@/portals/agent/types";

const DEFAULT_META_URL =
  process.env.INVOICE_AGENT_RECIPE_REPO_META_URL ||
  "https://raw.githubusercontent.com/invoice-agent/invoice-agent-recipes/main/meta.json";

const DEFAULT_RECIPE_BASE_URL =
  process.env.INVOICE_AGENT_RECIPE_REPO_BASE_URL ||
  "https://raw.githubusercontent.com/invoice-agent/invoice-agent-recipes/main/recipes/";

const FETCH_TIMEOUT_MS = 8000;

export type RecipeRepoMeta = {
  recipes: Array<{
    vendor: string;
    version: number;
    lastUpdated?: string;
    contributors?: string[];
    qualityScore?: number;
    successRate?: string;
  }>;
};

export type SyncResult = {
  ok: boolean;
  fetchedMetaUrl: string;
  remoteCount: number;
  installed: number;
  updated: number;
  skipped: number;
  rejected: number;
  errors: string[];
};

export async function syncCommunityRecipes(options: { force?: boolean } = {}): Promise<SyncResult> {
  const result: SyncResult = {
    ok: false,
    fetchedMetaUrl: DEFAULT_META_URL,
    remoteCount: 0,
    installed: 0,
    updated: 0,
    skipped: 0,
    rejected: 0,
    errors: [],
  };

  let meta: RecipeRepoMeta;
  try {
    meta = await fetchJson<RecipeRepoMeta>(DEFAULT_META_URL);
  } catch (error) {
    result.errors.push(describeError(error));
    return result;
  }

  if (!Array.isArray(meta.recipes)) {
    result.errors.push("meta.json hat kein gültiges 'recipes' Array.");
    return result;
  }

  result.remoteCount = meta.recipes.length;

  for (const entry of meta.recipes) {
    try {
      const local = await getActiveRecipe(entry.vendor);

      // Lokales Recipe (recordedBy='local') gewinnt immer
      if (local && local.recordedBy === "local" && !options.force) {
        result.skipped += 1;
        continue;
      }

      // Community-Recipe vorhanden — nur sync wenn remote-Version neuer
      if (
        local &&
        local.recordedBy === "community" &&
        local.version >= entry.version &&
        !options.force
      ) {
        result.skipped += 1;
        continue;
      }

      const recipe = await fetchJson<Recipe>(`${DEFAULT_RECIPE_BASE_URL}${entry.vendor}.json`);

      // INFETCH-268: Domain-Allowlist beim Install. Ein Recipe, dessen loginUrl
      // oder goto-Schritte eine fremde Domain ansteuern, wird abgelehnt — nicht
      // aktiviert (Defense-in-Depth zur Laufzeit-Prüfung #139). Anker ist die
      // vertrauenswürdige Vendor-URL; fehlt sie, gilt Selbst-Konsistenz zur
      // recipe-eigenen loginUrl.
      const vendor = await findVendorByCanonicalKey(entry.vendor);
      const domainCheck = validateRecipeDomains(recipe, vendor?.portalLoginUrl ?? null);
      if (!domainCheck.ok) {
        result.rejected += 1;
        result.errors.push(
          `${entry.vendor}: abgelehnt — Navigation auf fremde Domain (${domainCheck.violations.join(", ")})`,
        );
        continue;
      }

      await saveRecipe({ vendorKey: entry.vendor, recipe, recordedBy: "community" });

      if (!local) result.installed += 1;
      else result.updated += 1;
    } catch (error) {
      result.errors.push(`${entry.vendor}: ${describeError(error)}`);
    }
  }

  result.ok = true;
  return result;
}

export async function getCommunityRecipeStats(): Promise<{
  total: number;
  community: number;
  local: number;
  broken: number;
}> {
  const all = await listRecipes();
  return {
    total: all.length,
    community: all.filter((r) => r.recordedBy === "community" && r.status === "active").length,
    local: all.filter((r) => r.recordedBy === "local" && r.status === "active").length,
    broken: all.filter((r) => r.status === "broken").length,
  };
}

/**
 * Build a GitHub-PR-URL fuer das Teilen einer lokal aufgenommenen Recipe.
 * Der User submittet manuell — wir oeffnen nur die Vorlage.
 */
export function buildShareRecipeUrl(vendorKey: string, recipeJson: string): string {
  const repoEditUrl =
    process.env.INVOICE_AGENT_RECIPE_REPO_EDIT_URL ||
    "https://github.com/invoice-agent/invoice-agent-recipes/new/main";
  const filename = `recipes/${vendorKey}.json`;
  const body = encodeURIComponent(recipeJson);
  return `${repoEditUrl}?filename=${encodeURIComponent(filename)}&value=${body}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} bei ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
