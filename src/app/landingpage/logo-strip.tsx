import { VendorLogo } from "@/components/ui/vendor-logo";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="relative group/tip inline-flex">
      {children}
      <span className="hidden md:block pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2
                       rounded-md px-2.5 py-1 bg-ink text-white text-[11px] leading-snug
                       whitespace-nowrap opacity-0 group-hover/tip:opacity-100
                       transition-opacity duration-150 z-50 shadow-pop">
        {label}
        <span className="absolute top-full left-1/2 -translate-x-1/2
                         border-[4px] border-transparent border-t-ink" />
      </span>
    </span>
  );
}

// Top global vendors by invoice count — cross-org aggregate, public landing page.
async function getTopLandingVendors(): Promise<{ name: string; domain: string | null }[]> {
  return sql<{ name: string; domain: string | null }[]>`
    SELECT
      v.name,
      (
        SELECT alias FROM vendor_aliases
        WHERE vendor_id = v.id AND match_type = 'domain'
        ORDER BY priority ASC LIMIT 1
      ) AS domain
    FROM vendors v
    LEFT JOIN invoices i ON i.vendor_id = v.id
    WHERE v.organization_id IS NULL
      AND v.hidden IS NOT TRUE
    GROUP BY v.id, v.name
    ORDER BY COUNT(i.id) DESC, v.name ASC
    LIMIT 6
  `;
}

export async function LogoStrip() {
  const vendors = await getTopLandingVendors();

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-5 md:gap-x-10">
      {vendors.map(({ name, domain }) => (
        <Tip key={name} label={name}>
          <VendorLogo name={name} domain={domain} size={48} />
        </Tip>
      ))}
    </div>
  );
}
