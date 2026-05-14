import { format, subMonths } from "date-fns";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db/client";
import { appConfig } from "@/lib/config/env";
import { getStoredSmtpAccount } from "@/mail/smtp-settings";
import { hasConfiguredCredential } from "@/lib/secrets/credential-store";

type CountRow = { count: number };

export type DashboardStats = {
  invoicesTotal: number;
  downloadedPdfs: number;
  needsReview: number;
  duplicates: number;
  missing: number;
  actionRequired: number;
  exportReady: number;
};

export function getDashboardStats(): DashboardStats {
  const db = getDb();
  const count = (sql: string) => db.prepare(sql).get() as CountRow;

  return {
    invoicesTotal: count("SELECT COUNT(*) AS count FROM invoices").count,
    downloadedPdfs: count("SELECT COUNT(*) AS count FROM invoice_files").count,
    needsReview: count("SELECT COUNT(*) AS count FROM invoices WHERE status = 'needs_review'").count,
    duplicates: count("SELECT COUNT(*) AS count FROM invoices WHERE status = 'duplicate'").count,
    missing: count("SELECT COUNT(DISTINCT vendor_id) AS count FROM vendor_month_status WHERE final_status = 'missing'").count,
    actionRequired: count("SELECT COUNT(DISTINCT vendor_id) AS count FROM vendor_month_status WHERE final_status = 'action_required'").count,
    exportReady: count("SELECT COUNT(*) AS count FROM exports WHERE status = 'ready'").count,
  };
}

type SyncRunType = "imap_scan" | "missing_check" | "portal_fallback" | "ai_analysis" | "export";

type LatestSyncRunRow = { type: SyncRunType; status: string; finishedAt: string | null };

export type PipelineStep = {
  label: string;
  status: string;
  lastRunAt: string | null;
};

export function getPipelineSnapshot(): PipelineStep[] {
  const db = getDb();
  const mistralConfigured = hasConfiguredCredential(db, "mistral");

  const latestRuns = db
    .prepare(
      `SELECT sr.type AS type, sr.status AS status, sr.finished_at AS finishedAt
       FROM sync_runs sr
       JOIN (
         SELECT type, MAX(id) AS max_id
         FROM sync_runs
         GROUP BY type
       ) latest ON latest.type = sr.type AND latest.max_id = sr.id`,
    )
    .all() as LatestSyncRunRow[];

  const runByType = new Map(latestRuns.map((row) => [row.type, row]));
  const needsReviewCount = (db.prepare(`SELECT COUNT(*) AS count FROM invoices WHERE status = 'needs_review'`).get() as { count: number }).count;

  const stepFor = (type: SyncRunType, fallback: string): PipelineStep => {
    const run = runByType.get(type);
    return {
      label: "",
      status: run ? run.status : fallback,
      lastRunAt: run?.finishedAt ?? null,
    };
  };

  return [
    { ...stepFor("imap_scan", "pending"), label: "IMAP Scan" },
    { ...stepFor("missing_check", "pending"), label: "Missing Check" },
    {
      ...stepFor("portal_fallback", appConfig.features.portalFallback ? "pending" : "skipped"),
      label: "Portal-Fallback",
    },
    { label: "Download", status: "pending", lastRunAt: null },
    {
      ...stepFor("ai_analysis", mistralConfigured ? "pending" : "action_required"),
      label: "Mistral AI Analyse",
    },
    {
      label: "Review",
      status: needsReviewCount > 0 ? "needs_review" : "pending",
      lastRunAt: null,
    },
    { ...stepFor("export", "pending"), label: "Export Queue" },
  ];
}

export function getSetupSnapshot() {
  const db = getDb();
  const exportTargetActive = (db
    .prepare(`SELECT COUNT(*) AS count FROM export_targets WHERE enabled = 1 AND recipient_email IS NOT NULL`)
    .get() as CountRow).count > 0;
  // Mistral gilt als konfiguriert, wenn entweder ein DB-Credential vorliegt
  // (Legacy/Self-Host BYOK) ODER die env-Variable gesetzt ist (Self-Host).
  // Im MVP-Default wird der KI-Key vom Anbieter via Backend-Proxy gestellt
  // (siehe INTAKE-55) — bis dahin reicht env-Var als Setup-Bestätigung.
  const mistralConfigured =
    hasConfiguredCredential(db, "mistral") || appConfig.mistral.configured;
  return {
    mistralConfigured,
    imapConfigured:
      hasConfiguredCredential(db, "imap", "primary") || hasConfiguredCredential(db, "imap", "secondary"),
    smtpConfigured:
      hasConfiguredCredential(db, "smtp", "primary") || hasConfiguredCredential(db, "smtp", "secondary"),
    exportTargetActive,
  };
}

export function getUnmappedSenderCount(): number {
  const db = getDb();
  // Nur Sender mit PDFs zählen — PDF-lose Sender (Newsletter, Bestätigungsmails)
  // sind kein Vendor-Zuordnungs-Hebel und würden den Dashboard-Banner aufblähen.
  return (db
    .prepare(`SELECT COUNT(*) AS count FROM discovered_senders WHERE matched_vendor_id IS NULL AND blocked = 0 AND pdf_count > 0`)
    .get() as CountRow).count;
}

export type AgentCostSummary = {
  totalRuns: number;
  totalInvoices: number;
  totalLlmCalls: number;
  totalCostCents: number;
  avgDurationMs: number;
  byVendor: Array<{
    vendorKey: string;
    vendorName: string;
    runs: number;
    invoicesFound: number;
    successCount: number;
    failureCount: number;
    llmCostCents: number;
    avgDurationMs: number;
    lastRunAt: string | null;
    lastStatus: string | null;
  }>;
};

export function getAgentCostSummary(daysBack = 30): AgentCostSummary {
  const db = getDb();
  const sinceIso = new Date(Date.now() - daysBack * 86400_000).toISOString();

  const total = db
    .prepare(
      `SELECT
         COUNT(*) AS totalRuns,
         COALESCE(SUM(invoices_found), 0) AS totalInvoices,
         COALESCE(SUM(llm_calls), 0) AS totalLlmCalls,
         COALESCE(SUM(llm_cost_cents), 0) AS totalCostCents,
         COALESCE(AVG(duration_ms), 0) AS avgDurationMs
       FROM portal_run_logs
       WHERE started_at >= ?`,
    )
    .get(sinceIso) as {
      totalRuns: number;
      totalInvoices: number;
      totalLlmCalls: number;
      totalCostCents: number;
      avgDurationMs: number;
    };

  const byVendor = db
    .prepare(
      `SELECT
         p.vendor_key AS vendorKey,
         COALESCE(v.name, p.vendor_key) AS vendorName,
         COUNT(*) AS runs,
         COALESCE(SUM(p.invoices_found), 0) AS invoicesFound,
         COALESCE(SUM(CASE WHEN p.status IN ('success','no_invoices') THEN 1 ELSE 0 END), 0) AS successCount,
         COALESCE(SUM(CASE WHEN p.status NOT IN ('success','no_invoices') THEN 1 ELSE 0 END), 0) AS failureCount,
         COALESCE(SUM(p.llm_cost_cents), 0) AS llmCostCents,
         COALESCE(AVG(p.duration_ms), 0) AS avgDurationMs,
         MAX(p.started_at) AS lastRunAt,
         (SELECT status FROM portal_run_logs WHERE vendor_key = p.vendor_key ORDER BY id DESC LIMIT 1) AS lastStatus
       FROM portal_run_logs p
       LEFT JOIN vendors v ON v.canonical_key = p.vendor_key
       WHERE p.started_at >= ?
       GROUP BY p.vendor_key
       ORDER BY lastRunAt DESC`,
    )
    .all(sinceIso) as AgentCostSummary["byVendor"];

  return {
    totalRuns: total.totalRuns,
    totalInvoices: total.totalInvoices,
    totalLlmCalls: total.totalLlmCalls,
    totalCostCents: total.totalCostCents,
    avgDurationMs: Math.round(total.avgDurationMs),
    byVendor,
  };
}

