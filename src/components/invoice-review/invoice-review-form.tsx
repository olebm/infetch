"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, ChevronDown, ChevronUp } from "lucide-react";
import { updateInvoiceReviewAction, type InvoiceReviewState } from "@/app/(app)/audit/actions";
import { StatusBadge } from "@/components/status/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField, Input, Select } from "@/components/ui/form-field";
import { VendorLogo } from "@/components/ui/vendor-logo";
import { VendorSuggestions } from "@/components/invoice-review/vendor-suggestions";
// PERFORMANCE (INFETCH-97): pdfjs-dist (~2–3 MB) nur laden wenn PDF-Tab aktiv.
import dynamic from "next/dynamic";
const PdfViewer = dynamic(
  () => import("@/components/invoice-review/pdf-viewer").then((m) => ({ default: m.PdfViewer })),
  { ssr: false },
);
import type { VendorSuggestion } from "@/vendors/suggestions";

const initialState: InvoiceReviewState = {
  status: "idle",
  message: "",
};

type ExtractionOutput = {
  vendor_confidence?: number | null;
  date_confidence?: number | null;
  amount_confidence?: number | null;
  vat_rate_confidence?: number | null;
  doc_type_confidence?: number | null;
};

function readExtractionOutput(raw: unknown): ExtractionOutput {
  if (!raw || typeof raw !== "object") return {};
  return raw as ExtractionOutput;
}

function confidenceTone(value: number | null | undefined): "ok" | "low" | "missing" {
  if (value === null || value === undefined) return "missing";
  if (value >= 0.85) return "ok";
  return "low";
}

const DOT_CLASS: Record<ReturnType<typeof confidenceTone>, string> = {
  ok:      "bg-ok",
  low:     "bg-warn",
  missing: "bg-muted/40",
};

const DOT_LABEL: Record<ReturnType<typeof confidenceTone>, string> = {
  ok: "Hohe Konfidenz",
  low: "Unsicher — bitte prüfen",
  missing: "Nicht extrahiert",
};

