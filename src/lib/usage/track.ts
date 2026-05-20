import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";

export type UsageEventInput = {
  organizationId: string | null;
  eventType: string;
  costCents?: number;
  metadata?: Record<string, unknown>;
};

/**
 * Trägt einen Usage-Event in die `usage_events`-Tabelle ein.
 *
 * Wird genutzt für:
 *   - KI-Calls (Quota-Tracking, später Tier-Enforcement INTAKE-27)
 *   - Mail-Empfang, Rechnungs-Versand (analog, falls relevant)
 *
 * Wenn keine organization_id übergeben wird (Single-Tenant-Modus heute),
 * wird der Event mit NULL gespeichert und kann später beim Multi-Tenant-Cutover
 * einer Default-Org zugeordnet werden.
 */
export async function recordUsageEvent(input: UsageEventInput): Promise<void> {
  if (!input.organizationId) {
    // Solange Single-Tenant: Events nur loggen, nicht in usage_events schreiben
    // (FK organization_id ist NOT NULL). Sobald Multi-Tenant aktiv:
    // hier eine Fallback-Org-ID nutzen oder einen no-org-Bucket.
    return;
  }
  await sql`
    INSERT INTO usage_events (organization_id, event_type, cost_cents, metadata_json)
    VALUES (
      ${input.organizationId},
      ${input.eventType},
      ${input.costCents ?? 0},
      ${input.metadata ? JSON.stringify(input.metadata) : null}
    )
  `;
}

/**
 * Schätzt Mistral-Kosten basierend auf Token-Counts.
 * Mistral Small: ~€0.002 input + €0.006 output pro 1K Tokens (Stand 2026).
 * Diese Werte konservativ runden — exakte Abrechnung via Mistral-Dashboard.
 */
export function estimateMistralCostCents(input: {
  promptTokens?: number;
  completionTokens?: number;
}): number {
  const promptTokens = input.promptTokens ?? 0;
  const completionTokens = input.completionTokens ?? 0;
  // €0.002/1K input + €0.006/1K output → in Cent: input * 0.0002, output * 0.0006
  const cents = promptTokens * 0.0002 + completionTokens * 0.0006;
  return Math.max(1, Math.ceil(cents)); // mindestens 1 Cent pro Call
}