export function getPortalIssueAccounts(): Array<{
  vendorKey: string;
  vendorName: string;
  status: string;
  errorMessage: string | null;
}> {
  const db = getDb();
  // Letzter Lauf pro Vendor mit problematischem Status
  const rows = db
    .prepare(
      `SELECT v.canonical_key AS vendorKey, v.name AS vendorName, p.status, p.error_message AS errorMessage
       FROM portal_run_logs p
       JOIN vendors v ON v.canonical_key = p.vendor_key
       WHERE p.id IN (
         SELECT MAX(id) FROM portal_run_logs GROUP BY vendor_key
       )
       AND p.status IN ('login_required', 'two_factor', 'captcha', 'failed')`,
    )
    .all() as Array<{ vendorKey: string; vendorName: string; status: string; errorMessage: string | null }>;
  return rows;
}

export function getExportQueueCounts() {
  const db = getDb();
  return {
    pending: (db.prepare(`SELECT COUNT(*) AS count FROM exports WHERE status = 'pending'`).get() as CountRow).count,
    failed: (db.prepare(`SELECT COUNT(*) AS count FROM exports WHERE status = 'failed'`).get() as CountRow).count,
  };
}

export type TodayBilanz = {
  importedToday: number;
  exportedToday: number;
  needsReview: number;
};

export function getTodayBilanz(): TodayBilanz {
  const db = getDb();
  const count = (sql: string) => (db.prepare(sql).get() as CountRow).count;
  return {
    importedToday: count(
      `SELECT COUNT(*) AS count FROM invoices WHERE DATE(created_at) = DATE('now', 'localtime')`,
    ),
    exportedToday: count(
      `SELECT COUNT(*) AS count FROM exports WHERE status = 'sent' AND DATE(sent_at) = DATE('now', 'localtime')`,
    ),
    needsReview: count(
      `SELECT COUNT(*) AS count FROM invoices WHERE status = 'needs_review'`,
    ),
  };
}

export type AutomationStats = {
  exportedToday: number;
  exportedThisWeek: number;
  exportedLifetime: number;
  needsReview: number;
  hoursSavedLifetime: number; // Heuristik: 2 Min pro automatisch versendeter Rechnung
  daysActive: number | null;  // Tage seit erster Export-Aktivität (null = noch keine)
};

/**
 * Sicht auf das, was der Auto-Pilot bisher für den User erledigt hat.
 * Heute / Diese Woche / Lifetime — plus geschätzte Zeit-Ersparnis.
 *
 * Heuristik: pro automatisch versendeter Rechnung sparen wir dem User
 * etwa 2 Minuten manuelle Arbeit (Mail suchen → forwarden → eintragen).
 */
export function getAutomationStats(): AutomationStats {
  const db = getDb();
  const count = (sql: string) => (db.prepare(sql).get() as CountRow).count;
  const exportedToday = count(
    `SELECT COUNT(*) AS count FROM exports WHERE status = 'sent' AND DATE(sent_at) = DATE('now', 'localtime')`,
  );
  const exportedThisWeek = count(
    `SELECT COUNT(*) AS count FROM exports WHERE status = 'sent' AND sent_at >= datetime('now', '-7 days')`,
  );
  const exportedLifetime = count(
    `SELECT COUNT(*) AS count FROM exports WHERE status = 'sent'`,
  );
  const needsReview = count(
    `SELECT COUNT(*) AS count FROM invoices WHERE status = 'needs_review'`,
  );
  const minutesSaved = exportedLifetime * 2;
  const firstExportRow = db
    .prepare(`SELECT CAST(julianday('now') - julianday(MIN(sent_at)) AS INTEGER) AS days FROM exports WHERE status = 'sent'`)
    .get() as { days: number | null } | undefined;
  const daysActive = firstExportRow?.days ?? null;
  return {
    exportedToday,
    exportedThisWeek,
    exportedLifetime,
    needsReview,
    hoursSavedLifetime: Math.round((minutesSaved / 60) * 10) / 10, // eine Nachkommastelle
    daysActive,
  };
}

export function getRecentEvents(limit = 8) {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, level, event_type AS eventType, message, created_at AS createdAt
       FROM sync_events
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{ id: number; level: string; eventType: string; message: string; createdAt: string }>;
}

export function getInvoices(options: { limit?: number; status?: string; statuses?: string[]; year?: string; search?: string; includePrivate?: boolean } = {}) {
  const db = getDb();
  const limit = options.limit ?? 200;
  const whereClauses: string[] = [];
  const queryParams: Array<string | number> = [];

  // By default exclude private invoices
  if (!options.includePrivate) {
    whereClauses.push("COALESCE(invoices.is_private, 0) = 0");
  }

  // PERFORMANCE (INFETCH-99): statuses[] → IN (?,...) statt N×getInvoices()-Calls
  if (options.statuses && options.statuses.length > 0) {
    const placeholders = options.statuses.map(() => "?").join(", ");
    whereClauses.push(`invoices.status IN (${placeholders})`);
    queryParams.push(...options.statuses);
  } else if (options.status) {
    whereClauses.push("invoices.status = ?");
    queryParams.push(options.status);
  }
  if (options.year) {
    whereClauses.push("strftime('%Y', COALESCE(invoices.invoice_date, invoices.created_at)) = ?");
    queryParams.push(options.year);
  }
  if (options.search) {
    whereClauses.push("(vendors.name LIKE ? OR invoices.invoice_number LIKE ?)");
    queryParams.push(`%${options.search}%`, `%${options.search}%`);
  }

  const where = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";
  queryParams.push(limit);

  return db
    .prepare(
      `SELECT
        invoices.id,
        invoices.status,
        invoices.source,
        invoices.invoice_number AS invoiceNumber,
        invoices.invoice_date AS invoiceDate,
        invoices.created_at AS createdAt,
        invoices.amount_gross AS amountGross,
        invoices.currency,
        invoices.confidence,
        (
          SELECT ai_extractions.status
          FROM ai_extractions
          WHERE ai_extractions.invoice_id = invoices.id
          ORDER BY ai_extractions.created_at DESC, ai_extractions.id DESC
          LIMIT 1
        ) AS aiStatus,
        vendors.name AS vendorName,
        (
          SELECT COALESCE(
            (SELECT alias FROM vendor_aliases WHERE vendor_id = vendors.id AND match_type = 'domain' ORDER BY priority ASC, LENGTH(alias) ASC LIMIT 1),
            (SELECT from_domain FROM discovered_senders WHERE matched_vendor_id = vendors.id ORDER BY pdf_count DESC LIMIT 1)
          )
        ) AS vendorDomain
       FROM invoices
       LEFT JOIN vendors ON vendors.id = invoices.vendor_id
       ${where}
       ORDER BY COALESCE(invoices.invoice_date, invoices.created_at) DESC
       LIMIT ?`,
    )
    .all(...queryParams) as Array<{
      id: number;
      status: string;
      source: string;
      invoiceNumber: string | null;
      invoiceDate: string | null;
      createdAt: string;
      amountGross: number | null;
      currency: string | null;
      confidence: number | null;
      aiStatus: string | null;
      vendorName: string | null;
      vendorDomain: string | null;
    }>;
}

