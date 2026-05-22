import { format, subMonths } from "date-fns";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { appConfig } from "@/lib/config/env";
import { getStoredSmtpAccount } from "@/mail/smtp-settings";
import { hasConfiguredCredential } from "@/lib/secrets/credential-store";

type CountRow = { count: string | number };

export type DashboardStats = {
  invoicesTotal: number;
  downloadedPdfs: number;
  needsReview: number;
  duplicates: number;
  missing: number;
  actionRequired: number;
  exportReady: number;
};

export async function getDashboardStats(
  organizationId: string | null,
): Promise<DashboardStats> {
  const c = (rows: CountRow[]) => Number(rows[0]?.count ?? 0);
  return {
    invoicesTotal: c(await sql<CountRow[]>`
      SELECT COUNT(*) AS count FROM invoices
      WHERE organization_id IS NOT DISTINCT FROM ${organizationId}`),
    downloadedPdfs: c(await sql<CountRow[]>`
      SELECT COUNT(*) AS count FROM invoice_files
      WHERE organization_id IS NOT DISTINCT FROM ${organizationId}`),
    needsReview: c(await sql<CountRow[]>`
      SELECT COUNT(*) AS count FROM invoices
      WHERE status = 'needs_review'
        AND organization_id IS NOT DISTINCT FROM ${organizationId}`),
    duplicates: c(await sql<CountRow[]>`
      SELECT COUNT(*) AS count FROM invoices
      WHERE status = 'duplicate'
        AND organization_id IS NOT DISTINCT FROM ${organizationId}`),
    missing: c(await sql<CountRow[]>`
      SELECT COUNT(DISTINCT vendor_id) AS count FROM vendor_month_status
      WHERE final_status = 'missing'
        AND organization_id IS NOT DISTINCT FROM ${organizationId}`),
    actionRequired: c(await sql<CountRow[]>`
      SELECT COUNT(DISTINCT vendor_id) AS count FROM vendor_month_status
      WHERE final_status = 'action_required'
        AND organization_id IS NOT DISTINCT FROM ${organizationId}`),
    exportReady: c(await sql<CountRow[]>`
      SELECT COUNT(*) AS count FROM exports
      WHERE status = 'ready'
        AND organization_id IS NOT DISTINCT FROM ${organizationId}`),
  };
}

type SyncRunType = "imap_scan" | "missing_check" | "portal_fallback" | "ai_analysis" | "export";

type LatestSyncRunRow = { type: SyncRunType; status: string; finishedAt: string | null };

export type PipelineStep = {
  label: string;
  status: string;
  lastRunAt: string | null;
};