function ConfidenceDot({ value }: { value: number | null | undefined }) {
  const tone = confidenceTone(value);
  const label =
    value !== null && value !== undefined
      ? `${DOT_LABEL[tone]} (${Math.round(value * 100)}%)`
      : DOT_LABEL[tone];
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[tone]}`}
      title={label}
      aria-label={label}
    />
  );
}

function formatDecimal(value: number | null) {
  return value === null ? "" : value.toFixed(2);
}

function formatAmount(value: number | null, currency: string | null) {
  if (value === null) return "—";
  return value.toLocaleString("de-DE", {
    style: "currency",
    currency: currency || "EUR",
    minimumFractionDigits: 2,
  });
}

function formatDate(value: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

// ── Invoice type ──────────────────────────────────────────────────────────────

type Invoice = {
  id: number;
  vendorId: number | null;
  status: string;
  source: string;
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
  files: Array<{
    id: number;
    originalFilename: string;
    storedPath: string;
    displayFilename: string;
    sha256: string;
    sizeBytes: number;
    sourceType: string;
  }>;
  latestExtraction: {
    status: string;
    error: string | null;
    model: string | null;
    createdAt: string;
    output: unknown;
  } | null;
  events: Array<{
    id: number;
    level: string;
    eventType: string;
    yearMonth: string | null;
    message: string;
    createdAt: string;
  }>;
};

// ── Confirm mode (read-only summary + 1 big button) ───────────────────────────

function ConfirmPanel({
  invoice,
  exportTargets,
  extraction,
  isPending,
  onEdit,
}: {
  invoice: Invoice;
  vendors: Array<{ id: number; name: string }>;
  exportTargets: Array<{ id: number; label: string; recipientEmail: string | null }>;
  duplicateCandidates: Invoice["files"] extends Array<unknown> ? Array<{
    id: number;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    amountGross: number | null;
    currency: string | null;
    status: string;
    vendorName: string | null;
  }> : never;
  extraction: ExtractionOutput;
  isPending: boolean;
  onEdit: () => void;
}) {
  return (
    <>
      {/* Hidden inputs — carry all current values on submit */}
      <input type="hidden" name="invoiceId" value={invoice.id} />
      <input type="hidden" name="vendorId" value={invoice.vendorId ?? ""} />
      <input type="hidden" name="invoiceDate" value={invoice.invoiceDate ?? ""} />
      <input type="hidden" name="amountGross" value={formatDecimal(invoice.amountGross)} />
      <input type="hidden" name="currency" value={invoice.currency ?? "EUR"} />
      <input type="hidden" name="vatRate" value={invoice.vatRate !== null ? String(invoice.vatRate) : ""} />
      <input type="hidden" name="docType" value={invoice.docType ?? "invoice"} />
      <input type="hidden" name="invoiceNumber" value={invoice.invoiceNumber ?? ""} />
      <input type="hidden" name="amountNet" value={formatDecimal(invoice.amountNet)} />
      <input type="hidden" name="vatAmount" value={formatDecimal(invoice.vatAmount)} />
      <input type="hidden" name="servicePeriodStart" value={invoice.servicePeriodStart ?? ""} />
      <input type="hidden" name="servicePeriodEnd" value={invoice.servicePeriodEnd ?? ""} />
      <input type="hidden" name="duplicateOfInvoiceId" value={invoice.duplicateOfInvoiceId ?? ""} />
      <input type="hidden" name="exportTargetId" value={invoice.preferredExportTargetId ?? ""} />
      <input type="hidden" name="reviewStatus" value={invoice.status} />

      {/* Primary data summary */}
      <div className="space-y-1 py-1">
        {/* Vendor */}
        <div className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 hover:bg-surface/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <VendorLogo domain={invoice.vendorDomain} name={invoice.vendorName} size={28} className="shrink-0" />
            <span className="text-sm font-medium text-ink truncate">
              {invoice.vendorName || "Unbekannter Anbieter"}
            </span>
          </div>
          <ConfidenceDot value={extraction.vendor_confidence} />
        </div>

        {/* Date */}
        <div className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 hover:bg-surface/60">
          <span className="text-sm text-muted">Datum</span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink tabular-nums">{formatDate(invoice.invoiceDate)}</span>
            <ConfidenceDot value={extraction.date_confidence} />
          </div>
        </div>

        {/* Amount */}
        <div className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 hover:bg-surface/60">
          <span className="text-sm text-muted">Betrag</span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink tabular-nums">
              {formatAmount(invoice.amountGross, invoice.currency)}
            </span>
            <ConfidenceDot value={extraction.amount_confidence} />
          </div>
        </div>

        {/* Export target — only if multiple options */}
        {exportTargets.length > 1 && (
          <div className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-sm">
            <span className="text-muted">Empfänger</span>
            <span className="text-ink">
              {exportTargets.find((t) => t.id === invoice.preferredExportTargetId)?.label ?? "Standard"}
            </span>
          </div>
        )}
      </div>

      {/* CTA buttons */}
      <div className="space-y-2 border-t border-line pt-4">
        {invoice.status === "exported" ? (
          <div className="flex h-10 w-full items-center justify-center rounded bg-ok/10 text-sm text-ok">
            ✓ Bereits versendet
          </div>
        ) : (
          <Button
            type="submit"
            name="intent"
            value="mark_ready"
            disabled={isPending}
            variant="primary"
            fullWidth
            className="py-3 text-base"
          >
            Bereit — verschicken
            <kbd className="kbd ml-2 hidden border-white/30 bg-transparent text-white sm:inline-flex">⌘↵</kbd>
          </Button>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded border border-line px-3 py-2 text-xs text-muted hover:border-brand/50 hover:text-ink"
          >
            <Pencil size={11} aria-hidden />
            Korrigieren
          </button>
          <Button
            type="submit"
            name="intent"
            value="mark_duplicate"
            disabled={isPending}
            variant="ghost"
            className="flex-1 text-xs text-ink"
            title="Diese Rechnung ist eine Dublette"
          >
            Schon vorhanden
          </Button>
          <Button
            type="submit"
            name="intent"
            value="mark_ignored"
            disabled={isPending}
            variant="ghost"
            className="flex-1 text-xs text-muted"
            title="Brauch ich nicht weiter"
          >
            Ignorieren
          </Button>
        </div>
      </div>

      {/* Activity log */}
      {invoice.events.length > 0 && (
        <details className="text-sm mt-2">
          <summary className="cursor-pointer py-2 text-muted hover:text-ink">
            Aktivität ({invoice.events.length})
          </summary>
          <div className="mt-2 space-y-2 text-xs">
            {invoice.events.map((event) => (
              <div
                key={event.id}
                className="flex items-start justify-between gap-3 border-b border-line pb-2 last:border-b-0"
              >
                <span className={event.level === "error" ? "text-danger" : "text-ink"}>
                  {event.message}
                </span>
                <span className="shrink-0 text-muted">
                  {event.createdAt.slice(0, 16).replace("T", " ")}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

// ── Edit mode (full form) ─────────────────────────────────────────────────────

function EditPanel({
  invoice,
  vendors,
  exportTargets,
  duplicateCandidates,
  vendorSuggestions,
  extraction,
  isPending,
  onClose,
}: {
  invoice: Invoice;
  vendors: Array<{ id: number; name: string }>;
  exportTargets: Array<{ id: number; label: string; recipientEmail: string | null }>;
  duplicateCandidates: Array<{
    id: number;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    amountGross: number | null;
    currency: string | null;
    status: string;
    vendorName: string | null;
  }>;
  vendorSuggestions: VendorSuggestion[];
  extraction: ExtractionOutput;
  isPending: boolean;
  onClose: () => void;
}) {
  const [vendorId, setVendorId] = useState<string>(invoice.vendorId ? String(invoice.vendorId) : "");
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <>
      <input type="hidden" name="invoiceId" value={invoice.id} />
      <input type="hidden" name="reviewStatus" value={invoice.status} />

      <div className="space-y-3">
        {/* Vendor */}
        <div className="space-y-2">
          <FormField label="Lieferant" hint={<ConfidenceDot value={extraction.vendor_confidence} />}>
            {({ id }) => (
              <Select
                id={id}
                name="vendorId"
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
              >
                <option value="">Unbekannter Anbieter</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <VendorSuggestions
            suggestions={vendorSuggestions}
            onPick={(id) => setVendorId(String(id))}
          />
        </div>

        {/* Date */}
        <FormField label="Rechnungsdatum" hint={<ConfidenceDot value={extraction.date_confidence} />}>
          {({ id }) => (
            <Input id={id} type="date" name="invoiceDate" defaultValue={invoice.invoiceDate || ""} />
          )}
        </FormField>

        {/* Amount + currency */}
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <FormField label="Gesamtbetrag" hint={<ConfidenceDot value={extraction.amount_confidence} />}>
            {({ id }) => (
              <Input
                id={id}
                type="number"
                step="0.01"
                name="amountGross"
                defaultValue={formatDecimal(invoice.amountGross)}
              />
            )}
          </FormField>
          <FormField label="Währung">
            {({ id }) => (
              <Input
                id={id}
                name="currency"
                defaultValue={invoice.currency || "EUR"}
                placeholder="EUR"
                className="uppercase"
              />
            )}
          </FormField>
        </div>

        {/* VAT + doc type */}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="USt.-Satz" hint={<ConfidenceDot value={extraction.vat_rate_confidence} />}>
            {({ id }) => (
              <Select id={id} name="vatRate" defaultValue={invoice.vatRate !== null ? String(invoice.vatRate) : ""}>
                <option value="">Unbekannt</option>
                <option value="0">0 %</option>
                <option value="7">7 %</option>
                <option value="19">19 %</option>
              </Select>
            )}
          </FormField>
          <FormField label="Beleg-Typ" hint={<ConfidenceDot value={extraction.doc_type_confidence} />}>
            {({ id }) => (
              <Select id={id} name="docType" defaultValue={invoice.docType || "invoice"}>
                <option value="invoice">Rechnung</option>
                <option value="receipt">Quittung</option>
                <option value="credit_note">Gutschrift</option>
              </Select>
            )}
          </FormField>
        </div>

        {/* Export target */}
        {exportTargets.length > 0 && (
          <FormField label="Empfänger">
            {({ id }) => (
              <Select
                id={id}
                name="exportTargetId"
                defaultValue={invoice.preferredExportTargetId ? String(invoice.preferredExportTargetId) : ""}
              >
                <option value="">Standard (alle aktiven)</option>
                {exportTargets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}{t.recipientEmail ? ` · ${t.recipientEmail}` : ""}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        )}

        {/* Advanced / secondary fields */}
        <div className="border-t border-line/40">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex w-full items-center gap-1.5 py-2.5 text-xs text-muted hover:text-ink"
          >
            {showAdvanced ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
            Erweiterte Felder
          </button>

          {showAdvanced && (
            <div className="space-y-3 pb-2">
              <FormField label="Rechnungsnummer">
                {({ id }) => (
                  <Input id={id} name="invoiceNumber" defaultValue={invoice.invoiceNumber || ""} />
                )}
              </FormField>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Netto">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="number"
                      step="0.01"
                      name="amountNet"
                      defaultValue={formatDecimal(invoice.amountNet)}
                    />
                  )}
                </FormField>
                <FormField label="MwSt.">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="number"
                      step="0.01"
                      name="vatAmount"
                      defaultValue={formatDecimal(invoice.vatAmount)}
                    />
                  )}
                </FormField>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Leistungszeitraum von">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="date"
                      name="servicePeriodStart"
                      defaultValue={invoice.servicePeriodStart || ""}
                    />
                  )}
                </FormField>
                <FormField label="Leistungszeitraum bis">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="date"
                      name="servicePeriodEnd"
                      defaultValue={invoice.servicePeriodEnd || ""}
                    />
                  )}
                </FormField>
              </div>
              {duplicateCandidates.length > 0 && (
                <FormField label="Dublette von">
                  {({ id }) => (
                    <Select
                      id={id}
                      name="duplicateOfInvoiceId"
                      defaultValue={invoice.duplicateOfInvoiceId ? String(invoice.duplicateOfInvoiceId) : ""}
                    >
                      <option value="">Keine Verknüpfung</option>
                      {duplicateCandidates.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          #{candidate.id} · {candidate.vendorName || "Unbekannt"} ·{" "}
                          {candidate.invoiceNumber || "ohne Nummer"} · {candidate.invoiceDate || "-"}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Buttons */}
      <div className="space-y-2 border-t border-line pt-4">
        {invoice.status === "exported" ? (
          <div className="flex h-10 w-full items-center justify-center rounded bg-ok/10 text-sm text-ok">
            ✓ Bereits versendet
          </div>
        ) : (
          <Button
            type="submit"
            name="intent"
            value="mark_ready"
            disabled={isPending}
            variant="primary"
            fullWidth
            className="py-3"
          >
            Bereit — verschicken
            <kbd className="kbd ml-2 hidden border-white/30 bg-transparent text-white sm:inline-flex">⌘↵</kbd>
          </Button>
        )}
        <div className="flex gap-2">
          <Button
            type="submit"
            name="intent"
            value="save"
            disabled={isPending}
            variant="outline"
            className="flex-1"
          >
            {isPending ? "Speichere..." : "Nur speichern"}
          </Button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded border border-line px-3 py-2 text-xs text-muted hover:text-ink"
          >
            Schließen
          </button>
          <Button
            type="submit"
            name="intent"
            value="mark_ignored"
            disabled={isPending}
            variant="ghost"
            className="flex-1 text-muted text-xs"
          >
            Ignorieren
          </Button>
        </div>
      </div>

      {/* Activity */}
      {invoice.events.length > 0 && (
        <details className="text-sm mt-2">
          <summary className="cursor-pointer py-2 text-muted hover:text-ink">
            Aktivität ({invoice.events.length})
          </summary>
          <div className="mt-2 space-y-2 text-xs">
            {invoice.events.map((event) => (
              <div
                key={event.id}
                className="flex items-start justify-between gap-3 border-b border-line pb-2 last:border-b-0"
              >
                <span className={event.level === "error" ? "text-danger" : "text-ink"}>
                  {event.message}
                </span>
                <span className="shrink-0 text-muted">
                  {event.createdAt.slice(0, 16).replace("T", " ")}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function InvoiceReviewForm({
  invoice,
  vendors,
  duplicateCandidates,
  vendorSuggestions = [],
  exportTargets = [],
  adjacent,
}: {
  invoice: Invoice;
  vendors: Array<{ id: number; name: string }>;
  vendorSuggestions?: VendorSuggestion[];
  duplicateCandidates: Array<{
    id: number;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    amountGross: number | null;
    currency: string | null;
    status: string;
    vendorName: string | null;
  }>;
  exportTargets?: Array<{ id: number; label: string; recipientEmail: string | null }>;
  adjacent?: { prevId: number | null; nextId: number | null; position: number; total: number };
}) {
  const [state, formAction, isPending] = useActionState(updateInvoiceReviewAction, initialState);
  const router = useRouter();
  const hasRefreshed = useRef(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  // Start in confirm mode; switch to edit if AI confidence is low or extraction failed
  const lowConfidence = invoice.confidence !== null && invoice.confidence < 0.8;
  const hasAiError = !!invoice.latestExtraction?.error;
  const [mode, setMode] = useState<"confirm" | "edit">(
    lowConfidence || hasAiError ? "edit" : "confirm",
  );
  const [mobileTab, setMobileTab] = useState<"form" | "pdf">("form");

  const extraction = readExtractionOutput(invoice.latestExtraction?.output);

  useEffect(() => {
    if (state.status === "success" && !hasRefreshed.current) {
      hasRefreshed.current = true;
      router.refresh();
    }
    if (state.status !== "success") hasRefreshed.current = false;
  }, [router, state.status]);

  // Keyboard: Cmd/Ctrl+Enter → mark_ready; Esc → back to inbox
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        const btn = formRef.current?.querySelector<HTMLButtonElement>('button[value="mark_ready"]');
        btn?.click();
      }
      if (e.key === "Escape") {
        router.push("/audit");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router]);

  const primaryFile = invoice.files[0];

  return (
    <div className="screen-enter screen-enter-active space-y-0">
      {/* Nav row */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <Link
          href="/audit"
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-muted hover:text-ink"
        >
          ← zurück zum Posteingang
        </Link>
        {adjacent && (adjacent.prevId || adjacent.nextId) && (
          <nav
            className="flex items-center gap-1 text-xs text-muted"
            aria-label="Nächste/vorherige Rechnung"
          >
            {adjacent.position > 0 && (
              <span className="px-2 tabular-nums stat-num">
                {adjacent.position} von {adjacent.total}
              </span>
            )}
            {adjacent.prevId && (
              <Link
                href={`/audit/${adjacent.prevId}`}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded hover:bg-line/50 hover:text-ink"
                title="Vorherige"
                aria-label="Vorherige Rechnung"
              >
                ←
              </Link>
            )}
            {adjacent.nextId && (
              <Link
                href={`/audit/${adjacent.nextId}`}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded hover:bg-line/50 hover:text-ink"
                title="Nächste"
                aria-label="Nächste Rechnung"
              >
                →
              </Link>
            )}
          </nav>
        )}
      </div>

      {hasAiError && (
        <Alert tone="warning" title="Wir konnten nicht alles automatisch lesen.">
          Prüf die Felder unten und ergänze fehlende Angaben.
        </Alert>
      )}

      {/* Mobile tab bar */}
      <div className="mb-4 flex border-b border-line lg:hidden">
        {(["form", "pdf"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setMobileTab(t)}
            className={`h-10 flex-1 text-sm font-medium border-b-2 transition-colors ${
              mobileTab === t
                ? "border-brand text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t === "form" ? "Felder" : "Beleg"}
          </button>
        ))}
      </div>

      <div className="lg:grid lg:gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
        {/* PDF */}
        <div className={`overflow-hidden rounded-lg ${mobileTab === "pdf" ? "block" : "hidden lg:block"}`}>
          {primaryFile ? (
            <PdfViewer
              src={`/api/invoice-files/${primaryFile.id}`}
              className="max-h-[65vh] overflow-y-auto lg:max-h-[85vh]"
            />
          ) : (
            <div className="stripe flex h-96 items-center justify-center text-sm text-muted">
              Keine PDF gefunden.
            </div>
          )}
        </div>

        {/* Right column */}
        <div className={`space-y-4 ${mobileTab === "form" ? "block" : "hidden lg:block"}`}>
          {/* Vendor header */}
          <Card padding="lg">
            <div className="flex items-center gap-3">
              <VendorLogo domain={invoice.vendorDomain} name={invoice.vendorName} size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">
                  {invoice.vendorName || "Unbekannter Anbieter"}
                </div>
                <div className="truncate text-xs text-muted">
                  {invoice.invoiceNumber || "ohne Rechnungsnummer"}
                </div>
              </div>
              <StatusBadge status={invoice.status} />
            </div>
            {/* Status message — screen reader live region */}
            <p
              role={state.status === "error" ? "alert" : undefined}
              aria-live={state.status === "error" ? "assertive" : "polite"}
              aria-atomic="true"
              className={`mt-2 text-sm ${
                state.status === "error"
                  ? "text-danger"
                  : state.status === "success"
                    ? "text-ok"
                    : "sr-only"
              }`}
            >
              {state.message}
            </p>
          </Card>

          {/* Form card */}
          <Card padding="lg">
            <form ref={formRef} action={formAction} className="space-y-4">
              {mode === "confirm" ? (
                <ConfirmPanel
                  invoice={invoice}
                  vendors={vendors}
                  exportTargets={exportTargets}
                  duplicateCandidates={duplicateCandidates}
                  extraction={extraction}
                  isPending={isPending}
                  onEdit={() => setMode("edit")}
                />
              ) : (
                <EditPanel
                  invoice={invoice}
                  vendors={vendors}
                  exportTargets={exportTargets}
                  duplicateCandidates={duplicateCandidates}
                  vendorSuggestions={vendorSuggestions}
                  extraction={extraction}
                  isPending={isPending}
                  onClose={() => setMode("confirm")}
                />
              )}
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