export function getInvoiceYears(): number[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT strftime('%Y', COALESCE(invoice_date, created_at)) AS year
       FROM invoices
       ORDER BY year DESC`,
    )
    .all() as Array<{ year: string }>;
  return rows.map((r) => parseInt(r.year, 10)).filter((y) => !isNaN(y));
}

export function getInvoiceStatusCounts() {
  const db = getDb();
  return db
    .prepare(`SELECT status, COUNT(*) AS count FROM invoices WHERE COALESCE(is_private, 0) = 0 GROUP BY status`)
    .all() as Array<{ status: string; count: number }>;
}

export function getPrivateInvoiceCount(): number {
  const db = getDb();
  return (
    db.prepare(`SELECT COUNT(*) AS count FROM invoices WHERE COALESCE(is_private, 0) = 1`).get() as { count: number }
  ).count;
}

export function getPrivateInvoices(options: { year?: string; search?: string } = {}) {
  const db = getDb();
  const whereClauses: string[] = ["COALESCE(invoices.is_private, 0) = 1"];
  const queryParams: Array<string | number> = [];

  if (options.year) {
    whereClauses.push("strftime('%Y', COALESCE(invoices.invoice_date, invoices.created_at)) = ?");
    queryParams.push(options.year);
  }
  if (options.search) {
    whereClauses.push("(vendors.name LIKE ? OR invoices.invoice_number LIKE ?)");
    queryParams.push(`%${options.search}%`, `%${options.search}%`);
  }

  const where = `WHERE ${whereClauses.join(" AND ")}`;
  queryParams.push(200);

  return db
    .prepare(
      `SELECT
        invoices.id,
        invoices.status,
        invoices.source,
        invoices.invoice_number AS invoiceNumber,
        invoices.invoice_date AS invoiceDate,
        invoices.created_at AS createdAt,
        invoices.amount_gross AS amountGross,
        invoices.currency,
        invoices.confidence,
        NULL AS aiStatus,
        vendors.name AS vendorName,
        (
          SELECT COALESCE(
            (SELECT alias FROM vendor_aliases WHERE vendor_id = vendors.id AND match_type = 'domain' ORDER BY priority ASC, LENGTH(alias) ASC LIMIT 1),
            (SELECT from_domain FROM discovered_senders WHERE matched_vendor_id = vendors.id ORDER BY pdf_count DESC LIMIT 1)
          )
        ) AS vendorDomain
       FROM invoices
       LEFT JOIN vendors ON vendors.id = invoices.vendor_id
       ${where}
       ORDER BY COALESCE(invoices.invoice_date, invoices.created_at) DESC
       LIMIT ?`,
    )
    .all(...queryParams) as Array<{
      id: number;
      status: string;
      source: string;
      invoiceNumber: string | null;
      invoiceDate: string | null;
      createdAt: string;
      amountGross: number | null;
      currency: string | null;
      confidence: number | null;
      aiStatus: string | null;
      vendorName: string | null;
      vendorDomain: string | null;
    }>;
}

export function getInvoiceDetail(invoiceId: number) {
  const db = getDb();
  const invoice = db
    .prepare(
      `SELECT
        invoices.id,
        invoices.vendor_id AS vendorId,
        invoices.source,
        invoices.status,
        invoices.invoice_number AS invoiceNumber,
        invoices.invoice_date AS invoiceDate,
        invoices.service_period_start AS servicePeriodStart,
        invoices.service_period_end AS servicePeriodEnd,
        invoices.amount_gross AS amountGross,
        invoices.amount_net AS amountNet,
        invoices.vat_amount AS vatAmount,
        invoices.currency,
        invoices.confidence,
        invoices.dedupe_key AS dedupeKey,
        invoices.duplicate_of_invoice_id AS duplicateOfInvoiceId,
        invoices.raw_text_path AS rawTextPath,
        invoices.vat_rate AS vatRate,
        invoices.doc_type AS docType,
        invoices.preferred_export_target_id AS preferredExportTargetId,
        invoices.created_at AS createdAt,
        invoices.updated_at AS updatedAt,
        vendors.name AS vendorName,
        (
          SELECT COALESCE(
            (SELECT alias FROM vendor_aliases WHERE vendor_id = vendors.id AND match_type = 'domain' ORDER BY priority ASC, LENGTH(alias) ASC LIMIT 1),
            (SELECT from_domain FROM discovered_senders WHERE matched_vendor_id = vendors.id ORDER BY pdf_count DESC LIMIT 1)
          )
        ) AS vendorDomain,
        duplicate_vendors.name AS duplicateVendorName,
        duplicate_invoices.invoice_number AS duplicateInvoiceNumber
       FROM invoices
       LEFT JOIN vendors ON vendors.id = invoices.vendor_id
       LEFT JOIN invoices AS duplicate_invoices ON duplicate_invoices.id = invoices.duplicate_of_invoice_id
       LEFT JOIN vendors AS duplicate_vendors ON duplicate_vendors.id = duplicate_invoices.vendor_id
       WHERE invoices.id = ?`,
    )
    .get(invoiceId) as
    | {
        id: number;
        vendorId: number | null;
        source: string;
        status: string;
        invoiceNumber: string | null;
        invoiceDate: string | null;
        servicePeriodStart: string | null;
        servicePeriodEnd: string | null;
        amountGross: number | null;
        amountNet: number | null;
        vatAmount: number | null;
        currency: string | null;
        confidence: number | null;
        dedupeKey: string | null;
        duplicateOfInvoiceId: number | null;
        rawTextPath: string | null;
        vatRate: number | null;
        docType: string | null;
        preferredExportTargetId: number | null;
        createdAt: string;
        updatedAt: string;
        vendorName: string | null;
        vendorDomain: string | null;
        duplicateVendorName: string | null;
        duplicateInvoiceNumber: string | null;
      }
    | undefined;

  if (!invoice) return null;

  const files = db
    .prepare(
      `SELECT id, original_filename AS originalFilename, stored_path AS storedPath, sha256,
        size_bytes AS sizeBytes, mime_type AS mimeType, source_type AS sourceType,
        source_ref_id AS sourceRefId, created_at AS createdAt
       FROM invoice_files
       WHERE invoice_id = ?
       ORDER BY created_at DESC, id DESC`,
    )
    .all(invoiceId) as Array<{
      id: number;
      originalFilename: string;
      storedPath: string;
      sha256: string;
      sizeBytes: number;
      mimeType: string;
      sourceType: string;
      sourceRefId: string | null;
      createdAt: string;
    }>;

  const latestExtraction = db
    .prepare(
      `SELECT id, provider, model, prompt_version AS promptVersion, status, error,
        output_json AS outputJson, created_at AS createdAt
       FROM ai_extractions
       WHERE invoice_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
    .get(invoiceId) as
    | {
        id: number;
        provider: string;
        model: string | null;
        promptVersion: string;
        status: string;
        error: string | null;
        outputJson: string | null;
        createdAt: string;
      }
    | undefined;

  const events = db
    .prepare(
      `SELECT id, level, event_type AS eventType, year_month AS yearMonth, message, metadata_json AS metadataJson,
        created_at AS createdAt
       FROM sync_events
       WHERE invoice_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 25`,
    )
    .all(invoiceId) as Array<{
      id: number;
      level: string;
      eventType: string;
      yearMonth: string | null;
      message: string;
      metadataJson: string;
      createdAt: string;
    }>;

  return {
    ...invoice,
    files,
    latestExtraction: latestExtraction
      ? {
          ...latestExtraction,
          output: latestExtraction.outputJson ? safeParseJson(latestExtraction.outputJson) : null,
        }
      : null,
    events: events.map((event) => ({
      ...event,
      metadata: safeParseJson(event.metadataJson),
    })),
  };
}

