import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

export type ActionRequiredInvoice = {
  id: number;
  vendorName: string | null;
  invoiceDate: string | null;
  amountGross: number | null;
  currency: string | null;
};

function formatAmount(amount: number | null, currency: string | null): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: currency || "EUR",
  }).format(amount);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return value;
  return ts.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function ActionRequiredPanel({ items, total }: { items: ActionRequiredInvoice[]; total: number }) {
  if (total === 0) {
    return (
      <div className="rounded border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ok">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          Alles aktuell. Keine Rechnungen warten auf dein OK.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border border-warn/30 bg-warn-soft p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-warn">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        {total === 1 ? "1 Rechnung braucht dein OK" : `${total} Rechnungen brauchen dein OK`}
      </div>
      <ul className="space-y-1.5 text-sm">
        {items.map((invoice) => (
          <li key={invoice.id}>
            <Link
              href={`/audit/${invoice.id}`}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded px-2 py-1.5 hover:bg-warn-soft"
            >
              <span className="font-medium text-warn">
                {invoice.vendorName ?? "Unbekannter Lieferant"}
              </span>
              <span className="text-xs text-warn">
                {formatDate(invoice.invoiceDate)} · {formatAmount(invoice.amountGross, invoice.currency)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {total > items.length && (
        <Link
          href="/audit?status=needs_review"
          className="mt-3 inline-flex text-xs font-medium text-warn underline-offset-2 hover:underline"
        >
          Alle {total} ansehen →
        </Link>
      )}
    </div>
  );
}
