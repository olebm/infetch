import type Database from "better-sqlite3";
import { getDb } from "@/lib/db/client";
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

export function getActiveRecipe(vendorKey: string, db?: Database.Database): RecipeRow | null {
  const resolved = db ?? getDb();
  const row = resolved
    .prepare(
      `SELECT id, vendor_key AS vendorKey, version, recipe_json AS recipeJson,
        recorded_by AS recordedBy, recorded_at AS recordedAt,
        last_success_at AS lastSuccessAt, last_failure_at AS lastFailureAt,
        failure_count AS failureCount, status
       FROM portal_recipes
       WHERE vendor_key = ? AND status = 'active'
       ORDER BY version DESC
       LIMIT 1`,
    )
    .get(vendorKey) as RawRecipeRow | undefined;
  return row ? mapRow(row) : null;
}

export function listRecipes(vendorKey?: string, db?: Database.Database): RecipeRow[] {
  const resolved = db ?? getDb();
  const stmt = vendorKey
    ? resolved.prepare(
        `SELECT id, vendor_key AS vendorKey, version, recipe_json AS recipeJson,
          recorded_by AS recordedBy, recorded_at AS recordedAt,
          last_success_at AS lastSuccessAt, last_failure_at AS lastFailureAt,
          failure_count AS failureCount, status
         FROM portal_recipes
         WHERE vendor_key = ?
         ORDER BY version DESC`,
      )
    : resolved.prepare(
        `SELECT id, vendor_key AS vendorKey, version, recipe_json AS recipeJson,
          recorded_by AS recordedBy, recorded_at AS recordedAt,
          last_success_at AS lastSuccessAt, last_failure_at AS lastFailureAt,
          failure_count AS failureCount, status
         FROM portal_recipes
         ORDER BY vendor_key, version DESC`,
      );
  const rows = (vendorKey ? stmt.all(vendorKey) : stmt.all()) as RawRecipeRow[];
  return rows.map(mapRow);
}

export function saveRecipe(input: {
  vendorKey: string;
  recipe: Recipe;
  recordedBy?: "local" | "community";
  db?: Database.Database;
}): RecipeRow {
  const db = input.db ?? getDb();
  const previous = db
    .prepare(`SELECT MAX(version) AS maxVersion FROM portal_recipes WHERE vendor_key = ?`)
    .get(input.vendorKey) as { maxVersion: number | null };
  const nextVersion = (previous?.maxVersion ?? 0) + 1;

  db.prepare(`UPDATE portal_recipes SET status = 'replaced' WHERE vendor_key = ? AND status = 'active'`).run(
    input.vendorKey,
  );
  db.prepare(
    `INSERT INTO portal_recipes (vendor_key, version, recipe_json, recorded_by, status)
     VALUES (?, ?, ?, ?, 'active')`,
  ).run(input.vendorKey, nextVersion, JSON.stringify(input.recipe), input.recordedBy ?? "local");

  const row = db
    .prepare(
      `SELECT id, vendor_key AS vendorKey, version, recipe_json AS recipeJson,
        recorded_by AS recordedBy, recorded_at AS recordedAt,
        last_success_at AS lastSuccessAt, last_failure_at AS lastFailureAt,
        failure_count AS failureCount, status
       FROM portal_recipes
       WHERE vendor_key = ? AND version = ?`,
    )
    .get(input.vendorKey, nextVersion) as RawRecipeRow;
  return mapRow(row);
}

export function markRecipeSuccess(recipeId: number, db?: Database.Database) {
  (db ?? getDb())
    .prepare(`UPDATE portal_recipes SET last_success_at = CURRENT_TIMESTAMP, failure_count = 0 WHERE id = ?`)
    .run(recipeId);
}

export function markRecipeFailure(recipeId: number, db?: Database.Database) {
  (db ?? getDb())
    .prepare(
      `UPDATE portal_recipes
       SET last_failure_at = CURRENT_TIMESTAMP,
           failure_count = failure_count + 1,
           status = CASE WHEN failure_count + 1 >= 3 THEN 'broken' ELSE status END
       WHERE id = ?`,
    )
    .run(recipeId);
}

export function logRun(input: {
  vendorKey: string;
  recipeId: number | null;
  mode: "replay" | "record" | "replay_then_record";
  status: string;
  invoicesFound: number;
  durationMs: number;
  errorMessage?: string | null;
  llmCalls?: number;
  llmCostCents?: number;
  db?: Database.Database;
}) {
  const db = input.db ?? getDb();
  db.prepare(
    `INSERT INTO portal_run_logs (vendor_key, recipe_id, mode, status, invoices_found, duration_ms,
       error_message, llm_calls, llm_cost_cents, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  ).run(
    input.vendorKey,
    input.recipeId,
    input.mode,
    input.status,
    input.invoicesFound,
    input.durationMs,
    input.errorMessage ?? null,
    input.llmCalls ?? 0,
    input.llmCostCents ?? 0,
  );
}