export function getInvoiceReviewOptions(currentInvoiceId: number, limit = 50) {
  const db = getDb();
  return db
    .prepare(
      `SELECT invoices.id, invoices.invoice_number AS invoiceNumber, invoices.invoice_date AS invoiceDate,
        invoices.amount_gross AS amountGross, invoices.currency, invoices.status,
        vendors.name AS vendorName
       FROM invoices
       LEFT JOIN vendors ON vendors.id = invoices.vendor_id
       WHERE invoices.id != ?
       ORDER BY invoices.created_at DESC, invoices.id DESC
       LIMIT ?`,
    )
    .all(currentInvoiceId, limit) as Array<{
      id: number;
      invoiceNumber: string | null;
      invoiceDate: string | null;
      amountGross: number | null;
      currency: string | null;
      status: string;
      vendorName: string | null;
    }>;
}

export type VendorRow = {
  id: number;
  name: string;
  canonicalKey: string;
  category: string;
  portalEnabled: number;
  hidden: number;
  portalLoginUrl: string | null;
  portalCategory: string | null;
};

export function getVendors(): VendorRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, name, canonical_key AS canonicalKey, category, portal_enabled AS portalEnabled, hidden,
        portal_login_url AS portalLoginUrl, portal_category AS portalCategory
       FROM vendors
       ORDER BY name COLLATE NOCASE`,
    )
    .all() as VendorRow[];
}

export function findVendorByCanonicalKey(canonicalKey: string): VendorRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, name, canonical_key AS canonicalKey, category, portal_enabled AS portalEnabled, hidden,
        portal_login_url AS portalLoginUrl, portal_category AS portalCategory
       FROM vendors WHERE canonical_key = ? LIMIT 1`,
    )
    .get(canonicalKey) as VendorRow | undefined;
  return row ?? null;
}

