import { sql } from "@/lib/db/client";

export async function recordSyncEvent(input: {
  level: "info" | "warning" | "error";
  eventType: string;
  message: string;
  vendorId?: number | null;
  invoiceId?: number | null;
  yearMonth?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await sql`
    INSERT INTO sync_events (
      sync_run_id, job_id, level, event_type, vendor_id, invoice_id, year_month, message, metadata_json
    )
    VALUES (
      NULL, NULL,
      ${input.level},
      ${input.eventType},
      ${input.vendorId ?? null},
      ${input.invoiceId ?? null},
      ${input.yearMonth ?? null},
      ${input.message},
      ${JSON.stringify(input.metadata || {})}
    )
  `;
}
