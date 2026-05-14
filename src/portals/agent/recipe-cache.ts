import { sql } from "@/lib/db/client";
import type { Recipe, RecipeRow } from "@/portals/agent/types";

type RawRecipeRow = {
  id: number;
  vendorKey: string;
  version: number;
  recipeJson: string;
  recordedBy: string;
  recordedAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCount: number;
  status: string;
};

function mapRow(row: RawRecipeRow): RecipeRow {
  return {
    id: row.id,
    vendorKey: row.vendorKey,
    version: row.version,
    recipe: JSON.parse(row.recipeJson) as Recipe,
    recordedBy: row.recordedBy === "community" ? "community" : "local",
    recordedAt: row.recordedAt,
    lastSuccessAt: row.lastSuccessAt,
    lastFailureAt: row.lastFailureAt,
    failureCount: row.failureCount,
    status: row.status as RecipeRow["status"],
  };
}

export async function getActiveRecipe(vendorKey: string): Promise<RecipeRow | null> {
  const rows = await sql<RawRecipeRow[]>`
    SELECT id, vendor_key AS "vendorKey", version, recipe_json AS "recipeJson",
      recorded_by AS "recordedBy", recorded_at AS "recordedAt",
      last_success_at AS "lastSuccessAt", last_failure_at AS "lastFailureAt",
      failure_count AS "failureCount", status
    FROM portal_recipes
    WHERE vendor_key = ${vendorKey} AND status = 'active'
    ORDER BY version DESC
    LIMIT 1
  `;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listRecipes(vendorKey?: string): Promise<RecipeRow[]> {
  const rows = vendorKey
    ? await sql<RawRecipeRow[]>`
        SELECT id, vendor_key AS "vendorKey", version, recipe_json AS "recipeJson",
          recorded_by AS "recordedBy", recorded_at AS "recordedAt",
          last_success_at AS "lastSuccessAt", last_failure_at AS "lastFailureAt",
          failure_count AS "failureCount", status
        FROM portal_recipes
        WHERE vendor_key = ${vendorKey}
        ORDER BY version DESC
      `
    : await sql<RawRecipeRow[]>`
        SELECT id, vendor_key AS "vendorKey", version, recipe_json AS "recipeJson",
          recorded_by AS "recordedBy", recorded_at AS "recordedAt",
          last_success_at AS "lastSuccessAt", last_failure_at AS "lastFailureAt",
          failure_count AS "failureCount", status
        FROM portal_recipes
        ORDER BY vendor_key, version DESC
      `;
  return rows.map(mapRow);
}

export async function saveRecipe(input: {
  vendorKey: string;
  recipe: Recipe;
  recordedBy?: "local" | "community";
}): Promise<RecipeRow> {
  const previousRows = await sql<{ maxVersion: number | null }[]>`
    SELECT MAX(version) AS "maxVersion" FROM portal_recipes WHERE vendor_key = ${input.vendorKey}
  `;
  const nextVersion = (previousRows[0]?.maxVersion ?? 0) + 1;

  await sql`
    UPDATE portal_recipes SET status = 'replaced' WHERE vendor_key = ${input.vendorKey} AND status = 'active'
  `;
  await sql`
    INSERT INTO portal_recipes (vendor_key, version, recipe_json, recorded_by, status)
    VALUES (${input.vendorKey}, ${nextVersion}, ${JSON.stringify(input.recipe)}, ${input.recordedBy ?? "local"}, 'active')
  `;

  const rows = await sql<RawRecipeRow[]>`
    SELECT id, vendor_key AS "vendorKey", version, recipe_json AS "recipeJson",
      recorded_by AS "recordedBy", recorded_at AS "recordedAt",
      last_success_at AS "lastSuccessAt", last_failure_at AS "lastFailureAt",
      failure_count AS "failureCount", status
    FROM portal_recipes
    WHERE vendor_key = ${input.vendorKey} AND version = ${nextVersion}
  `;
  return mapRow(rows[0]);
}

export async function markRecipeSuccess(recipeId: number): Promise<void> {
  await sql`
    UPDATE portal_recipes SET last_success_at = CURRENT_TIMESTAMP, failure_count = 0 WHERE id = ${recipeId}
  `;
}

export async function markRecipeFailure(recipeId: number): Promise<void> {
  await sql`
    UPDATE portal_recipes
    SET last_failure_at = CURRENT_TIMESTAMP,
        failure_count = failure_count + 1,
        status = CASE WHEN failure_count + 1 >= 3 THEN 'broken' ELSE status END
    WHERE id = ${recipeId}
  `;
}

export async function logRun(input: {
  vendorKey: string;
  recipeId: number | null;
  mode: "replay" | "record" | "replay_then_record";
  status: string;
  invoicesFound: number;
  durationMs: number;
  errorMessage?: string | null;
  llmCalls?: number;
  llmCostCents?: number;
}): Promise<void> {
  await sql`
    INSERT INTO portal_run_logs (vendor_key, recipe_id, mode, status, invoices_found, duration_ms,
       error_message, llm_calls, llm_cost_cents, finished_at)
    VALUES (
      ${input.vendorKey}, ${input.recipeId}, ${input.mode}, ${input.status},
      ${input.invoicesFound}, ${input.durationMs},
      ${input.errorMessage ?? null}, ${input.llmCalls ?? 0}, ${input.llmCostCents ?? 0},
      CURRENT_TIMESTAMP
    )
  `;
}
