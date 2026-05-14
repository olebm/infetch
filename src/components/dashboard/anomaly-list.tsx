import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";

type OverdueVendor = { vendorName: string; daysSince: number };
type DuplicateInvoice = { id: number; vendorName: string | null };

interface AnomalyListProps {
  overdueVendors: OverdueVendor[];
  duplicates: DuplicateInvoice[];
}

export function AnomalyList({ overdueVendors, duplicates }: AnomalyListProps) {
  const items: Array<{ key: string; icon: typeof AlertTriangle; text: string; href: string }> = [];

  for (const v of overdueVendors.slice(0, 3)) {
    items.push({
      key: `overdue-${v.vendorName}`,
      icon: Clock,
      text: `${v.vendorName} — seit ${v.daysSince} Tagen keine Rechnung mehr`,
      href: "/audit",
    });
  }

  if (duplicates.length > 0) {
    items.push({
      key: "duplicates",
      icon: AlertTriangle,
      text:
        duplicates.length === 1
          ? "1 mögliche Duplikat-Rechnung"
          : `${duplicates.length} mögliche Duplikat-Rechnungen`,
      href: "/audit?status=duplicate",
    });
  }

  if (items.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-ink">Worauf wir achten</h2>
      <div className="space-y-1">
        {items.map(({ key, icon: Icon, text, href }) => (
          <Link
            key={key}
            href={href}
            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted transition hover:bg-surface hover:text-ink"
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
            <span className="min-w-0 truncate">{text}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
