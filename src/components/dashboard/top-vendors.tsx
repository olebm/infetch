import Link from "next/link";
import { VendorLogo } from "@/components/ui/vendor-logo";

type TopVendorItem = {
  vendorName: string;
  vendorDomain: string | null;
  count: number;
  sumGross: number;
  deltaPrevMonth: number;
};

interface TopVendorsProps {
  vendors: TopVendorItem[];
}

export function TopVendors({ vendors }: TopVendorsProps) {
  if (vendors.length === 0) return null;

  return (
    <section>
      <div className="flex items-baseline justify-between border-b border-line pb-3">
        <div className="font-display text-2xl text-ink">Top-Anbieter</div>
        <Link
          href="/senders"
          className="text-xs text-muted underline decoration-line underline-offset-4 hover:text-ink"
        >
          Anbieter
        </Link>
      </div>
      <ul className="mt-6 grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-5">
        {vendors.map((v) => (
          <VendorItem key={v.vendorName} {...v} />
        ))}
      </ul>
    </section>
  );
}

function VendorItem({ vendorName, vendorDomain, count, sumGross, deltaPrevMonth }: TopVendorItem) {
  const trend = deltaPrevMonth > 0 ? "↗" : deltaPrevMonth < 0 ? "↘" : "→";
  const deltaLabel = deltaPrevMonth > 0 ? `+${deltaPrevMonth}` : String(deltaPrevMonth);
  const eur = sumGross.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  return (
    <li>
      <Link href="/senders" className="group flex flex-col gap-3">
        <VendorLogo domain={vendorDomain} name={vendorName} size={40} />
        <div>
          <div className="truncate text-sm text-ink underline-offset-4 decoration-line group-hover:underline">
            {vendorName}
          </div>
          <div className="mt-0.5 stat-num text-xs text-muted">
            {count} × · {eur}{" "}
            <span className="text-muted/70">· {trend} {deltaLabel}</span>
          </div>
        </div>
      </Link>
    </li>
  );
}
