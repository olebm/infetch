"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { updateInvoiceReviewAction, type InvoiceReviewState } from "@/app/(app)/audit/actions";
import { StatusBadge } from "@/components/status/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField, Input, Select } from "@/components/ui/form-field";
import { VendorLogo } from "@/components/ui/vendor-logo";
import { VendorSuggestions } from "@/components/invoice-review/vendor-suggestions";
// PERFORMANCE (INFETCH-97): pdfjs-dist (~2–3 MB) nur laden wenn PDF-Tab aktiv.
// Statischer Import würde die Bibliothek in das initiale Client-Bundle packen.
import dynamic from "next/dynamic";
const PdfViewer = dynamic(
  () => import("@/components/invoice-review/pdf-viewer").then((m) => ({ default: m.PdfViewer })),
  { ssr: false },
);
import type { VendorSuggestion } from "@/vendors/suggestions";

const initialState: InvoiceReviewState = {
  status: "idle",
  message: "Prüf die Daten und korrigier was nicht stimmt.",
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


export function InvoiceReviewForm({
  invoice,
  vendors,
  duplicateCandidates,
  vendorSuggestions = [],
  exportTargets = [],
  adjacent,
}: {
  invoice: {
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
  const [vendorId, setVendorId] = useState<string>(invoice.vendorId ? String(invoice.vendorId) : "");
  const [mobileTab, setMobileTab] = useState<"form" | "pdf">("form");

  useEffect(() => {
    if (state.status === "success" && !hasRefreshed.current) {
      hasRefreshed.current = true;
      router.refresh();
    }
    if (state.status !== "success") hasRefreshed.current = false;
  }, [router, state.status]);

  // Keyboard shortcut: Cmd/Ctrl+Enter -> mark_ready; Esc -> back to inbox
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        const btn = formRef.current?.querySelector<HTMLButtonElement>(
          'button[value="mark_ready"]',
        );
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
  const lowConfidence = invoice.confidence !== null && invoice.confidence < 0.8;
  const hasAiError = invoice.latestExtraction?.error;
  const extraction = readExtractionOutput(invoice.latestExtraction?.output);

  return (
    <div className="screen-enter screen-enter-active space-y-0">
      {/* ── Nav row ───────────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <Link href="/audit" className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-muted hover:text-ink">
          ← zurück zum Posteingang
        </Link>
        {adjacent && (adjacent.prevId || adjacent.nextId) && (
          <nav className="flex items-center gap-1 text-xs text-muted" aria-label="Nächste/vorherige Rechnung">
            {adjacent.position > 0 && (
              <span className="px-2 tabular-nums stat-num">{adjacent.position} von {adjacent.total}</span>
            )}
            {adjacent.prevId && (
              <Link href={`/audit/${adjacent.prevId}`} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded hover:bg-line/50 hover:text-ink" title="Vorherige" aria-label="Vorherige Rechnung">←</Link>
            )}
            {adjacent.nextId && (
              <Link href={`/audit/${adjacent.nextId}`} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded hover:bg-line/50 hover:text-ink" title="Nächste" aria-label="Nächste Rechnung">→</Link>
            )}
          </nav>
        )}
      </div>

      {hasAiError && (
        <Alert tone="warning" title="Wir konnten nicht alles automatisch lesen.">
          Prüf die Felder unten und ergänze fehlende Angaben.
        </Alert>
      )}

      {/* Mobile Tab-Bar — nur unter lg sichtbar */}
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
        {/* PDF Vorschau */}
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

        {/* ── Right column ────────────────────────────────────────────── */}
        <div className={`space-y-4 ${mobileTab === "form" ? "block" : "hidden lg:block"}`}>
          {/* Vendor header card */}
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
            {lowConfidence && (
              <p className="mt-3 text-xs text-muted">
                <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-warn" aria-hidden />
                Auto-Erkennung war unsicher — bitte Daten prüfen.
              </p>
            )}
            {/* A11Y (INFETCH-105): Persistentes Live-Region → Screen-Reader kündigt
                Status-Änderungen an auch wenn Element neu gemountet wird */}
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
            <input type="hidden" name="invoiceId" value={invoice.id} />

            <div className="space-y-3">
              <div className="space-y-2">
                <FormField
                  label="Lieferant"
                  hint={<ConfidenceDot value={extraction.vendor_confidence} />}
                >
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

              <FormField
                label="Rechnungsdatum"
                hint={<ConfidenceDot value={extraction.date_confidence} />}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    type="date"
                    name="invoiceDate"
                    defaultValue={invoice.invoiceDate || ""}
                  />
                )}
              </FormField>

              <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                <FormField
                  label="Gesamtbetrag"
                  hint={<ConfidenceDot value={extraction.amount_confidence} />}
                >
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

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  label="USt.-Satz"
                  hint={<ConfidenceDot value={extraction.vat_rate_confidence} />}
                >
                  {({ id }) => (
                    <Select
                      id={id}
                      name="vatRate"
                      defaultValue={invoice.vatRate !== null ? String(invoice.vatRate) : ""}
                    >
                      <option value="">Unbekannt</option>
                      <option value="0">0 %</option>
                      <option value="7">7 %</option>
                      <option value="19">19 %</option>
                    </Select>
                  )}
                </FormField>
                <FormField
                  label="Beleg-Typ"
                  hint={<ConfidenceDot value={extraction.doc_type_confidence} />}
                >
                  {({ id }) => (
                    <Select
                      id={id}
                      name="docType"
                      defaultValue={invoice.docType || "invoice"}
                    >
                      <option value="invoice">Rechnung</option>
                      <option value="receipt">Quittung</option>
                      <option value="credit_note">Gutschrift</option>
                    </Select>
                  )}
                </FormField>
              </div>

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
            </div>

            <div className="space-y-3 border-t border-line/40 pt-3">
              <FormField label="Rechnungsnummer">
                {({ id }) => (
                  <Input
                    id={id}
                    name="invoiceNumber"
                    defaultValue={invoice.invoiceNumber || ""}
                  />
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
                <FormField label="Dublette von (gleiche Rechnung)">
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
              <input type="hidden" name="reviewStatus" value={invoice.status} />
            </div>

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
                <kbd className="kbd ml-2 hidden border-white/30 bg-transparent text-white sm:inline-flex">
                  ⌘↵
                </kbd>
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
                <Button
                  type="submit"
                  name="intent"
                  value="mark_duplicate"
                  disabled={isPending}
                  variant="ghost"
                  className="flex-1 text-ink"
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
                  className="flex-1 text-muted"
                  title="Brauch ich nicht weiter"
                >
                  Ignorieren
                </Button>
              </div>
            </div>

            <details className="text-sm">
              <summary className="cursor-pointer py-2 text-muted hover:text-ink">
                Aktivität ({invoice.events.length})
              </summary>
              <div className="mt-2 space-y-2 text-xs">
                {invoice.events.length === 0 ? (
                  <div className="text-muted">Noch nichts passiert mit dieser Rechnung.</div>
                ) : (
                  invoice.events.map((event) => (
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
                  ))
                )}
              </div>
            </details>
          </form>
          </Card>

        </div>{/* end right column */}
      </div>
    </div>
  );
}

function formatDecimal(value: number | null) {
  return value === null ? "" : value.toFixed(2);
}
