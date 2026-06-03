import Link from "next/link";
import { getMissingMatrix } from "@/lib/db/queries";
import { getCurrentAuth } from "@/lib/auth/current";
import { StatusBadge } from "@/components/status/status-badge";
import { MissingCheckForm } from "@/components/missing-matrix/missing-check-form";
import { toggleVendorHiddenAction } from "@/app/(app)/fehlt/actions";

export async function MissingMatrixView({ includeHidden = false }: { includeHidden?: boolean }) {
  const auth = await getCurrentAuth();
  const orgId = auth?.organization?.id ?? null;
  const rows = await getMissingMatrix(orgId, includeHidden);
  const months = rows[0]?.months.map((month) => month.month) || [];

  return (
    <div className="space-y-6">
      <header className="border-b border-line pb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Fehlt noch was?</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted">
              Pro Lieferant und Monat: was schon da ist, was wir noch holen, und wo du kurz helfen
              musst.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/fehlt"
              className="shrink-0 rounded border border-line px-3 py-1.5 text-xs text-muted hover:bg-surface"
            >
              Listen-Ansicht
            </Link>
            <Link
              href={includeHidden ? "/fehlt?view=matrix" : "/fehlt?view=matrix&showHidden=1"}
              className="shrink-0 rounded border border-line px-3 py-1.5 text-xs text-muted hover:bg-surface"
            >
              {includeHidden ? "Versteckte ausblenden" : "Versteckte anzeigen"}
            </Link>
          </div>
        </div>
      </header>

      <MissingCheckForm />

      {rows.length === 0 ? (
        <div className="rounded border border-line bg-white p-8 text-center text-sm text-muted">
          Noch keine Lieferanten erkannt. Sobald deine ersten Rechnungen reinkommen, taucht hier
          eine Liste auf.
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-line bg-white shadow-soft">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-surface text-xs uppercase text-muted">
              <tr>
                <th className="sticky left-0 bg-surface px-4 py-3">Lieferant</th>
                {months.map((month) => (
                  <th key={month} className="px-4 py-3">
                    {month}
                  </th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.vendor.id} className={row.vendor.hidden ? "opacity-50" : ""}>
                  <td className="sticky left-0 bg-white px-4 py-3 font-medium">
                    {row.vendor.name}
                    {row.vendor.hidden ? (
                      <span className="ml-2 text-xs text-muted">(versteckt)</span>
                    ) : null}
                  </td>
                  {row.months.map((month) => (
                    <td key={`${row.vendor.id}-${month.month}`} className="px-4 py-3">
                      {month.status === "action_required" ? (
                        <Link
                          href={`/portals#vendor-${row.vendor.canonicalKey}`}
                          className="inline-flex items-center transition hover:opacity-80"
                          title={`${row.vendor.name}: Portal-Aktion nötig (${month.month})`}
                        >
                          <StatusBadge status={month.status} />
                        </Link>
                      ) : (
                        <StatusBadge status={month.status} />
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">
                    <form action={toggleVendorHiddenAction}>
                      <input type="hidden" name="vendorId" value={row.vendor.id} />
                      <input type="hidden" name="hidden" value={row.vendor.hidden ? 0 : 1} />
                      <button
                        type="submit"
                        className="rounded px-2 py-1 text-xs text-muted hover:bg-surface hover:text-foreground"
                      >
                        {row.vendor.hidden ? "Einblenden" : "Verstecken"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded border border-line bg-white p-4 text-sm text-muted">
        Bei orange/rot brauchen wir kurz dein OK — meist ein neuer Login. Klick auf die Zelle.
      </div>
    </div>
  );
}
