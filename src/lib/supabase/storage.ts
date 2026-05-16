/**
 * Supabase Storage helpers — server-side only.
 * Uses service role key (bypasses RLS). Never call from browser.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { decryptBuffer, encryptBuffer, getStorageKey } from "@/lib/secrets/storage-crypto";

export const BUCKETS = {
  INVOICES: "invoices",
  RAW_TEXT: "raw-text",
  PORTAL_SESSIONS: "portal-sessions",
} as const;

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

/** Upload a file. Upsert = true: overwrites if exists. */
export async function uploadToStorage(
  bucket: BucketName,
  key: string,
  data: Buffer | string,
  options?: { contentType?: string },
): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const plain = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  const body = encryptBuffer(plain, await getStorageKey());
  const { error } = await supabase.storage.from(bucket).upload(key, body, {
    contentType: options?.contentType ?? "application/octet-stream",
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed (${bucket}/${key}): ${error.message}`);
}

/** Download a file as Buffer. Throws if not found. */
export async function downloadFromStorage(bucket: BucketName, key: string): Promise<Buffer> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage.from(bucket).download(key);
  if (error) throw new Error(`Storage download failed (${bucket}/${key}): ${error.message}`);
  const raw = Buffer.from(await (data as Blob).arrayBuffer());
  // Legacy-Objekte (vor Einführung der Verschlüsselung) werden unverändert
  // zurückgegeben; decryptBuffer erkennt das am fehlenden Envelope-Header.
  return decryptBuffer(raw, await getStorageKey());
}

/** Delete a file. Silently ignores not-found. */
export async function deleteFromStorage(bucket: BucketName, key: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  await supabase.storage.from(bucket).remove([key]);
}

/**
 * Build the Storage key for a PDF invoice.
 * Format: {orgId}/{year}/{yearMonth}/{vendor}/{vendor}_{product}_{date}.pdf
 * If no orgId: uses "default" as prefix.
 */
export function buildInvoiceStorageKey(input: {
  orgId: string | null;
  vendorKey: string | null;
  productLabel: string | null;
  invoiceDate: string | null;
  fallbackDate?: string | null;
}): string {
  const effectiveDate = input.invoiceDate || input.fallbackDate || "unknown-date";
  const yearMonth = effectiveDate.slice(0, 7) || "unknown-month";
  const year = effectiveDate.slice(0, 4) || "unknown-year";
  const vendor = sanitizeKeyPart(input.vendorKey || "unknown-vendor");
  const product = sanitizeKeyPart(input.productLabel || "unknown-product");
  const datePart = /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) ? effectiveDate : "unknown-date";
  const orgSegment = input.orgId ? input.orgId : "default";
  return `${orgSegment}/${year}/${yearMonth}/${vendor}/${vendor}_${product}_${datePart}.pdf`;
}

export function sanitizeKeyPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