export async function getPipelineSnapshot(organizationId: string): Promise<PipelineStep[]> {
  const mistralConfigured = await hasConfiguredCredential("mistral");

  // sync_runs has no organization_id column yet — left global until a
  // follow-up migration adds it. Tracked in MULTITENANCY_HARDENING_PLAN.md.
  const latestRuns = await sql<LatestSyncRunRow[]>`
    SELECT sr.type AS type, sr.status AS status, sr.finished_at AS "finishedAt"
    FROM sync_runs sr
    JOIN (
      SELECT type, MAX(id) AS max_id
      FROM sync_runs
      GROUP BY type
    ) latest ON latest.type = sr.type AND latest.max_id = sr.id`;

  const runByType = new Map(latestRuns.map((row) => [row.type, row]));
  const needsReviewCount = Number(
    (
      await sql`
        SELECT COUNT(*) AS count
        FROM invoices
        WHERE status = 'needs_review'
          AND organization_id = ${organizationId}
      `
    )[0].count,
  );

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

export async function getSetupSnapshot(organizationId?: string | null) {
  // Export-Target-Check org-gescoped — sonst würden ältere Records anderer
  // Orgs (oder ein einzelner enabled-Eintrag irgendwo) den Status für eine
  // frische Org fälschlich "aktiv" melden bzw. eine vollständig aufgesetzte
  // Org von einer fremden disabled-Row beeinträchtigen.
  const exportTargetActive = organizationId
    ? Number((await sql`SELECT COUNT(*) AS count FROM export_targets WHERE enabled IS TRUE AND recipient_email IS NOT NULL AND organization_id = ${organizationId}`)[0].count) > 0
    : Number((await sql`SELECT COUNT(*) AS count FROM export_targets WHERE enabled IS TRUE AND recipient_email IS NOT NULL AND organization_id IS NULL`)[0].count) > 0;
  const mistralConfigured =
    (await hasConfiguredCredential("mistral")) || appConfig.mistral.configured;
  return {
    mistralConfigured,
    imapConfigured:
      (await hasConfiguredCredential("imap", "primary", organizationId)) ||
      (await hasConfiguredCredential("imap", "secondary", organizationId)),
    smtpConfigured:
      (await hasConfiguredCredential("smtp", "primary", organizationId)) ||
      (await hasConfiguredCredential("smtp", "secondary", organizationId)),
    exportTargetActive,
  };
}

export async function getUnmappedSenderCount(): Promise<number> {
  return Number((await sql`SELECT COUNT(*) AS count FROM discovered_senders WHERE matched_vendor_id IS NULL AND blocked IS NOT TRUE AND pdf_count > 0`)[0].count);
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

export async function getAgentCostSummary(daysBack = 30): Promise<AgentCostSummary> {
  const sinceIso = new Date(Date.now() - daysBack * 86400_000).toISOString();

  const [total] = await sql<Array<{
    totalRuns: string;
    totalInvoices: string;
    totalLlmCalls: string;
    totalCostCents: string;
    avgDurationMs: string;
  }>>`
    SELECT
      COUNT(*) AS "totalRuns",
      COALESCE(SUM(invoices_found), 0) AS "totalInvoices",
      COALESCE(SUM(llm_calls), 0) AS "totalLlmCalls",
      COALESCE(SUM(llm_cost_cents), 0) AS "totalCostCents",
      COALESCE(AVG(duration_ms), 0) AS "avgDurationMs"
    FROM portal_run_logs
    WHERE started_at >= ${sinceIso}`;

  const byVendor = await sql<AgentCostSummary["byVendor"]>`
    SELECT
      p.vendor_key AS "vendorKey",
      COALESCE(v.name, p.vendor_key) AS "vendorName",
      COUNT(*) AS runs,
      COALESCE(SUM(p.invoices_found), 0) AS "invoicesFound",
      COALESCE(SUM(CASE WHEN p.status IN ('success','no_invoices') THEN 1 ELSE 0 END), 0) AS "successCount",
      COALESCE(SUM(CASE WHEN p.status NOT IN ('success','no_invoices') THEN 1 ELSE 0 END), 0) AS "failureCount",
      COALESCE(SUM(p.llm_cost_cents), 0) AS "llmCostCents",
      COALESCE(AVG(p.duration_ms), 0) AS "avgDurationMs",
      MAX(p.started_at) AS "lastRunAt",
      (SELECT status FROM portal_run_logs WHERE vendor_key = p.vendor_key ORDER BY id DESC LIMIT 1) AS "lastStatus"
    FROM portal_run_logs p
    LEFT JOIN vendors v ON v.canonical_key = p.vendor_key
    WHERE p.started_at >= ${sinceIso}
    GROUP BY p.vendor_key
    ORDER BY "lastRunAt" DESC`;

  return {
    totalRuns: Number(total.totalRuns),
    totalInvoices: Number(total.totalInvoices),
    totalLlmCalls: Number(total.totalLlmCalls),
    totalCostCents: Number(total.totalCostCents),
    avgDurationMs: Math.round(Number(total.avgDurationMs)),
    byVendor: byVendor.map((r) => ({
      ...r,
      runs: Number(r.runs),
      invoicesFound: Number(r.invoicesFound),
      successCount: Number(r.successCount),
      failureCount: Number(r.failureCount),
      llmCostCents: Number(r.llmCostCents),
      avgDurationMs: Number(r.avgDurationMs),
    })),
  };
}

export async function getPortalIssueAccounts(): Promise<Array<{
  vendorKey: string;
  vendorName: string;
  status: string;
  errorMessage: string | null;
}>> {
  return await sql`
    SELECT v.canonical_key AS "vendorKey", v.name AS "vendorName", p.status, p.error_message AS "errorMessage"
    FROM portal_run_logs p
    JOIN vendors v ON v.canonical_key = p.vendor_key
    WHERE p.id IN (
      SELECT MAX(id) FROM portal_run_logs GROUP BY vendor_key
    )
    AND p.status IN ('login_required', 'two_factor', 'captcha', 'failed')`;
}

export async function getExportQueueCounts() {
  return {
    pending: Number((await sql`SELECT COUNT(*) AS count FROM exports WHERE status = 'pending'`)[0].count),
    failed: Number((await sql`SELECT COUNT(*) AS count FROM exports WHERE status = 'failed'`)[0].count),
  };
}

export type TodayBilanz = {
  importedToday: number;
  exportedToday: number;
  needsReview: number;
};

export async function getTodayBilanz(): Promise<TodayBilanz> {
  return {
    importedToday: Number((await sql`SELECT COUNT(*) AS count FROM invoices WHERE (created_at::TIMESTAMP)::DATE = CURRENT_DATE`)[0].count),
    exportedToday: Number((await sql`SELECT COUNT(*) AS count FROM exports WHERE status = 'sent' AND (sent_at::TIMESTAMP)::DATE = CURRENT_DATE`)[0].count),
    needsReview: Number((await sql`SELECT COUNT(*) AS count FROM invoices WHERE status = 'needs_review'`)[0].count),
  };
}

export type AutomationStats = {
  exportedToday: number;
  exportedThisWeek: number;
  exportedLifetime: number;
  needsReview: number;
  // INFETCH-206/erfolgs-hero: Rechnungen, die der User behalten/freigegeben hat
  // (status 'ready' oder 'exported') — erfasst & in der Pipeline, auch wenn der
  // Export-Cron noch nichts versendet hat. Treibt den Dashboard-Erfolgszustand.
  capturedCount: number;
  hoursSavedLifetime: number;
  daysActive: number | null;
};

export async function getAutomationStats(organizationId: string | null = null): Promise<AutomationStats> {
  // SEC (INFETCH-176): Pflicht-Org-Filter. Ohne orgId → Null-Defaults statt
  // globaler Aggregate über alle Mandanten. Dashboard reicht auth.organization.id
  // rein; ohne Org-Kontext (z.B. neuer User vor Org-Erstellung) sieht der User
  // einen Null-Zustand statt fremde Daten.
  if (!organizationId) {
    return {
      exportedToday: 0,
      exportedThisWeek: 0,
      exportedLifetime: 0,
      needsReview: 0,
      capturedCount: 0,
      hoursSavedLifetime: 0,
      daysActive: null,
    };
  }
  // "versendet" = invoices.status='exported' (zuverlässig org-gescopt). Vorher
  // las das die exports-Tabelle (status='sent'), die beim INSERT aber KEIN
  // organization_id setzt → org-Filter lieferte 0 trotz erfolgter Sends (Hero
  // zeigte fälschlich „unterwegs"). invoices.status='exported' wird in derselben
  // Transaktion wie exports.sent gesetzt und ist die org-sichere Quelle der
  // Wahrheit — konsistent mit capturedCount und getMonthlyKpis.
  const [exportAgg, needsReviewRow, capturedRow] = await Promise.all([
    sql<{ today: string; thisWeek: string; lifetime: string; days: number | null }[]>`
      SELECT
        COUNT(*) FILTER (WHERE (updated_at::TIMESTAMP)::DATE = CURRENT_DATE) AS today,
        COUNT(*) FILTER (WHERE updated_at::TIMESTAMPTZ >= NOW() - INTERVAL '7 days') AS "thisWeek",
        COUNT(*) AS lifetime,
        EXTRACT(EPOCH FROM (NOW() - MIN(updated_at)::TIMESTAMP))::INTEGER / 86400 AS days
      FROM invoices WHERE status = 'exported' AND organization_id = ${organizationId}
    `,
    sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM invoices
      WHERE status = 'needs_review' AND organization_id = ${organizationId}
    `,
    sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM invoices
      WHERE status IN ('ready', 'exported') AND organization_id = ${organizationId}
    `,
  ]);

  const agg = exportAgg[0];
  const exportedLifetime = Number(agg?.lifetime ?? 0);
  const minutesSaved = exportedLifetime * 2;

  return {
    exportedToday: Number(agg?.today ?? 0),
    exportedThisWeek: Number(agg?.thisWeek ?? 0),
    exportedLifetime,
    needsReview: Number(needsReviewRow[0]?.count ?? 0),
    capturedCount: Number(capturedRow[0]?.count ?? 0),
    hoursSavedLifetime: Math.round((minutesSaved / 60) * 10) / 10,
    daysActive: agg?.days ?? null,
  };
}

export async function getRecentEvents(limit = 8) {
  return await sql<Array<{ id: number; level: string; eventType: string; message: string; createdAt: string }>>`
    SELECT id, level, event_type AS "eventType", message, created_at AS "createdAt"
    FROM sync_events
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}`;
}

export async function getInvoices(options: { limit?: number; status?: string; statuses?: string[]; year?: string; search?: string; includePrivate?: boolean; organizationId?: string | null } = {}) {
  const limit = options.limit ?? 200;
  const whereClauses: string[] = [];

  if (!options.includePrivate) {
    whereClauses.push("invoices.is_private IS NOT TRUE");
  }

  // Build query dynamically — postgres tagged-template doesn't support dynamic IN easily,
  // so we use sql.unsafe for the dynamic where clause but keep params safe via interpolation.
  // We build the full query as a safe tagged template with conditional fragments.

  type InvoiceListRow = {
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
  };

  // Build dynamic query using sql.unsafe with careful parameter handling
  const conditions: string[] = [];
  if (!options.includePrivate) conditions.push("invoices.is_private IS NOT TRUE");

  const params: Array<string | number> = [];
  let paramIdx = 1;

  if (options.organizationId) {
    conditions.push(`invoices.organization_id = $${paramIdx++}`);
    params.push(options.organizationId);
  }

  if (options.statuses && options.statuses.length > 0) {
    const placeholders = options.statuses.map(() => `$${paramIdx++}`).join(", ");
    conditions.push(`invoices.status IN (${placeholders})`);
    params.push(...options.statuses);
  } else if (options.status) {
    conditions.push(`invoices.status = $${paramIdx++}`);
    params.push(options.status);
  }
  if (options.year) {
    conditions.push(`EXTRACT(YEAR FROM COALESCE(invoices.invoice_date, invoices.created_at)::TIMESTAMP)::TEXT = $${paramIdx++}`);
    params.push(options.year);
  }
  if (options.search) {
    conditions.push(`(vendors.name ILIKE $${paramIdx++} OR invoices.invoice_number ILIKE $${paramIdx++})`);
    params.push(`%${options.search}%`, `%${options.search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);
  const limitParam = `$${paramIdx}`;

  // PERF (INFETCH-171): Vorher zwei korrelierte Subqueries pro Invoice-Zeile
  // (latest ai_extraction + vendor_aliases/discovered_senders COALESCE) — bei
  // 200 Rechnungen 200+ Lookups. Jetzt drei DISTINCT-ON-CTEs, die ihre Tabelle
  // jeweils einmal scannen und dann via Hash-Join an die invoice-Liste
  // anschließen. Mit den vorhandenen Indexen (ai_extractions.invoice_id,
  // vendor_aliases via vendor_id, discovered_senders via matched_vendor_id)
  // sortiert Postgres das in einem Schwung — N+1 ist weg.
  const queryText = `
    WITH latest_ai AS (
      SELECT DISTINCT ON (invoice_id) invoice_id, status
      FROM ai_extractions
      ORDER BY invoice_id, created_at DESC, id DESC
    ),
    -- INFETCH-207: KI-erkannter Anbietername als Fallback, wenn keine
    -- Katalog-Zuordnung (vendor_id NULL) existiert. Nur erfolgreiche Extraktion.
    latest_ai_vendor AS (
      SELECT DISTINCT ON (invoice_id) invoice_id,
             output_json::jsonb->>'normalized_vendor' AS normalized_vendor,
             output_json::jsonb->>'vendor' AS vendor
      FROM ai_extractions
      WHERE status = 'succeeded'
      ORDER BY invoice_id, created_at DESC, id DESC
    ),
    vendor_alias_best AS (
      SELECT DISTINCT ON (vendor_id) vendor_id, alias AS domain
      FROM vendor_aliases
      WHERE match_type = 'domain'
      ORDER BY vendor_id, priority ASC, LENGTH(alias) ASC
    ),
    sender_best AS (
      SELECT DISTINCT ON (matched_vendor_id) matched_vendor_id AS vendor_id, from_domain AS domain
      FROM discovered_senders
      WHERE matched_vendor_id IS NOT NULL
      ORDER BY matched_vendor_id, pdf_count DESC
    ),
    -- INFETCH-207: Absender-Domain der Mail-Quelle als Logo-Fallback.
    -- CASE-Guard: source_ref_id ist bei Portal-Quellen NICHT numerisch
    -- (vendorKey) → nur numerische (= mail_messages.id) casten.
    mail_sender AS (
      SELECT DISTINCT ON (mf.invoice_id) mf.invoice_id,
             lower(substring(mm.from_address from '@([A-Za-z0-9.-]+)')) AS domain
      FROM (
        SELECT invoice_id,
               CASE WHEN source_ref_id ~ '^[0-9]+$' THEN source_ref_id::bigint END AS mm_id
        FROM invoice_files
        WHERE source_type = 'mail'
      ) mf
      JOIN mail_messages mm ON mm.id = mf.mm_id
      WHERE mm.from_address IS NOT NULL AND mm.from_address <> ''
      ORDER BY mf.invoice_id, mf.mm_id DESC
    )
    SELECT
      invoices.id,
      invoices.status,
      invoices.source,
      invoices.invoice_number AS "invoiceNumber",
      invoices.invoice_date AS "invoiceDate",
      invoices.created_at AS "createdAt",
      invoices.amount_gross AS "amountGross",
      invoices.currency,
      invoices.confidence,
      latest_ai.status AS "aiStatus",
      COALESCE(vendors.name, latest_ai_vendor.normalized_vendor, latest_ai_vendor.vendor) AS "vendorName",
      COALESCE(vendor_alias_best.domain, sender_best.domain, mail_sender.domain) AS "vendorDomain"
    FROM invoices
    LEFT JOIN vendors ON vendors.id = invoices.vendor_id
    LEFT JOIN latest_ai ON latest_ai.invoice_id = invoices.id
    LEFT JOIN latest_ai_vendor ON latest_ai_vendor.invoice_id = invoices.id
    LEFT JOIN vendor_alias_best ON vendor_alias_best.vendor_id = vendors.id
    LEFT JOIN sender_best ON sender_best.vendor_id = vendors.id
    LEFT JOIN mail_sender ON mail_sender.invoice_id = invoices.id
    ${where}
    ORDER BY COALESCE(invoices.invoice_date, invoices.created_at) DESC
    LIMIT ${limitParam}`;

  return await sql.unsafe(queryText, params) as InvoiceListRow[];
}

export async function getInvoiceYears(organizationId: string | null = null): Promise<number[]> {
  const rows = await sql<Array<{ year: string }>>`
    SELECT DISTINCT EXTRACT(YEAR FROM COALESCE(invoice_date, created_at)::TIMESTAMP)::TEXT AS year
    FROM invoices
    WHERE (${organizationId}::text IS NULL OR organization_id = ${organizationId})
    ORDER BY year DESC`;
  return rows.map((r) => parseInt(r.year, 10)).filter((y) => !isNaN(y));
}

export async function getInvoiceStatusCounts(organizationId: string | null = null) {
  return await sql<Array<{ status: string; count: string }>>`
    SELECT status, COUNT(*) AS count FROM invoices
    WHERE is_private IS NOT TRUE
      AND (${organizationId}::text IS NULL OR organization_id = ${organizationId})
    GROUP BY status`;
}

export async function getPrivateInvoiceCount(organizationId: string | null = null): Promise<number> {
  return Number((await sql`
    SELECT COUNT(*) AS count FROM invoices
    WHERE is_private IS TRUE
      AND (${organizationId}::text IS NULL OR organization_id = ${organizationId})`)[0].count);
}

export async function getPrivateInvoices(options: { year?: string; search?: string; organizationId?: string | null } = {}) {
  const conditions: string[] = ["invoices.is_private IS TRUE"];
  const params: Array<string | number> = [];
  let paramIdx = 1;

  if (options.organizationId) {
    conditions.push(`invoices.organization_id = $${paramIdx++}`);
    params.push(options.organizationId);
  }

  if (options.year) {
    conditions.push(`EXTRACT(YEAR FROM COALESCE(invoices.invoice_date, invoices.created_at)::TIMESTAMP)::TEXT = $${paramIdx++}`);
    params.push(options.year);
  }
  if (options.search) {
    conditions.push(`(vendors.name ILIKE $${paramIdx++} OR invoices.invoice_number ILIKE $${paramIdx++})`);
    params.push(`%${options.search}%`, `%${options.search}%`);
  }

  params.push(200);
  const limitParam = `$${paramIdx}`;
  const where = `WHERE ${conditions.join(" AND ")}`;

  type PrivateInvoiceRow = {
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
  };

  return await sql.unsafe(`
    SELECT
      invoices.id,
      invoices.status,
      invoices.source,
      invoices.invoice_number AS "invoiceNumber",
      invoices.invoice_date AS "invoiceDate",
      invoices.created_at AS "createdAt",
      invoices.amount_gross AS "amountGross",
      invoices.currency,
      invoices.confidence,
      NULL AS "aiStatus",
      -- INFETCH-207: Fallback auf KI-erkannten Namen, wenn vendor_id NULL.
      COALESCE(
        vendors.name,
        (SELECT output_json::jsonb->>'normalized_vendor' FROM ai_extractions WHERE invoice_id = invoices.id AND status = 'succeeded' AND output_json::jsonb->>'normalized_vendor' IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1),
        (SELECT output_json::jsonb->>'vendor' FROM ai_extractions WHERE invoice_id = invoices.id AND status = 'succeeded' ORDER BY created_at DESC, id DESC LIMIT 1)
      ) AS "vendorName",
      (
        SELECT COALESCE(
          (SELECT alias FROM vendor_aliases WHERE vendor_id = vendors.id AND match_type = 'domain' ORDER BY priority ASC, LENGTH(alias) ASC LIMIT 1),
          (SELECT from_domain FROM discovered_senders WHERE matched_vendor_id = vendors.id ORDER BY pdf_count DESC LIMIT 1),
          -- Absender-Domain der Mail-Quelle (Logo-Fallback). CASE-Guard, da
          -- source_ref_id bei Portal-Quellen nicht numerisch ist.
          (SELECT lower(substring(mm.from_address from '@([A-Za-z0-9.-]+)'))
             FROM invoice_files if2
             JOIN mail_messages mm ON mm.id = (CASE WHEN if2.source_ref_id ~ '^[0-9]+$' THEN if2.source_ref_id::bigint END)
             WHERE if2.invoice_id = invoices.id AND if2.source_type = 'mail' AND mm.from_address IS NOT NULL
             ORDER BY if2.id DESC LIMIT 1)
        )
      ) AS "vendorDomain"
    FROM invoices
    LEFT JOIN vendors ON vendors.id = invoices.vendor_id
    ${where}
    ORDER BY COALESCE(invoices.invoice_date, invoices.created_at) DESC
    LIMIT ${limitParam}`, params) as PrivateInvoiceRow[];
}

export async function getInvoiceDetail(invoiceId: number, organizationId: string | null = null) {
  const invoice = (await sql<Array<{
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
  }>>`
    SELECT
      invoices.id,
      invoices.vendor_id AS "vendorId",
      invoices.source,
      invoices.status,
      invoices.invoice_number AS "invoiceNumber",
      invoices.invoice_date AS "invoiceDate",
      invoices.service_period_start AS "servicePeriodStart",
      invoices.service_period_end AS "servicePeriodEnd",
      invoices.amount_gross AS "amountGross",
      invoices.amount_net AS "amountNet",
      invoices.vat_amount AS "vatAmount",
      invoices.currency,
      invoices.confidence,
      invoices.dedupe_key AS "dedupeKey",
      invoices.duplicate_of_invoice_id AS "duplicateOfInvoiceId",
      invoices.raw_text_path AS "rawTextPath",
      invoices.vat_rate AS "vatRate",
      invoices.doc_type AS "docType",
      invoices.preferred_export_target_id AS "preferredExportTargetId",
      invoices.created_at AS "createdAt",
      invoices.updated_at AS "updatedAt",
      COALESCE(
        vendors.name,
        (SELECT output_json::jsonb->>'normalized_vendor' FROM ai_extractions WHERE invoice_id = invoices.id AND status = 'succeeded' AND output_json::jsonb->>'normalized_vendor' IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1),
        (SELECT output_json::jsonb->>'vendor' FROM ai_extractions WHERE invoice_id = invoices.id AND status = 'succeeded' ORDER BY created_at DESC, id DESC LIMIT 1)
      ) AS "vendorName",
      (
        SELECT COALESCE(
          (SELECT alias FROM vendor_aliases WHERE vendor_id = vendors.id AND match_type = 'domain' ORDER BY priority ASC, LENGTH(alias) ASC LIMIT 1),
          (SELECT from_domain FROM discovered_senders WHERE matched_vendor_id = vendors.id ORDER BY pdf_count DESC LIMIT 1),
          (SELECT lower(substring(mm.from_address from '@([A-Za-z0-9.-]+)'))
             FROM invoice_files if2
             JOIN mail_messages mm ON mm.id = (CASE WHEN if2.source_ref_id ~ '^[0-9]+$' THEN if2.source_ref_id::bigint END)
             WHERE if2.invoice_id = invoices.id AND if2.source_type = 'mail' AND mm.from_address IS NOT NULL
             ORDER BY if2.id DESC LIMIT 1)
        )
      ) AS "vendorDomain",
      duplicate_vendors.name AS "duplicateVendorName",
      duplicate_invoices.invoice_number AS "duplicateInvoiceNumber"
    FROM invoices
    LEFT JOIN vendors ON vendors.id = invoices.vendor_id
    LEFT JOIN invoices AS duplicate_invoices ON duplicate_invoices.id = invoices.duplicate_of_invoice_id
    LEFT JOIN vendors AS duplicate_vendors ON duplicate_vendors.id = duplicate_invoices.vendor_id
    WHERE invoices.id = ${invoiceId}
      AND (${organizationId}::text IS NULL OR invoices.organization_id = ${organizationId})`)[0];

  if (!invoice) return null;

  const files = await sql<Array<{
    id: number;
    originalFilename: string;
    storedPath: string;
    sha256: string;
    sizeBytes: number;
    mimeType: string;
    sourceType: string;
    sourceRefId: string | null;
    createdAt: string;
  }>>`
    SELECT id, original_filename AS "originalFilename", stored_path AS "storedPath", sha256,
      size_bytes AS "sizeBytes", mime_type AS "mimeType", source_type AS "sourceType",
      source_ref_id AS "sourceRefId", created_at AS "createdAt"
    FROM invoice_files
    WHERE invoice_id = ${invoiceId}
    ORDER BY created_at DESC, id DESC`;

  const latestExtraction = (await sql<Array<{
    id: number;
    provider: string;
    model: string | null;
    promptVersion: string;
    status: string;
    error: string | null;
    outputJson: string | null;
    createdAt: string;
  }>>`
    SELECT id, provider, model, prompt_version AS "promptVersion", status, error,
      output_json AS "outputJson", created_at AS "createdAt"
    FROM ai_extractions
    WHERE invoice_id = ${invoiceId}
    ORDER BY created_at DESC, id DESC
    LIMIT 1`)[0];

  const events = await sql<Array<{
    id: number;
    level: string;
    eventType: string;
    yearMonth: string | null;
    message: string;
    metadataJson: string;
    createdAt: string;
  }>>`
    SELECT id, level, event_type AS "eventType", year_month AS "yearMonth", message, metadata_json AS "metadataJson",
      created_at AS "createdAt"
    FROM sync_events
    WHERE invoice_id = ${invoiceId}
    ORDER BY created_at DESC, id DESC
    LIMIT 25`;

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

export async function getInvoiceReviewOptions(currentInvoiceId: number, limit = 50, organizationId: string | null = null) {
  return await sql<Array<{
    id: number;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    amountGross: number | null;
    currency: string | null;
    status: string;
    vendorName: string | null;
  }>>`
    SELECT invoices.id, invoices.invoice_number AS "invoiceNumber", invoices.invoice_date AS "invoiceDate",
      invoices.amount_gross AS "amountGross", invoices.currency, invoices.status,
      vendors.name AS "vendorName"
    FROM invoices
    LEFT JOIN vendors ON vendors.id = invoices.vendor_id
    WHERE invoices.id != ${currentInvoiceId}
      AND (${organizationId}::text IS NULL OR invoices.organization_id = ${organizationId})
    ORDER BY invoices.created_at DESC, invoices.id DESC
    LIMIT ${limit}`;
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

// Lieferanten sind hybrid: globaler Seed-Katalog (organization_id IS NULL,
// via vendors/seed.ts + upsertVendor) plus org-eigene Vendoren aus der
// Sender-Erkennung (organization_id gesetzt, senders/actions +
// discovered-senders). Ohne Filter sähe Org A die org-eigenen Vendoren von
// Org B (Name/canonical_key/Portal-Config) — Cross-Tenant-Leak. Sichtbar ist
// daher nur: globaler Katalog + eigene Org (deckungsgleich mit RLS-Policy
// vendors_org).
export async function getVendors(organizationId: string | null): Promise<VendorRow[]> {
  return await sql<VendorRow[]>`
    SELECT id, name, canonical_key AS "canonicalKey", category, portal_enabled AS "portalEnabled", hidden,
      portal_login_url AS "portalLoginUrl", portal_category AS "portalCategory"
    FROM vendors
    WHERE organization_id IS NULL
       OR organization_id IS NOT DISTINCT FROM ${organizationId}
    ORDER BY name`;
}

export async function findVendorByCanonicalKey(canonicalKey: string): Promise<VendorRow | null> {
  const row = (await sql<VendorRow[]>`
    SELECT id, name, canonical_key AS "canonicalKey", category, portal_enabled AS "portalEnabled", hidden,
      portal_login_url AS "portalLoginUrl", portal_category AS "portalCategory"
    FROM vendors WHERE canonical_key = ${canonicalKey} LIMIT 1`)[0];
  return row ?? null;
}

export async function upsertVendor(input: {
  name: string;
  canonicalKey: string;
  category?: string;
  portalLoginUrl?: string | null;
  portalCategory?: string | null;
}): Promise<VendorRow> {
  const existing = await findVendorByCanonicalKey(input.canonicalKey);
  if (existing) {
    await sql`
      UPDATE vendors SET name = ${input.name}, category = COALESCE(${input.category ?? null}, category),
        portal_login_url = COALESCE(${input.portalLoginUrl ?? null}, portal_login_url),
        portal_category = COALESCE(${input.portalCategory ?? null}, portal_category),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${existing.id}`;
  } else {
    await sql`
      INSERT INTO vendors (name, canonical_key, category, portal_enabled, portal_login_url, portal_category)
      VALUES (${input.name}, ${input.canonicalKey}, ${input.category ?? "unknown"}, 0, ${input.portalLoginUrl ?? null}, ${input.portalCategory ?? null})`;
  }
  return (await findVendorByCanonicalKey(input.canonicalKey))!;
}

export type MissingItem = {
  vendorId: number;
  vendorName: string;
  vendorCanonicalKey: string;
  vendorDomain: string | null;
  portalAvailable: boolean;
  yearMonth: string;
  missingMonths: number;
  finalStatus: string;
  portalStatus: string;
  bucket: "help" | "auto" | "wait";
  avgAmount: number | null;
};

const BUCKET_PRIORITY: Record<MissingItem["bucket"], number> = { help: 0, auto: 1, wait: 2 };

// Portal-Auto-Abruf ist operativ noch NICHT live → den "auto"-Bucket ("Wird
// automatisch geholt") vorerst nicht vergeben, sonst ein Versprechen, das nicht
// eingelöst wird. Auf true setzen, sobald der Portal-Agent real abruft.
const PORTAL_FETCH_LIVE = false;

export async function getMissingItems(organizationId: string | null): Promise<MissingItem[]> {
  const rows = await sql<Array<{
    vendorId: number;
    vendorName: string;
    vendorCanonicalKey: string;
    portalEnabled: number;
    yearMonth: string;
    finalStatus: string;
    portalStatus: string;
    vendorDomain: string | null;
    avgAmount: number | null;
  }>>`
    SELECT v.id AS "vendorId", v.name AS "vendorName", v.canonical_key AS "vendorCanonicalKey",
      v.portal_enabled AS "portalEnabled",
      vms.year_month AS "yearMonth", vms.final_status AS "finalStatus", vms.portal_status AS "portalStatus",
      (
        SELECT COALESCE(
          (SELECT alias FROM vendor_aliases WHERE vendor_id = v.id AND match_type = 'domain' ORDER BY priority ASC, LENGTH(alias) ASC LIMIT 1),
          (SELECT from_domain FROM discovered_senders WHERE matched_vendor_id = v.id ORDER BY pdf_count DESC LIMIT 1)
        )
      ) AS "vendorDomain",
      (
        SELECT AVG(i.amount_gross)
        FROM invoices i
        WHERE i.vendor_id = v.id AND i.status = 'exported' AND i.amount_gross IS NOT NULL
      ) AS "avgAmount"
    FROM vendor_month_status vms
    JOIN vendors v ON v.id = vms.vendor_id
    -- hidden::boolean: in Prod ist die Spalte INTEGER (Migration 0001), in
    -- CI BOOLEAN (reconcile-schema.sql). Der Cast normalisiert beide Typen,
    -- sonst wirft genau eine der beiden Umgebungen.
    -- vendor_month_status ist die Mandanten-Grenze (organization_id via
    -- Migration 0019). Ohne diesen Filter leakt der Missing-Status-Cache
    -- anderer Orgs über /audit?tab=fehlt. Muster wie getDashboardStats.
    WHERE v.hidden::boolean IS NOT TRUE
      AND vms.final_status IN ('missing', 'action_required', 'unchecked')
      AND vms.organization_id IS NOT DISTINCT FROM ${organizationId}
    ORDER BY v.name ASC, vms.year_month DESC`;

  type Entry = { item: MissingItem; count: number };
  const vendorMap = new Map<number, Entry>();

  for (const r of rows) {
    const portalAvailable = Boolean(r.portalEnabled);
    let bucket: MissingItem["bucket"];
    if (r.finalStatus === "action_required") bucket = "help";
    else if (PORTAL_FETCH_LIVE && (r.portalStatus === "required" || r.portalStatus === "running")) bucket = "auto";
    else bucket = "wait";

    const item: MissingItem = {
      vendorId: Number(r.vendorId),
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

    const existing = vendorMap.get(Number(r.vendorId));
    if (!existing) {
      vendorMap.set(Number(r.vendorId), { item, count: 1 });
      continue;
    }
    existing.count++;
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

export async function getMissingMatrix(organizationId: string | null, includeHidden = false) {
  const allVendors = await getVendors(organizationId);
  const vendors = includeHidden ? allVendors : allVendors.filter((v) => !v.hidden);
  const months = Array.from({ length: appConfig.syncMonthsBack }, (_, index) =>
    format(subMonths(new Date(), appConfig.syncMonthsBack - index - 1), "yyyy-MM"),
  );
  const statuses = await sql<Array<{
    vendorId: number;
    yearMonth: string;
    mailStatus: string;
    portalStatus: string;
    manualStatus: string;
    finalStatus: string;
    sourceUsed: string;
  }>>`
    SELECT vendor_id AS "vendorId", year_month AS "yearMonth", mail_status AS "mailStatus",
      portal_status AS "portalStatus", manual_status AS "manualStatus",
      final_status AS "finalStatus", source_used AS "sourceUsed"
    FROM vendor_month_status
    WHERE organization_id IS NOT DISTINCT FROM ${organizationId}`;
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

export async function getRuns(limit = 40) {
  return await sql<Array<{
    id: number;
    type: string;
    status: string;
    triggeredBy: string;
    summaryJson: string;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
  }>>`
    SELECT id, type, status, triggered_by AS "triggeredBy", summary_json AS "summaryJson", started_at AS "startedAt",
      finished_at AS "finishedAt", created_at AS "createdAt"
    FROM sync_runs
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}`;
}

export async function getDownloads(limit = 50) {
  return await sql<Array<{
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
  }>>`
    SELECT invoice_files.id, invoice_files.invoice_id AS "invoiceId", invoice_files.original_filename AS "originalFilename",
      invoice_files.stored_path AS "storedPath", invoice_files.sha256, invoice_files.size_bytes AS "sizeBytes",
      invoice_files.source_type AS "sourceType", invoices.status AS "invoiceStatus",
      (
        SELECT ai_extractions.status
        FROM ai_extractions
        WHERE ai_extractions.invoice_id = invoices.id
        ORDER BY ai_extractions.created_at DESC, ai_extractions.id DESC
        LIMIT 1
      ) AS "aiStatus",
      vendors.name AS "vendorName"
    FROM invoice_files
    LEFT JOIN invoices ON invoices.id = invoice_files.invoice_id
    LEFT JOIN vendors ON vendors.id = invoices.vendor_id
    ORDER BY invoice_files.created_at DESC
    LIMIT ${limit}`;
}

export async function getExportQueue(limit = 200) {
  return await sql<Array<{
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
  }>>`
    SELECT exports.id, exports.invoice_id AS "invoiceId", exports.status,
      exports.attempt_count AS "attemptCount",
      exports.last_error AS "lastError", exports.sent_at AS "sentAt",
      export_targets.label AS "targetLabel", invoices.invoice_date AS "invoiceDate",
      invoices.amount_gross AS "amountGross", invoices.currency, vendors.name AS "vendorName"
    FROM exports
    JOIN export_targets ON export_targets.id = exports.export_target_id
    JOIN invoices ON invoices.id = exports.invoice_id
    LEFT JOIN vendors ON vendors.id = invoices.vendor_id
    ORDER BY exports.status ASC, exports.created_at DESC
    LIMIT ${limit}`;
}

export async function getExportStats() {
  return await sql<Array<{ targetLabel: string; status: string; count: string }>>`
    SELECT export_targets.label AS "targetLabel", exports.status, COUNT(*) AS count
    FROM exports
    JOIN export_targets ON export_targets.id = exports.export_target_id
    GROUP BY export_targets.id, exports.status`;
}

export async function getCredentialSummaries() {
  return await sql<Array<{
    id: number;
    scope: string;
    label: string;
    secretStore: string;
    status: string;
    lastVerifiedAt: string | null;
  }>>`
    SELECT id, scope, label, secret_store AS "secretStore", status, last_verified_at AS "lastVerifiedAt"
    FROM credential_refs
    ORDER BY scope, label`;
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

export async function getPrimaryMailAccount(organizationId?: string | null) {
  return (await sql<MailAccountSummary[]>`
    SELECT id, label, host, port, secure, username, status, last_verified_at AS "lastVerifiedAt"
    FROM mail_accounts
    WHERE label = 'Primary IMAP'
      AND (${organizationId ?? null}::text IS NULL OR organization_id = ${organizationId ?? null})
    ORDER BY id DESC
    LIMIT 1`)[0];
}

export async function getSecondaryMailAccount(organizationId?: string | null) {
  return (await sql<MailAccountSummary[]>`
    SELECT id, label, host, port, secure, username, status, last_verified_at AS "lastVerifiedAt"
    FROM mail_accounts
    WHERE label = 'Secondary IMAP'
      AND (${organizationId ?? null}::text IS NULL OR organization_id = ${organizationId ?? null})
    ORDER BY id DESC
    LIMIT 1`)[0];
}

export async function getPrimarySmtpAccount() {
  return getStoredSmtpAccount("primary");
}

export async function getSecondarySmtpAccount() {
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
    id: Number(row.id),
    vendorId: row.vendor_id ? Number(row.vendor_id) : null,
    vendorPattern: row.vendor_pattern,
    maxAmountCents: row.max_amount_cents ? Number(row.max_amount_cents) : null,
    enabled: Boolean(row.enabled),
    vendorName: row.vendor_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getAutoApprovalRulesForVendor(
  vendorId: number | null,
  vendorName: string | null,
  organizationId: string | null,
): Promise<AutoApprovalRule[]> {
  const rows = await sql<AutoApprovalRow[]>`
    SELECT r.id, r.vendor_id, r.vendor_pattern, r.max_amount_cents, r.enabled,
            r.created_at, r.updated_at, v.name AS vendor_name
    FROM auto_approval_rules r
    LEFT JOIN vendors v ON v.id = r.vendor_id
    WHERE r.enabled IS TRUE
      AND r.organization_id IS NOT DISTINCT FROM ${organizationId}
      AND (
        (r.vendor_id IS NOT NULL AND r.vendor_id = ${vendorId})
        OR (r.vendor_pattern IS NOT NULL
            AND ${vendorName} IS NOT NULL
            AND LOWER(${vendorName}) LIKE '%' || LOWER(r.vendor_pattern) || '%')
      )`;
  return rows.map(mapAutoApprovalRow);
}

export async function upsertAutoApprovalRule(input: {
  id?: number;
  organizationId: string | null;
  vendorId: number | null;
  vendorPattern: string | null;
  maxAmountCents: number | null;
  enabled: boolean;
}): Promise<AutoApprovalRule> {
  if (input.id) {
    await sql`
      UPDATE auto_approval_rules
      SET vendor_id = ${input.vendorId}, vendor_pattern = ${input.vendorPattern},
          max_amount_cents = ${input.maxAmountCents}, enabled = ${input.enabled},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${input.id}
        AND organization_id IS NOT DISTINCT FROM ${input.organizationId}`;
    const updated = (await sql<AutoApprovalRow[]>`
      SELECT r.id, r.vendor_id, r.vendor_pattern, r.max_amount_cents, r.enabled,
              r.created_at, r.updated_at, v.name AS vendor_name
      FROM auto_approval_rules r
      LEFT JOIN vendors v ON v.id = r.vendor_id
      WHERE r.id = ${input.id}`)[0];
    return mapAutoApprovalRow(updated);
  }
  const [inserted] = await sql<Array<{ id: string }>>`
    INSERT INTO auto_approval_rules (organization_id, vendor_id, vendor_pattern, max_amount_cents, enabled)
    VALUES (${input.organizationId}, ${input.vendorId}, ${input.vendorPattern}, ${input.maxAmountCents}, ${input.enabled})
    RETURNING id`;
  const row = (await sql<AutoApprovalRow[]>`
    SELECT r.id, r.vendor_id, r.vendor_pattern, r.max_amount_cents, r.enabled,
            r.created_at, r.updated_at, v.name AS vendor_name
    FROM auto_approval_rules r
    LEFT JOIN vendors v ON v.id = r.vendor_id
    WHERE r.id = ${Number(inserted.id)}`)[0];
  return mapAutoApprovalRow(row);
}

export async function deleteAutoApprovalRule(
  id: number,
  organizationId: string | null,
): Promise<void> {
  await sql`
    DELETE FROM auto_approval_rules
    WHERE id = ${id}
      AND organization_id IS NOT DISTINCT FROM ${organizationId}`;
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
  enabled: boolean;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapIntegrationRow(row: IntegrationRow): IntegrationTarget {
  return {
    id: Number(row.id),
    provider: row.provider as IntegrationProvider,
    label: row.label,
    oauthTokenRef: row.oauth_token_ref,
    externalAccountId: row.external_account_id,
    enabled: Boolean(row.enabled),
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listIntegrationTargets(
  organizationId: string | null,
): Promise<IntegrationTarget[]> {
  const rows = await sql<IntegrationRow[]>`
    SELECT id, provider, label, oauth_token_ref, external_account_id, enabled,
            last_verified_at, created_at, updated_at
    FROM integration_targets
    WHERE organization_id IS NOT DISTINCT FROM ${organizationId}
    ORDER BY enabled DESC, provider ASC`;
  return rows.map(mapIntegrationRow);
}

export async function getIntegrationTarget(
  provider: IntegrationProvider,
  organizationId: string | null,
): Promise<IntegrationTarget | null> {
  const row = (await sql<IntegrationRow[]>`
    SELECT id, provider, label, oauth_token_ref, external_account_id, enabled,
            last_verified_at, created_at, updated_at
    FROM integration_targets
    WHERE provider = ${provider}
      AND organization_id IS NOT DISTINCT FROM ${organizationId}`)[0];
  return row ? mapIntegrationRow(row) : null;
}

export async function getActiveIntegrationTarget(
  organizationId: string | null,
): Promise<IntegrationTarget | null> {
  const row = (await sql<IntegrationRow[]>`
    SELECT id, provider, label, oauth_token_ref, external_account_id, enabled,
            last_verified_at, created_at, updated_at
    FROM integration_targets
    WHERE enabled IS TRUE
      AND organization_id IS NOT DISTINCT FROM ${organizationId}
    ORDER BY updated_at DESC
    LIMIT 1`)[0];
  return row ? mapIntegrationRow(row) : null;
}

export async function upsertIntegrationTarget(input: {
  organizationId: string | null;
  provider: IntegrationProvider;
  label: string;
  oauthTokenRef?: string | null;
  externalAccountId?: string | null;
  enabled?: boolean;
}): Promise<IntegrationTarget> {
  const enabledFlag = input.enabled ?? true;
  await sql`
    INSERT INTO integration_targets (organization_id, provider, label, oauth_token_ref, external_account_id, enabled)
    VALUES (${input.organizationId}, ${input.provider}, ${input.label}, ${input.oauthTokenRef ?? null}, ${input.externalAccountId ?? null}, ${enabledFlag})
    ON CONFLICT(organization_id, provider) DO UPDATE SET
      label = EXCLUDED.label,
      oauth_token_ref = COALESCE(EXCLUDED.oauth_token_ref, integration_targets.oauth_token_ref),
      external_account_id = COALESCE(EXCLUDED.external_account_id, integration_targets.external_account_id),
      enabled = EXCLUDED.enabled,
      updated_at = CURRENT_TIMESTAMP`;
  const target = await getIntegrationTarget(input.provider, input.organizationId);
  if (!target) throw new Error(`Integration ${input.provider} not found after upsert`);
  return target;
}

export async function disableIntegrationTarget(
  provider: IntegrationProvider,
  organizationId: string | null,
): Promise<void> {
  await sql`
    UPDATE integration_targets SET enabled = FALSE, updated_at = CURRENT_TIMESTAMP
    WHERE provider = ${provider}
      AND organization_id IS NOT DISTINCT FROM ${organizationId}`;
}

export async function markIntegrationVerified(
  provider: IntegrationProvider,
  organizationId: string | null,
): Promise<void> {
  await sql`
    UPDATE integration_targets SET last_verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE provider = ${provider}
      AND organization_id IS NOT DISTINCT FROM ${organizationId}`;
}

export async function recordInvoiceExternalRef(
  invoiceId: number,
  externalRef: string,
  provider: IntegrationProvider,
): Promise<void> {
  await sql`
    UPDATE invoices
    SET external_ref = ${externalRef}, external_ref_provider = ${provider}, external_ref_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${invoiceId}`;
}

// ─── Review Navigation ────────────────────────────────────────────────────────

export async function getAdjacentInvoiceIds(
  invoiceId: number,
  statuses = ["needs_review", "new", "failed"],
  organizationId: string | null = null,
): Promise<{ prevId: number | null; nextId: number | null; position: number; total: number }> {
  type QueueRow = {
    prevId: number | null;
    nextId: number | null;
    position: string;
    total: string;
  };

  const row = ((await sql.unsafe(`
    WITH queue AS (
      SELECT
        id,
        LAG(id)  OVER (ORDER BY COALESCE(invoice_date, created_at) DESC, id DESC) AS "prevId",
        LEAD(id) OVER (ORDER BY COALESCE(invoice_date, created_at) DESC, id DESC) AS "nextId",
        ROW_NUMBER() OVER (ORDER BY COALESCE(invoice_date, created_at) DESC, id DESC) AS rn,
        COUNT(*) OVER () AS total
      FROM invoices
      WHERE status = ANY($1::text[])
        AND ($3::text IS NULL OR organization_id = $3)
    )
    SELECT "prevId", "nextId", rn::INTEGER AS position, total::INTEGER AS total
    FROM queue
    WHERE id = $2
    LIMIT 1`, [statuses, invoiceId, organizationId]))[0] as unknown) as QueueRow | undefined;

  if (!row) {
    const totalRow = ((await sql.unsafe(`
      SELECT COUNT(*) AS total FROM invoices WHERE status = ANY($1::text[])
        AND ($2::text IS NULL OR organization_id = $2)`, [statuses, organizationId]))[0] as unknown) as { total: string };
    return { prevId: null, nextId: null, position: 0, total: Number(totalRow.total) };
  }

  return {
    prevId: row.prevId ? Number(row.prevId) : null,
    nextId: row.nextId ? Number(row.nextId) : null,
    position: Number(row.position),
    total: Number(row.total),
  };
}

// ─── Dashboard: neue Queries ───────────────────────────────────────────────────

export type MonthlyKpis = {
  total: number;
  sumGross: number;
  prevTotal: number;
  prevSumGross: number;
  deltaPercent: number | null;
};

export async function getMonthlyKpis(month: string, organizationId: string | null): Promise<MonthlyKpis> {
  const [yearStr, mStr] = month.split("-");
  const year = parseInt(yearStr ?? "0", 10);
  const m = parseInt(mStr ?? "1", 10);
  const prevYear = m === 1 ? year - 1 : year;
  const prevM = m === 1 ? 12 : m - 1;
  const prevMonth = `${prevYear}-${String(prevM).padStart(2, "0")}`;

  type KpiRow = { total: string; sumGross: string | null };

  // SEC (Dashboard-Konsistenz): org-gescopt — vorher zählte die Query über ALLE
  // Mandanten (fehlender organization_id-Filter, Multi-Tenant-Leak). Quelle wie
  // getAutomationStats: invoices.status='exported'.
  const getKpi = async (mo: string): Promise<KpiRow> =>
    (await sql<KpiRow[]>`
      SELECT COUNT(*) AS total, SUM(amount_gross) AS "sumGross"
      FROM invoices
      WHERE status = 'exported'
        AND invoice_date LIKE ${mo + '%'}
        AND organization_id IS NOT DISTINCT FROM ${organizationId}`)[0];

  const cur = await getKpi(month);
  const prev = await getKpi(prevMonth);

  const total = Number(cur.total ?? 0);
  const prevTotal = Number(prev.total ?? 0);
  const sumGross = Number(cur.sumGross ?? 0);
  const prevSumGross = Number(prev.sumGross ?? 0);
  const deltaPercent =
    prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;

  return { total, sumGross, prevTotal, prevSumGross, deltaPercent };
}

export async function getDailyTimeseries(days: number, organizationId: string | null): Promise<Array<{ date: string; count: number }>> {
  const rows = await sql<Array<{ date: string; count: string }>>`
    SELECT (COALESCE(invoice_date, created_at)::TIMESTAMP)::DATE::TEXT AS date, COUNT(*) AS count
    FROM invoices
    WHERE status = 'exported'
      AND organization_id IS NOT DISTINCT FROM ${organizationId}
      AND COALESCE(invoice_date, created_at)::TIMESTAMPTZ >= NOW() - INTERVAL '1 day' * ${days}
    GROUP BY date
    ORDER BY date ASC`;

  const map = new Map(rows.map((r) => [r.date, Number(r.count)]));
  const result: Array<{ date: string; count: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push({ date: key, count: map.get(key) ?? 0 });
  }
  return result;
}

export async function getTopVendors(
  limit = 5,
  organizationId: string | null = null,
): Promise<Array<{
  vendorName: string;
  vendorDomain: string | null;
  count: number;
  sumGross: number;
  deltaPrevMonth: number;
}>> {
  const curMonth = new Date().toISOString().slice(0, 7);
  const [yearStr, mStr] = curMonth.split("-");
  const year = parseInt(yearStr ?? "0", 10);
  const m = parseInt(mStr ?? "1", 10);
  const prevMonth = `${m === 1 ? year - 1 : year}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;

  type Row = {
    vendorName: string;
    vendorDomain: string | null;
    count: string;
    sumGross: string | null;
    curCount: string;
    prevCount: string;
  };

  const rows = await sql<Row[]>`
    SELECT
      v.name AS "vendorName",
      COALESCE(
        (SELECT alias FROM vendor_aliases WHERE vendor_id = v.id AND match_type = 'domain' ORDER BY priority ASC LIMIT 1),
        (SELECT from_domain FROM discovered_senders WHERE matched_vendor_id = v.id ORDER BY pdf_count DESC LIMIT 1)
      ) AS "vendorDomain",
      COUNT(*) AS count,
      SUM(i.amount_gross) AS "sumGross",
      SUM(CASE WHEN i.invoice_date LIKE ${curMonth + '%'} THEN 1 ELSE 0 END) AS "curCount",
      SUM(CASE WHEN i.invoice_date LIKE ${prevMonth + '%'} THEN 1 ELSE 0 END) AS "prevCount"
    FROM invoices i
    JOIN vendors v ON v.id = i.vendor_id
    WHERE i.status = 'exported'
      AND (${organizationId}::text IS NULL OR i.organization_id = ${organizationId})
    GROUP BY v.id
    ORDER BY count DESC
    LIMIT ${limit}`;

  return rows.map((row) => ({
    vendorName: row.vendorName,
    vendorDomain: row.vendorDomain,
    count: Number(row.count),
    sumGross: Number(row.sumGross ?? 0),
    deltaPrevMonth: (Number(row.curCount ?? 0)) - (Number(row.prevCount ?? 0)),
  }));
}

export async function getOverdueVendors(organizationId: string | null = null): Promise<Array<{
  vendorName: string;
  vendorDomain: string | null;
  daysSince: number;
}>> {
  const rows = await sql<Array<{ vendorName: string; vendorDomain: string | null; daysSince: string }>>`
    SELECT
      v.name AS "vendorName",
      (SELECT ds.from_domain FROM discovered_senders ds
       WHERE ds.matched_vendor_id = v.id
       ORDER BY ds.pdf_count DESC LIMIT 1) AS "vendorDomain",
      EXTRACT(EPOCH FROM (NOW() - MAX(COALESCE(i.invoice_date, i.created_at)::TIMESTAMP)))::INTEGER / 86400 AS "daysSince"
    FROM invoices i
    JOIN vendors v ON v.id = i.vendor_id
    WHERE (${organizationId}::text IS NULL OR i.organization_id = ${organizationId})
    GROUP BY v.id
    HAVING COUNT(*) >= 2
      AND EXTRACT(EPOCH FROM (NOW() - MAX(COALESCE(i.invoice_date, i.created_at)::TIMESTAMP)))::INTEGER / 86400 > 60
    ORDER BY "daysSince" DESC
    LIMIT 10`;
  return rows.map((r) => ({ ...r, daysSince: Number(r.daysSince) }));
}

export async function getObservationStartDate(organizationId: string | null): Promise<string | null> {
  // SEC: org-gescopt — sonst „seit X" = frühestes Invoice ALLER Mandanten.
  const row = (await sql`SELECT MIN(created_at) AS "firstAt" FROM invoices WHERE organization_id IS NOT DISTINCT FROM ${organizationId}`)[0] as { firstAt: string | null } | undefined;
  return row?.firstAt ?? null;
}

export async function getLastScanAt(organizationId: string | null): Promise<string | null> {
  // Aus sync_runs lesen (dort liegen die echten Scan-Läufe, org-gescopt), NICHT
  // aus sync_events mit event_type='imap_scan' — das schreibt der Scanner nie
  // (er schreibt 'imap_scan_completed'), die alte Query lieferte daher immer
  // null → Dashboard zeigte dauerhaft „noch kein Scan".
  const row = (await sql`
    SELECT MAX(started_at) AS "lastAt" FROM sync_runs
    WHERE type = 'imap_scan' AND organization_id IS NOT DISTINCT FROM ${organizationId}
  `)[0] as { lastAt: string | null } | undefined;
  return row?.lastAt ?? null;
}

// Liefert Details der letzten gescheiterten IMAP-Scan-Row, aber nur wenn diese
// auch tatsaechlich die latest Row ist (also kein erfolgreicher/laufender Scan
// danach kam). So verschwindet das Dashboard-Warnbanner automatisch, sobald der
// naechste Scan wieder gruen ist.
export async function getLastScanFailure(organizationId: string | null): Promise<
  { failedAt: string; errorSnippet: string } | null
> {
  const rows = await sql<
    { status: string; finishedAt: string | null; summaryJson: string | null }[]
  >`
    SELECT status, finished_at AS "finishedAt", summary_json AS "summaryJson"
    FROM sync_runs
    WHERE type = 'imap_scan' AND organization_id IS NOT DISTINCT FROM ${organizationId}
    ORDER BY id DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || row.status !== "failed") return null;

  let errorSnippet = "Unbekannter Fehler beim Scan.";
  try {
    const summary = JSON.parse(row.summaryJson || "{}") as { error?: string };
    if (typeof summary.error === "string" && summary.error.trim()) {
      // Nur erste Zeile + max 200 Zeichen, kein Stacktrace.
      errorSnippet = summary.error.split("\n")[0].slice(0, 200).trim();
    }
  } catch {
    // bei kaputtem JSON Default-Text behalten
  }

  return {
    failedAt: row.finishedAt || new Date().toISOString(),
    errorSnippet,
  };
}

export type RecentScanRow = {
  id: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  triggeredBy: string;
  messagesSeen: number;
  pdfsFound: number;
  imported: number;
  duplicates: number;
  failed: number;
  errorSnippet: string | null;
};

// Letzte N IMAP-Scan-Runs fuer die Scan-History-Anzeige in den Einstellungen.
// Bewusst global (sync_runs ist nicht org-scoped) — fuer Free-only-Launch
// unkritisch, fuer Multi-Tenant-Strictness waere Schema-Aenderung noetig.
export async function getRecentScans(limit = 20, organizationId: string | null = null): Promise<RecentScanRow[]> {
  const rows = await sql<
    {
      id: number;
      status: string;
      startedAt: string;
      finishedAt: string | null;
      triggeredBy: string | null;
      summaryJson: string | null;
    }[]
  >`
    SELECT id, status, started_at AS "startedAt", finished_at AS "finishedAt",
           triggered_by AS "triggeredBy", summary_json AS "summaryJson"
    FROM sync_runs
    WHERE type = 'imap_scan'
      AND organization_id IS NOT DISTINCT FROM ${organizationId}
    ORDER BY id DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => {
    let summary: Record<string, unknown> = {};
    try {
      summary = JSON.parse(row.summaryJson || "{}") as Record<string, unknown>;
    } catch {
      // kaputtes JSON: alle Counter bleiben 0
    }
    const num = (k: string) =>
      typeof summary[k] === "number" ? (summary[k] as number) : 0;
    let errorSnippet: string | null = null;
    if (row.status === "failed" && typeof summary.error === "string") {
      const trimmed = summary.error.split("\n")[0].slice(0, 200).trim();
      errorSnippet = trimmed || null;
    }
    return {
      id: Number(row.id),
      status: row.status,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      triggeredBy: row.triggeredBy || "system",
      messagesSeen: num("messagesSeen"),
      pdfsFound: num("pdfsFound"),
      imported: num("imported"),
      duplicates: num("duplicates"),
      failed: num("failed"),
      errorSnippet,
    };
  });
}

export type SecondaryStats = {
  daysSinceLastIntervention: number | null;
  avgLatencyMin: number | null;
  filteredThisMonth: number;
  forecastRestMonth: number | null;
};

export async function getSecondaryStats(organizationId: string | null = null): Promise<SecondaryStats> {
  // SEC (INFETCH-176): Pflicht-Org-Filter. Ohne orgId → Null-Defaults statt
  // globaler Aggregate über alle Mandanten.
  if (!organizationId) {
    return {
      daysSinceLastIntervention: null,
      avgLatencyMin: null,
      filteredThisMonth: 0,
      forecastRestMonth: null,
    };
  }
  // PERF: vorher 5–6 sequenzielle Queries; jetzt drei parallele Aggregate.
  // Reduktion auf max. 3 DB-Roundtrips bei gleichem Output-Shape.
  const [invoicesAgg, exportsAgg, latencyRows] = await Promise.all([
    sql<{ daysSinceReview: number | null; filteredThisMonth: string }[]>`
      SELECT
        EXTRACT(EPOCH FROM (NOW() - MAX(created_at::TIMESTAMP) FILTER (WHERE status = 'needs_review')))::INTEGER / 86400 AS "daysSinceReview",
        COUNT(*) FILTER (
          WHERE status IN ('ignored', 'duplicate')
            AND TO_CHAR(created_at::TIMESTAMP, 'YYYY-MM') = TO_CHAR(NOW(), 'YYYY-MM')
        ) AS "filteredThisMonth"
      FROM invoices WHERE organization_id = ${organizationId}
    `,
    sql<{ lifetime: string; minSent: number | null; last30: string }[]>`
      SELECT
        COUNT(*) AS lifetime,
        EXTRACT(EPOCH FROM (NOW() - MIN(sent_at::TIMESTAMP)))::INTEGER / 86400 AS "minSent",
        COUNT(*) FILTER (WHERE sent_at::TIMESTAMPTZ >= NOW() - INTERVAL '30 days') AS last30
      FROM exports WHERE status = 'sent' AND organization_id = ${organizationId}
    `,
    sql<{ avgMin: number | null }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM (e.sent_at::TIMESTAMP - i.created_at::TIMESTAMP)) / 60) AS "avgMin"
      FROM exports e
      JOIN invoices i ON i.id = e.invoice_id
      WHERE e.status = 'sent' AND e.sent_at IS NOT NULL
        AND e.organization_id = ${organizationId}
    `,
  ]);

  const invoices = invoicesAgg[0];
  const exportsRow = exportsAgg[0];
  const latency = latencyRows[0];

  const lastReviewDays = invoices?.daysSinceReview ?? null;
  const hasExported = Number(exportsRow?.lifetime ?? 0) > 0;
  const autopilotDays =
    hasExported && lastReviewDays == null
      ? exportsRow?.minSent ?? null
      : null;

  const filteredThisMonth = Number(invoices?.filteredThisMonth ?? 0);

  const last30 = Number(exportsRow?.last30 ?? 0);
  let forecastRestMonth: number | null = null;
  if (last30 > 0) {
    const rate = last30 / 30;
    const today = new Date();
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const remaining = lastDay - today.getDate();
    forecastRestMonth = Math.round(rate * remaining);
  }

  const avgLatencyMin =
    latency?.avgMin != null ? Math.round(Number(latency.avgMin)) : null;

  return {
    daysSinceLastIntervention:
      lastReviewDays != null ? Number(lastReviewDays) : autopilotDays,
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
  senderCategory: string | null;
  blocked: boolean;
  blockedReason: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  invoiceSum: number;
};

export async function listSendersWithStats(
  organizationId: string | null,
): Promise<SenderWithStats[]> {
  const rows = await sql<Array<Omit<SenderWithStats, "blocked"> & { blocked: number }>>`
    SELECT
      ds.id,
      ds.from_address        AS "fromAddress",
      ds.from_domain         AS "fromDomain",
      ds.display_name        AS "displayName",
      ds.mail_count          AS "mailCount",
      ds.pdf_count           AS "pdfCount",
      ds.imported_count      AS "importedCount",
      ds.matched_vendor_id   AS "matchedVendorId",
      ds.blocked,
      ds.blocked_reason      AS "blockedReason",
      ds.first_seen_at       AS "firstSeenAt",
      ds.last_seen_at        AS "lastSeenAt",
      ds.vendor_category     AS "senderCategory",
      v.name                 AS "matchedVendorName",
      v.category             AS "vendorCategory",
      COALESCE((
        SELECT SUM(i.amount_gross)
        FROM invoices i
        WHERE i.vendor_id = ds.matched_vendor_id
          AND i.status = 'exported'
          AND i.organization_id IS NOT DISTINCT FROM ${organizationId}
      ), 0) AS "invoiceSum"
    FROM discovered_senders ds
    LEFT JOIN vendors v ON v.id = ds.matched_vendor_id
    WHERE ds.pdf_count > 0
      AND ds.organization_id IS NOT DISTINCT FROM ${organizationId}
    ORDER BY "invoiceSum" DESC, ds.pdf_count DESC, ds.mail_count DESC`;

  return rows.map((row) => ({ ...row, blocked: Boolean(row.blocked) }));
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

export async function getVendorInvoices(vendorId: number): Promise<VendorInvoiceRow[]> {
  return await sql<VendorInvoiceRow[]>`
    SELECT
      id,
      status,
      invoice_date   AS "invoiceDate",
      created_at     AS "createdAt",
      amount_gross   AS "amountGross",
      currency,
      invoice_number AS "invoiceNumber"
    FROM invoices
    WHERE vendor_id = ${vendorId}
    ORDER BY COALESCE(invoice_date, created_at) DESC
    LIMIT 200`;
}

/**
 * Rechnungen eines Absenders über die MAIL-Quelle statt über matched_vendor_id.
 * Nötig für Absender OHNE Katalog-Vendor (vendor_id NULL ist der Normalfall):
 * sonst zeigt die Detail-Ansicht „keine Rechnungen", obwohl welche verarbeitet
 * wurden (INFETCH-218). Verknüpfung: invoices → invoice_files(source_type='mail')
 * → mail_messages, Domain der from_address == Absender-Domain. Das CASE-Cast-
 * Muster (source_ref_id ist bei Portal-Quellen nicht numerisch) spiegelt den
 * 207-mail_sender-CTE; EXISTS dedupt Rechnungen mit mehreren Mail-Dateien.
 */
export async function getSenderInvoices(
  fromDomain: string,
  organizationId: string | null,
): Promise<VendorInvoiceRow[]> {
  return await sql<VendorInvoiceRow[]>`
    SELECT
      i.id,
      i.status,
      i.invoice_date   AS "invoiceDate",
      i.created_at     AS "createdAt",
      i.amount_gross   AS "amountGross",
      i.currency,
      i.invoice_number AS "invoiceNumber"
    FROM invoices i
    WHERE i.organization_id IS NOT DISTINCT FROM ${organizationId}
      AND EXISTS (
        SELECT 1
        FROM (
          SELECT invoice_id,
                 CASE WHEN source_ref_id ~ '^[0-9]+$' THEN source_ref_id::bigint END AS mm_id
          FROM invoice_files
          WHERE source_type = 'mail'
        ) mf
        JOIN mail_messages mm ON mm.id = mf.mm_id
        WHERE mf.invoice_id = i.id
          AND lower(substring(mm.from_address from '@([A-Za-z0-9.-]+)')) = lower(${fromDomain})
      )
    ORDER BY COALESCE(i.invoice_date, i.created_at) DESC
    LIMIT 200`;
}