export function upsertVendor(input: {
  name: string;
  canonicalKey: string;
  category?: string;
  portalLoginUrl?: string | null;
  portalCategory?: string | null;
}): VendorRow {
  const db = getDb();
  const existing = findVendorByCanonicalKey(input.canonicalKey);
  if (existing) {
    db.prepare(
      `UPDATE vendors SET name = ?, category = COALESCE(?, category),
         portal_login_url = COALESCE(?, portal_login_url),
         portal_category = COALESCE(?, portal_category),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(input.name, input.category ?? null, input.portalLoginUrl ?? null, input.portalCategory ?? null, existing.id);
  } else {
    db.prepare(
      `INSERT INTO vendors (name, canonical_key, category, portal_enabled, portal_login_url, portal_category)
       VALUES (?, ?, ?, 0, ?, ?)`,
    ).run(input.name, input.canonicalKey, input.category ?? "unknown", input.portalLoginUrl ?? null, input.portalCategory ?? null);
  }
  return findVendorByCanonicalKey(input.canonicalKey)!;
}

export type MissingItem = {
  vendorId: number;
  vendorName: string;
  vendorCanonicalKey: string;
  vendorDomain: string | null;
  portalAvailable: boolean;
  /** Most urgent / most recent missing yearMonth for this vendor. */
  yearMonth: string;
  /** Total number of missing months for this vendor. */
  missingMonths: number;
  finalStatus: string;
  portalStatus: string;
  bucket: "help" | "auto" | "wait";
  avgAmount: number | null;
};

const BUCKET_PRIORITY: Record<MissingItem["bucket"], number> = { help: 0, auto: 1, wait: 2 };

export function getMissingItems(): MissingItem[] {
  const db = getDb();
  // Query ordered: name ASC, yearMonth DESC — so first row per vendor = most recent month
  const rows = db
    .prepare(
      `SELECT v.id AS vendorId, v.name AS vendorName, v.canonical_key AS vendorCanonicalKey,
        v.portal_enabled AS portalEnabled,
        vms.year_month AS yearMonth, vms.final_status AS finalStatus, vms.portal_status AS portalStatus,
        (
          SELECT COALESCE(
            (SELECT alias FROM vendor_aliases WHERE vendor_id = v.id AND match_type = 'domain' ORDER BY priority ASC, LENGTH(alias) ASC LIMIT 1),
            (SELECT from_domain FROM discovered_senders WHERE matched_vendor_id = v.id ORDER BY pdf_count DESC LIMIT 1)
          )
        ) AS vendorDomain,
        (
          SELECT AVG(i.amount_gross)
          FROM invoices i
          WHERE i.vendor_id = v.id AND i.status = 'exported' AND i.amount_gross IS NOT NULL
        ) AS avgAmount
       FROM vendor_month_status vms
       JOIN vendors v ON v.id = vms.vendor_id
       WHERE v.hidden = 0 AND vms.final_status IN ('missing', 'action_required', 'unchecked')
       ORDER BY v.name ASC, vms.year_month DESC`,
    )
    .all() as Array<{
      vendorId: number;
      vendorName: string;
      vendorCanonicalKey: string;
      portalEnabled: number;
      yearMonth: string;
      finalStatus: string;
      portalStatus: string;
      vendorDomain: string | null;
      avgAmount: number | null;
    }>;

  // Deduplicate: one row per vendor — keep most urgent bucket, most recent month within bucket
  type Entry = { item: MissingItem; count: number };
  const vendorMap = new Map<number, Entry>();

  for (const r of rows) {
    const portalAvailable = Boolean(r.portalEnabled);
    let bucket: MissingItem["bucket"];
    if (r.finalStatus === "action_required") bucket = "help";
    else if (r.portalStatus === "required" || r.portalStatus === "running") bucket = "auto";
    else bucket = "wait";

    const item: MissingItem = {
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      vendorCanonicalKey: r.vendorCanonicalKey,
      vendorDomain: r.vendorDomain,
      portalAvailable,
      yearMonth: r.yearMonth,
      missingMonths: 1,
      finalStatus: r.finalStatus,
      portalStatus: r.portalStatus,
      bucket,
      avgAmount: r.avgAmount ?? null,
    };

    const existing = vendorMap.get(r.vendorId);
    if (!existing) {
      vendorMap.set(r.vendorId, { item, count: 1 });
      continue;
    }
    existing.count++;
    // Replace representative row if this bucket has higher priority, or same priority + more recent
    const curPri = BUCKET_PRIORITY[bucket];
    const prevPri = BUCKET_PRIORITY[existing.item.bucket];
    if (curPri < prevPri || (curPri === prevPri && r.yearMonth > existing.item.yearMonth)) {
      existing.item = item;
    }
  }

  return Array.from(vendorMap.values())
    .map(({ item, count }) => ({ ...item, missingMonths: count }))
    .sort((a, b) => {
      const pa = BUCKET_PRIORITY[a.bucket];
      const pb = BUCKET_PRIORITY[b.bucket];
      if (pa !== pb) return pa - pb;
      return a.vendorName.localeCompare(b.vendorName, "de");
    });
}

// getPortalOverview entfernt — /portals-Seite gibt es nicht mehr.
// Online-Konto-Status kommt jetzt aus portal_run_logs pro Vendor.

export function getMissingMatrix(includeHidden = false) {
  const db = getDb();
  const allVendors = getVendors();
  const vendors = includeHidden ? allVendors : allVendors.filter((v) => v.hidden === 0);
  const months = Array.from({ length: appConfig.syncMonthsBack }, (_, index) =>
    format(subMonths(new Date(), appConfig.syncMonthsBack - index - 1), "yyyy-MM"),
  );
  const statuses = db
    .prepare(
      `SELECT vendor_id AS vendorId, year_month AS yearMonth, mail_status AS mailStatus,
        portal_status AS portalStatus, manual_status AS manualStatus,
        final_status AS finalStatus, source_used AS sourceUsed
       FROM vendor_month_status`,
    )
    .all() as Array<{
      vendorId: number;
      yearMonth: string;
      mailStatus: string;
      portalStatus: string;
      manualStatus: string;
      finalStatus: string;
      sourceUsed: string;
    }>;
  const statusByVendorMonth = new Map(statuses.map((status) => [`${status.vendorId}:${status.yearMonth}`, status]));

  return vendors.map((vendor) => ({
    vendor,
    months: months.map((month) => {
      const row = statusByVendorMonth.get(`${vendor.id}:${month}`);
      return {
        month,
        status: row ? getMatrixCellStatus(row) : "unchecked",
        source: row?.sourceUsed || "none",
      };
    }),
  }));
}

function getMatrixCellStatus(row: {
  finalStatus: string;
  sourceUsed: string;
  portalStatus: string;
}) {
  if (row.finalStatus === "found" && row.sourceUsed !== "none") return row.sourceUsed;
  if (row.portalStatus === "required") return "required";
  if (row.portalStatus === "running") return "running";
  if (row.finalStatus === "missing") return "missing";
  if (row.portalStatus === "disabled") return "disabled";
  return row.finalStatus;
}

export function getRuns(limit = 40) {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, type, status, triggered_by AS triggeredBy, summary_json AS summaryJson, started_at AS startedAt,
        finished_at AS finishedAt, created_at AS createdAt
       FROM sync_runs
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
      id: number;
      type: string;
      status: string;
      triggeredBy: string;
      summaryJson: string;
      startedAt: string | null;
      finishedAt: string | null;
      createdAt: string;
    }>;
}

export function getDownloads(limit = 50) {
  const db = getDb();
  return db
    .prepare(
      `SELECT invoice_files.id, invoice_files.invoice_id AS invoiceId, invoice_files.original_filename AS originalFilename,
        invoice_files.stored_path AS storedPath, invoice_files.sha256, invoice_files.size_bytes AS sizeBytes,
        invoice_files.source_type AS sourceType, invoices.status AS invoiceStatus,
        (
          SELECT ai_extractions.status
          FROM ai_extractions
          WHERE ai_extractions.invoice_id = invoices.id
          ORDER BY ai_extractions.created_at DESC, ai_extractions.id DESC
          LIMIT 1
        ) AS aiStatus,
        vendors.name AS vendorName
       FROM invoice_files
       LEFT JOIN invoices ON invoices.id = invoice_files.invoice_id
       LEFT JOIN vendors ON vendors.id = invoices.vendor_id
       ORDER BY invoice_files.created_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
      id: number;
      invoiceId: number | null;
      originalFilename: string;
      storedPath: string;
      sha256: string;
      sizeBytes: number;
      sourceType: string;
      invoiceStatus: string | null;
      aiStatus: string | null;
      vendorName: string | null;
    }>;
}

export function getExportQueue(limit = 200) {
  const db = getDb();
  return db
    .prepare(
      `SELECT exports.id, exports.invoice_id AS invoiceId, exports.status,
        exports.attempt_count AS attemptCount,
        exports.last_error AS lastError, exports.sent_at AS sentAt,
        export_targets.label AS targetLabel, invoices.invoice_date AS invoiceDate,
        invoices.amount_gross AS amountGross, invoices.currency, vendors.name AS vendorName
       FROM exports
       JOIN export_targets ON export_targets.id = exports.export_target_id
       JOIN invoices ON invoices.id = exports.invoice_id
       LEFT JOIN vendors ON vendors.id = invoices.vendor_id
       ORDER BY exports.status ASC, exports.created_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
      id: number;
      invoiceId: number;
      status: string;
      attemptCount: number;
      lastError: string | null;
      sentAt: string | null;
      targetLabel: string;
      invoiceDate: string | null;
      amountGross: number | null;
      currency: string | null;
      vendorName: string | null;
    }>;
}

export function getExportStats() {
  const db = getDb();
  return db
    .prepare(
      `SELECT export_targets.label AS targetLabel, exports.status, COUNT(*) AS count
       FROM exports
       JOIN export_targets ON export_targets.id = exports.export_target_id
       GROUP BY export_targets.id, exports.status`,
    )
    .all() as Array<{ targetLabel: string; status: string; count: number }>;
}

export function getCredentialSummaries() {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, scope, label, secret_store AS secretStore, status, last_verified_at AS lastVerifiedAt
       FROM credential_refs
       ORDER BY scope, label`,
    )
    .all() as Array<{
      id: number;
      scope: string;
      label: string;
      secretStore: string;
      status: string;
      lastVerifiedAt: string | null;
    }>;
}

export type MailAccountSummary = {
  id: number;
  label: string;
  host: string;
  port: number;
  secure: number;
  username: string;
  status: string;
  lastVerifiedAt: string | null;
};

export function getPrimaryMailAccount() {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, label, host, port, secure, username, status, last_verified_at AS lastVerifiedAt
       FROM mail_accounts
       WHERE label = 'Primary IMAP'
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get() as MailAccountSummary | undefined;
}

export function getSecondaryMailAccount() {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, label, host, port, secure, username, status, last_verified_at AS lastVerifiedAt
       FROM mail_accounts
       WHERE label = 'Secondary IMAP'
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get() as MailAccountSummary | undefined;
}

export function getPrimarySmtpAccount() {
  return getStoredSmtpAccount("primary");
}

export function getSecondarySmtpAccount() {
  return getStoredSmtpAccount("secondary");
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export type AutoApprovalRule = {
  id: number;
  vendorId: number | null;
  vendorPattern: string | null;
  maxAmountCents: number | null;
  enabled: boolean;
  vendorName: string | null;
  createdAt: string;
  updatedAt: string;
};

type AutoApprovalRow = {
  id: number;
  vendor_id: number | null;
  vendor_pattern: string | null;
  max_amount_cents: number | null;
  enabled: number;
  vendor_name: string | null;
  created_at: string;
  updated_at: string;
};

function mapAutoApprovalRow(row: AutoApprovalRow): AutoApprovalRule {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    vendorPattern: row.vendor_pattern,
    maxAmountCents: row.max_amount_cents,
    enabled: row.enabled === 1,
    vendorName: row.vendor_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listAutoApprovalRules(db: Database.Database = getDb()): AutoApprovalRule[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.vendor_id, r.vendor_pattern, r.max_amount_cents, r.enabled,
              r.created_at, r.updated_at, v.name AS vendor_name
       FROM auto_approval_rules r
       LEFT JOIN vendors v ON v.id = r.vendor_id
       ORDER BY r.enabled DESC, COALESCE(v.name, r.vendor_pattern) ASC`,
    )
    .all() as AutoApprovalRow[];
  return rows.map(mapAutoApprovalRow);
}

export function getAutoApprovalRulesForVendor(
  vendorId: number | null,
  vendorName: string | null,
  db: Database.Database = getDb(),
): AutoApprovalRule[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.vendor_id, r.vendor_pattern, r.max_amount_cents, r.enabled,
              r.created_at, r.updated_at, v.name AS vendor_name
       FROM auto_approval_rules r
       LEFT JOIN vendors v ON v.id = r.vendor_id
       WHERE r.enabled = 1
         AND (
           (r.vendor_id IS NOT NULL AND r.vendor_id = ?)
           OR (r.vendor_pattern IS NOT NULL
               AND ? IS NOT NULL
               AND LOWER(?) LIKE '%' || LOWER(r.vendor_pattern) || '%')
         )`,
    )
    .all(vendorId, vendorName, vendorName) as AutoApprovalRow[];
  return rows.map(mapAutoApprovalRow);
}

export function upsertAutoApprovalRule(input: {
  id?: number;
  vendorId: number | null;
  vendorPattern: string | null;
  maxAmountCents: number | null;
  enabled: boolean;
  db?: Database.Database;
}): AutoApprovalRule {
  const db = input.db ?? getDb();
  if (input.id) {
    db.prepare(
      `UPDATE auto_approval_rules
       SET vendor_id = ?, vendor_pattern = ?, max_amount_cents = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(
      input.vendorId,
      input.vendorPattern,
      input.maxAmountCents,
      input.enabled ? 1 : 0,
      input.id,
    );
    const updated = db
      .prepare(
        `SELECT r.id, r.vendor_id, r.vendor_pattern, r.max_amount_cents, r.enabled,
                r.created_at, r.updated_at, v.name AS vendor_name
         FROM auto_approval_rules r
         LEFT JOIN vendors v ON v.id = r.vendor_id
         WHERE r.id = ?`,
      )
      .get(input.id) as AutoApprovalRow;
    return mapAutoApprovalRow(updated);
  }
  const info = db
    .prepare(
      `INSERT INTO auto_approval_rules (vendor_id, vendor_pattern, max_amount_cents, enabled)
       VALUES (?, ?, ?, ?)`,
    )
    .run(input.vendorId, input.vendorPattern, input.maxAmountCents, input.enabled ? 1 : 0);
  const inserted = db
    .prepare(
      `SELECT r.id, r.vendor_id, r.vendor_pattern, r.max_amount_cents, r.enabled,
              r.created_at, r.updated_at, v.name AS vendor_name
       FROM auto_approval_rules r
       LEFT JOIN vendors v ON v.id = r.vendor_id
       WHERE r.id = ?`,
    )
    .get(info.lastInsertRowid) as AutoApprovalRow;
  return mapAutoApprovalRow(inserted);
}

export function deleteAutoApprovalRule(id: number, db: Database.Database = getDb()): void {
  db.prepare(`DELETE FROM auto_approval_rules WHERE id = ?`).run(id);
}

export type IntegrationProvider = "lexoffice" | "sevdesk" | "datev";

export type IntegrationTarget = {
  id: number;
  provider: IntegrationProvider;
  label: string;
  oauthTokenRef: string | null;
  externalAccountId: string | null;
  enabled: boolean;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type IntegrationRow = {
  id: number;
  provider: string;
  label: string;
  oauth_token_ref: string | null;
  external_account_id: string | null;
  enabled: number;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapIntegrationRow(row: IntegrationRow): IntegrationTarget {
  return {
    id: row.id,
    provider: row.provider as IntegrationProvider,
    label: row.label,
    oauthTokenRef: row.oauth_token_ref,
    externalAccountId: row.external_account_id,
    enabled: row.enabled === 1,
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listIntegrationTargets(db: Database.Database = getDb()): IntegrationTarget[] {
  const rows = db
    .prepare(
      `SELECT id, provider, label, oauth_token_ref, external_account_id, enabled,
              last_verified_at, created_at, updated_at
       FROM integration_targets
       ORDER BY enabled DESC, provider ASC`,
    )
    .all() as IntegrationRow[];
  return rows.map(mapIntegrationRow);
}

export function getIntegrationTarget(
  provider: IntegrationProvider,
  db: Database.Database = getDb(),
): IntegrationTarget | null {
  const row = db
    .prepare(
      `SELECT id, provider, label, oauth_token_ref, external_account_id, enabled,
              last_verified_at, created_at, updated_at
       FROM integration_targets
       WHERE provider = ?`,
    )
    .get(provider) as IntegrationRow | undefined;
  return row ? mapIntegrationRow(row) : null;
}

export function getActiveIntegrationTarget(
  db: Database.Database = getDb(),
): IntegrationTarget | null {
  const row = db
    .prepare(
      `SELECT id, provider, label, oauth_token_ref, external_account_id, enabled,
              last_verified_at, created_at, updated_at
       FROM integration_targets
       WHERE enabled = 1
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get() as IntegrationRow | undefined;
  return row ? mapIntegrationRow(row) : null;
}

export function upsertIntegrationTarget(input: {
  provider: IntegrationProvider;
  label: string;
  oauthTokenRef?: string | null;
  externalAccountId?: string | null;
  enabled?: boolean;
  db?: Database.Database;
}): IntegrationTarget {
  const db = input.db ?? getDb();
  const enabledFlag = (input.enabled ?? true) ? 1 : 0;
  db.prepare(
    `INSERT INTO integration_targets (provider, label, oauth_token_ref, external_account_id, enabled)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       label = excluded.label,
       oauth_token_ref = COALESCE(excluded.oauth_token_ref, integration_targets.oauth_token_ref),
       external_account_id = COALESCE(excluded.external_account_id, integration_targets.external_account_id),
       enabled = excluded.enabled,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(
    input.provider,
    input.label,
    input.oauthTokenRef ?? null,
    input.externalAccountId ?? null,
    enabledFlag,
  );
  const target = getIntegrationTarget(input.provider, db);
  if (!target) throw new Error(`Integration ${input.provider} not found after upsert`);
  return target;
}

export function disableIntegrationTarget(
  provider: IntegrationProvider,
  db: Database.Database = getDb(),
): void {
  db.prepare(
    `UPDATE integration_targets SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE provider = ?`,
  ).run(provider);
}

export function markIntegrationVerified(
  provider: IntegrationProvider,
  db: Database.Database = getDb(),
): void {
  db.prepare(
    `UPDATE integration_targets SET last_verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE provider = ?`,
  ).run(provider);
}

export function recordInvoiceExternalRef(
  invoiceId: number,
  externalRef: string,
  provider: IntegrationProvider,
  db: Database.Database = getDb(),
): void {
  db.prepare(
    `UPDATE invoices
     SET external_ref = ?, external_ref_provider = ?, external_ref_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(externalRef, provider, invoiceId);
}

// ─── Review Navigation ────────────────────────────────────────────────────────

/**
 * Gibt die IDs der vorherigen und nächsten Rechnung zurück,
 * bezogen auf die Review-Queue (needs_review, new, failed).
 */
export function getAdjacentInvoiceIds(
  invoiceId: number,
  statuses = ["needs_review", "new", "failed"],
): { prevId: number | null; nextId: number | null; position: number; total: number } {
  // PERFORMANCE (INFETCH-100): Vorher wurden ALLE IDs der Queue geladen und per
  // JS findIndex() gesucht — O(n) auf dem Client, riesige Arrays bei großen Queues.
  // Jetzt: LAG/LEAD-Window-Functions lösen das direkt in SQLite → 1 Zeile zurück.
  const db = getDb();
  const placeholders = statuses.map(() => "?").join(", ");

  type QueueRow = {
    prevId: number | null;
    nextId: number | null;
    position: number;
    total: number;
  };

  const row = db
    .prepare(
      `WITH queue AS (
         SELECT
           id,
           LAG(id)  OVER (ORDER BY COALESCE(invoice_date, created_at) DESC, id DESC) AS prevId,
           LEAD(id) OVER (ORDER BY COALESCE(invoice_date, created_at) DESC, id DESC) AS nextId,
           ROW_NUMBER() OVER (ORDER BY COALESCE(invoice_date, created_at) DESC, id DESC) AS rn,
           COUNT(*) OVER () AS total
         FROM invoices
         WHERE status IN (${placeholders})
       )
       SELECT prevId, nextId, CAST(rn AS INTEGER) AS position, CAST(total AS INTEGER) AS total
       FROM queue
       WHERE id = ?
       LIMIT 1`,
    )
    .get(...statuses, invoiceId) as QueueRow | undefined;

  if (!row) {
    // Invoice not in queue — compute total separately for the position indicator
    const total = (
      db
        .prepare(`SELECT COUNT(*) AS count FROM invoices WHERE status IN (${placeholders})`)
        .get(...statuses) as { count: number }
    ).count;
    return { prevId: null, nextId: null, position: 0, total };
  }

  return row;
}

// ─── Dashboard: neue Queries ───────────────────────────────────────────────────

export type MonthlyKpis = {
  total: number;
  sumGross: number;
  prevTotal: number;
  prevSumGross: number;
  deltaPercent: number | null;
};

/**
 * KPIs für einen Monat (YYYY-MM) und den Vormonat.
 * Basiert auf exported invoices (status = 'exported' oder exports.status = 'sent').
 */
export function getMonthlyKpis(month: string): MonthlyKpis {
  const db = getDb();
  const [yearStr, mStr] = month.split("-");
  const year = parseInt(yearStr ?? "0", 10);
  const m = parseInt(mStr ?? "1", 10);
  const prevYear = m === 1 ? year - 1 : year;
  const prevM = m === 1 ? 12 : m - 1;
  const prevMonth = `${prevYear}-${String(prevM).padStart(2, "0")}`;

  type KpiRow = { total: number; sumGross: number | null };

  const getKpi = (mo: string): KpiRow =>
    db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(amount_gross) AS sumGross
         FROM invoices
         WHERE status = 'exported'
           AND invoice_date LIKE ? || '%'`,
      )
      .get(mo) as KpiRow;

  const cur = getKpi(month);
  const prev = getKpi(prevMonth);

  const total = cur.total ?? 0;
  const prevTotal = prev.total ?? 0;
  const sumGross = cur.sumGross ?? 0;
  const prevSumGross = prev.sumGross ?? 0;
  const deltaPercent =
    prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;

  return { total, sumGross, prevTotal, prevSumGross, deltaPercent };
}

/**
 * Tages-Zeitreihe der exportierten Rechnungen für die letzten N Tage.
 * Lücken werden als 0 aufgefüllt.
 */
export function getDailyTimeseries(days: number): Array<{ date: string; count: number }> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', COALESCE(invoice_date, created_at)) AS date, COUNT(*) AS count
       FROM invoices
       WHERE status = 'exported'
         AND COALESCE(invoice_date, created_at) >= date('now', ? || ' days')
       GROUP BY date
       ORDER BY date ASC`,
    )
    .all(`-${days}`) as Array<{ date: string; count: number }>;

  // Fill gaps
  const map = new Map(rows.map((r) => [r.date, r.count]));
  const result: Array<{ date: string; count: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push({ date: key, count: map.get(key) ?? 0 });
  }
  return result;
}

/**
 * Top-N Lieferanten nach Anzahl exportierter Rechnungen (aktuelle + Vormonat für Delta).
 */
export function getTopVendors(
  limit = 5,
): Array<{
  vendorName: string;
  vendorDomain: string | null;
  count: number;
  sumGross: number;
  deltaPrevMonth: number;
}> {
  const db = getDb();
  const curMonth = new Date().toISOString().slice(0, 7);
  const [yearStr, mStr] = curMonth.split("-");
  const year = parseInt(yearStr ?? "0", 10);
  const m = parseInt(mStr ?? "1", 10);
  const prevMonth = `${m === 1 ? year - 1 : year}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;

  // PERFORMANCE (INFETCH-96): Vorher N+1 — 2 separate DB-Queries pro Vendor im
  // .map()-Loop. Jetzt alles in einer Query mit konditionalen SUMs.
  type Row = {
    vendorName: string;
    vendorDomain: string | null;
    count: number;
    sumGross: number | null;
    curCount: number;
    prevCount: number;
  };

  return (
    db
      .prepare(
        `SELECT
           v.name AS vendorName,
           COALESCE(
             (SELECT alias FROM vendor_aliases WHERE vendor_id = v.id AND match_type = 'domain' ORDER BY priority ASC LIMIT 1),
             (SELECT from_domain FROM discovered_senders WHERE matched_vendor_id = v.id ORDER BY pdf_count DESC LIMIT 1)
           ) AS vendorDomain,
           COUNT(*) AS count,
           SUM(i.amount_gross) AS sumGross,
           SUM(CASE WHEN i.invoice_date LIKE ? || '%' THEN 1 ELSE 0 END) AS curCount,
           SUM(CASE WHEN i.invoice_date LIKE ? || '%' THEN 1 ELSE 0 END) AS prevCount
         FROM invoices i
         JOIN vendors v ON v.id = i.vendor_id
         WHERE i.status = 'exported'
         GROUP BY v.id
         ORDER BY count DESC
         LIMIT ?`,
      )
      .all(curMonth, prevMonth, limit) as Row[]
  ).map((row) => ({
    vendorName: row.vendorName,
    vendorDomain: row.vendorDomain,
    count: row.count,
    sumGross: row.sumGross ?? 0,
    deltaPrevMonth: (row.curCount ?? 0) - (row.prevCount ?? 0),
  }));
}

/**
 * Lieferanten, bei denen seit >60 Tagen keine Rechnung mehr eingegangen ist,
 * obwohl zuvor mind. 2 Rechnungen eingingen (= überfällig).
 */
export function getOverdueVendors(): Array<{
  vendorName: string;
  vendorDomain: string | null;
  daysSince: number;
}> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
         v.name AS vendorName,
         (SELECT ds.from_domain FROM discovered_senders ds
          WHERE ds.matched_vendor_id = v.id
          ORDER BY ds.pdf_count DESC LIMIT 1) AS vendorDomain,
         CAST(julianday('now') - julianday(MAX(COALESCE(i.invoice_date, i.created_at))) AS INTEGER) AS daysSince
       FROM invoices i
       JOIN vendors v ON v.id = i.vendor_id
       GROUP BY v.id
       HAVING COUNT(*) >= 2
          AND daysSince > 60
       ORDER BY daysSince DESC
       LIMIT 10`,
    )
    .all() as Array<{ vendorName: string; vendorDomain: string | null; daysSince: number }>;
  return rows;
}

/**
 * Returns the ISO timestamp of the first invoice ever received.
 * Used to display "seit 10. Mai 2026" instead of "seit Beobachtungsbeginn".
 */
export function getObservationStartDate(): string | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT MIN(created_at) AS firstAt FROM invoices`)
    .get() as { firstAt: string | null } | undefined;
  return row?.firstAt ?? null;
}

/** ISO-Timestamp des letzten Scan-Events (imap_scan) — für Dashboard-Anzeige. */
export function getLastScanAt(): string | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT MAX(created_at) AS lastAt FROM sync_events WHERE event_type = 'imap_scan'`)
    .get() as { lastAt: string | null } | undefined;
  return row?.lastAt ?? null;
}

export type SecondaryStats = {
  /** Tage, an denen der Auto-Pilot ohne manuellen Eingriff durchgelaufen ist.
   *  Berechnet aus Differenz zwischen heute und dem letzten Eingang eines needs_review-Belegs.
   *  null wenn noch keine Rechnungen vorhanden. */
  daysSinceLastIntervention: number | null;
  /** Durchschnittliche Latenz in Minuten: Invoice-Eingang → Export (gerundet). null wenn keine Daten. */
  avgLatencyMin: number | null;
  /** Anzahl ignorierter/duplizierter Belege im laufenden Monat. */
  filteredThisMonth: number;
  /** Forecast für den Restmonat: ⌀ Tagesdurchschnitt der letzten 30 Tage × verbleibende Tage. null wenn keine Daten. */
  forecastRestMonth: number | null;
};

/**
 * Sekundäre Dashboard-Stats ("Vertrauen" + "Performance").
 * Entspricht den 4 kleinen Stat-Cells im Claude Design unterhalb des KPI-Graphen:
 * Tage ohne Eingriff · ⌀ Latenz · Gefiltert · Forecast.
 */
export function getSecondaryStats(): SecondaryStats {
  const db = getDb();

  // --- Days since last needs_review ---
  const lastReview = db
    .prepare(
      `SELECT CAST(julianday('now') - julianday(MAX(created_at)) AS INTEGER) AS days
       FROM invoices WHERE status = 'needs_review'`,
    )
    .get() as { days: number | null } | undefined;
  const hasExported = (
    db.prepare(`SELECT COUNT(*) AS count FROM exports WHERE status = 'sent'`).get() as { count: number }
  ).count > 0;
  const daysSinceLastIntervention =
    lastReview?.days != null
      ? lastReview.days
      : hasExported
        ? null // no needs_review ever = couldn't determine streak without first export date
        : null;

  // days since first export (used as fallback "running since N days" if no needs_review ever)
  let autopilotDays: number | null = null;
  if (hasExported && lastReview?.days == null) {
    const since = db
      .prepare(
        `SELECT CAST(julianday('now') - julianday(MIN(sent_at)) AS INTEGER) AS days
         FROM exports WHERE status = 'sent'`,
      )
      .get() as { days: number | null } | undefined;
    autopilotDays = since?.days ?? null;
  }

  // --- Avg latency in minutes ---
  const latencyRow = db
    .prepare(
      `SELECT AVG((julianday(e.sent_at) - julianday(i.created_at)) * 24 * 60) AS avgMin
       FROM exports e
       JOIN invoices i ON i.id = e.invoice_id
       WHERE e.status = 'sent' AND e.sent_at IS NOT NULL`,
    )
    .get() as { avgMin: number | null } | undefined;
  const avgLatencyMin =
    latencyRow?.avgMin != null ? Math.round(latencyRow.avgMin) : null;

  // --- Filtered this month ---
  const filteredRow = db
    .prepare(
      `SELECT COUNT(*) AS count FROM invoices
       WHERE status IN ('ignored', 'duplicate')
         AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`,
    )
    .get() as { count: number };
  const filteredThisMonth = filteredRow.count;

  // --- Forecast for rest of month ---
  // daily avg over last 30 days × remaining calendar days
  const dailyAvgRow = db
    .prepare(
      `SELECT COUNT(*) * 1.0 / 30 AS rate
       FROM exports
       WHERE status = 'sent'
         AND sent_at >= datetime('now', '-30 days')`,
    )
    .get() as { rate: number | null } | undefined;
  let forecastRestMonth: number | null = null;
  if (dailyAvgRow?.rate != null && dailyAvgRow.rate > 0) {
    const today = new Date();
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const remaining = lastDay - today.getDate();
    forecastRestMonth = Math.round(dailyAvgRow.rate * remaining);
  }

  return {
    daysSinceLastIntervention:
      lastReview?.days != null
        ? lastReview.days
        : autopilotDays,
    avgLatencyMin,
    filteredThisMonth,
    forecastRestMonth,
  };
}

// ─── Anbieter-Seite ──────────────────────────────────────────────────────────

export type SenderWithStats = {
  id: number;
  fromAddress: string;
  fromDomain: string;
  displayName: string | null;
  mailCount: number;
  pdfCount: number;
  importedCount: number;
  matchedVendorId: number | null;
  matchedVendorName: string | null;
  vendorCategory: string | null;
  /** Manuelle Kategorie, direkt auf dem Sender gesetzt (unabhängig vom Vendor-Match) */
  senderCategory: string | null;
  blocked: boolean;
  blockedReason: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  invoiceSum: number;
};

/**
 * Like listDiscoveredSenders but enriched with vendor category + invoice sum.
 * Sorted by invoiceSum DESC so highest-value vendors appear first.
 */
export function listSendersWithStats(): SenderWithStats[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
         ds.id,
         ds.from_address        AS fromAddress,
         ds.from_domain         AS fromDomain,
         ds.display_name        AS displayName,
         ds.mail_count          AS mailCount,
         ds.pdf_count           AS pdfCount,
         ds.imported_count      AS importedCount,
         ds.matched_vendor_id   AS matchedVendorId,
         ds.blocked,
         ds.blocked_reason      AS blockedReason,
         ds.first_seen_at       AS firstSeenAt,
         ds.last_seen_at        AS lastSeenAt,
         ds.vendor_category     AS senderCategory,
         v.name                 AS matchedVendorName,
         v.category             AS vendorCategory,
         COALESCE((
           SELECT SUM(i.amount_gross)
           FROM invoices i
           WHERE i.vendor_id = ds.matched_vendor_id
             AND i.status = 'exported'
         ), 0) AS invoiceSum
       FROM discovered_senders ds
       LEFT JOIN vendors v ON v.id = ds.matched_vendor_id
       WHERE ds.pdf_count > 0
       ORDER BY invoiceSum DESC, ds.pdf_count DESC, ds.mail_count DESC`,
    )
    .all() as Array<Omit<SenderWithStats, "blocked"> & { blocked: number }>;

  return rows.map((row) => ({ ...row, blocked: row.blocked === 1 }));
}

export type VendorInvoiceRow = {
  id: number;
  status: string;
  invoiceDate: string | null;
  createdAt: string;
  amountGross: number | null;
  currency: string | null;
  invoiceNumber: string | null;
};

/**
 * All invoices for a given vendor, ordered newest-first.
 * Used in the AnbieterDetail view.
 */
export function getVendorInvoices(vendorId: number): VendorInvoiceRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT
         id,
         status,
         invoice_date   AS invoiceDate,
         created_at     AS createdAt,
         amount_gross   AS amountGross,
         currency,
         invoice_number AS invoiceNumber
       FROM invoices
       WHERE vendor_id = ?
       ORDER BY COALESCE(invoice_date, created_at) DESC
       LIMIT 200`,
    )
    .all(vendorId) as VendorInvoiceRow[];
}
