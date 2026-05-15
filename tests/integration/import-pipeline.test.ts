import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import { importPdfBuffer } from "@/invoices/import-pipeline";

// Minimaler aber valider PDF-Buffer (realer %PDF-Header + EOF)
function makePdfBuffer(content = "test invoice content"): Buffer {
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${content}\n%%EOF`);
}

const PREFIX = `test:import:${Date.now()}:`;

async function cleanup() {
  // invoice_files + ai_extractions via CASCADE gelöscht
  await sql`DELETE FROM invoices WHERE dedupe_key LIKE ${PREFIX + "%"}`;
}

// Shared helper: importiert einen PDF-Buffer mit Test-Prefix als dedupe_key
async function importTestPdf(opts: {
  buffer?: Buffer;
  filename?: string;
  bypassQuota?: boolean;
} = {}) {
  const buffer = opts.buffer ?? makePdfBuffer(PREFIX + Math.random());
  return importPdfBuffer({
    buffer,
    originalFilename: opts.filename ?? "invoice-openai-test.pdf",
    sourceType: "manual",
    organizationId: null,
    bypassQuota: opts.bypassQuota ?? true,
  });
}

describe("importPdfBuffer — Kern-Import-Pipeline", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("importiert valides PDF und legt Invoice + File-Row an", async () => {
    const result = await importTestPdf();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("imported");
    expect(result.invoiceId).toBeGreaterThan(0);
    expect(result.fileId).toBeGreaterThan(0);

    const [invoice] = await sql<{ id: number; status: string }[]>`
      SELECT id, status FROM invoices WHERE id = ${result.invoiceId}
    `;
    expect(invoice).toBeTruthy();
    expect(["ready", "needs_review", "ignored"]).toContain(invoice.status);

    const [file] = await sql<{ id: number }[]>`
      SELECT id FROM invoice_files WHERE invoice_id = ${result.invoiceId}
    `;
    expect(file).toBeTruthy();
  });

  it("erkennt Duplikat anhand SHA256 und gibt bestehende invoiceId zurück", async () => {
    const buffer = makePdfBuffer(PREFIX + "dup-test");

    const first = await importPdfBuffer({
      buffer,
      originalFilename: "invoice-1.pdf",
      sourceType: "manual",
      organizationId: null,
      bypassQuota: true,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await importPdfBuffer({
      buffer, // gleicher Buffer → gleicher SHA256
      originalFilename: "invoice-2-renamed.pdf",
      sourceType: "manual",
      organizationId: null,
      bypassQuota: true,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.status).toBe("duplicate");
    expect(second.invoiceId).toBe(first.invoiceId);
  });

  it("setzt status='ignored' bei Junk-Filename (AGB)", async () => {
    const result = await importPdfBuffer({
      buffer: makePdfBuffer(PREFIX + "junk"),
      originalFilename: "AGB_Allgemeine_Geschaeftsbedingungen.pdf",
      sourceType: "manual",
      organizationId: null,
      bypassQuota: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [invoice] = await sql<{ status: string }[]>`
      SELECT status FROM invoices WHERE id = ${result.invoiceId}
    `;
    expect(invoice.status).toBe("ignored");
  });

  it("schlägt fehl bei leerem Buffer", async () => {
    const result = await importPdfBuffer({
      buffer: Buffer.alloc(0),
      originalFilename: "empty.pdf",
      sourceType: "manual",
      organizationId: null,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
  });

  it("schlägt fehl wenn kein PDF-Header vorhanden", async () => {
    const result = await importPdfBuffer({
      buffer: Buffer.from("This is definitely not a PDF file"),
      originalFilename: "fake.pdf",
      sourceType: "manual",
      organizationId: null,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
  });

  it("schlägt fehl bei Datei > 20 MB", async () => {
    const bigBuffer = Buffer.alloc(21 * 1024 * 1024, "%");
    const result = await importPdfBuffer({
      buffer: bigBuffer,
      originalFilename: "huge.pdf",
      sourceType: "manual",
      organizationId: null,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
  });

  it("matcht Vendor anhand OpenAI-Filename", async () => {
    const result = await importPdfBuffer({
      buffer: makePdfBuffer(PREFIX + "openai-vendor"),
      originalFilename: "invoice-openai-may-2026.pdf",
      sourceType: "manual",
      organizationId: null,
      bypassQuota: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [invoice] = await sql<{ vendor_id: number | null }[]>`
      SELECT vendor_id FROM invoices WHERE id = ${result.invoiceId}
    `;
    expect(invoice.vendor_id).not.toBeNull();
  });

  it("schreibt sync_event beim Import", async () => {
    const result = await importTestPdf();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const events = await sql<{ event_type: string }[]>`
      SELECT event_type FROM sync_events WHERE invoice_id = ${result.invoiceId}
    `;
    expect(events.length).toBeGreaterThan(0);
    const eventTypes = events.map((e) => e.event_type);
    expect(eventTypes.some((t) => t.includes("imported"))).toBe(true);
  });
});
