"use client";

import { Check, X as XIcon, Zap } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useUpgrade } from "@/components/providers/upgrade-provider";

type Row = {
  label: string;
  free: string | "check" | "x";
  pro: string | "check";
};

const ROWS: Row[] = [
  { label: "Rechnungen / Monat",          free: "30",    pro: "150"    },
  { label: "Speicher",                     free: "500 MB", pro: "2 GB"  },
  { label: "Postfächer (IMAP)",            free: "1",     pro: "3"      },
  { label: "Nutzer",                       free: "1",     pro: "3"      },
  { label: "Auto-Approve",                 free: "check", pro: "check"  },
  { label: "Download pro Anbieter",        free: "check", pro: "check"  },
  { label: "Alle Rechnungen exportieren",  free: "x",     pro: "check"  },
  { label: "Retroaktiver Scan (12 Mo.)",   free: "x",     pro: "check"  },
  { label: "lexoffice / sevDesk",          free: "x",     pro: "check"  },
  { label: "DATEV-Export",                 free: "x",     pro: "check"  },
];

function Cell({ value, isPro }: { value: string | "check" | "x"; isPro: boolean }) {
  if (value === "check") return <Check className={`mx-auto h-3.5 w-3.5 ${isPro ? "text-brand" : "text-ok"}`} />;
  if (value === "x")     return <XIcon className="mx-auto h-3.5 w-3.5 text-muted opacity-30" />;
  return <span className={`font-medium ${isPro ? "text-brand" : "text-ink"}`}>{value}</span>;
}

export function UpgradeModal() {
  const { open, closeModal, stripeLink, feature } = useUpgrade();

  return (
    <Modal open={open} onClose={closeModal} title="Upgrade auf Pro" size="sm">
      {feature && (
        <p className="mb-4 rounded border border-brand/20 bg-brand-soft px-3 py-2 text-xs text-brand-deep">
          <strong>{feature}</strong> ist im Pro-Plan enthalten.
        </p>
      )}

      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="pb-2 text-left font-medium text-muted w-1/2" />
            <th className="pb-2 text-center font-medium text-muted w-1/4">Free</th>
            <th className="pb-2 text-center font-semibold text-brand w-1/4">Pro</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {ROWS.map((row) => (
            <tr key={row.label}>
              <td className="py-1.5 text-muted">{row.label}</td>
              <td className="py-1.5 text-center"><Cell value={row.free} isPro={false} /></td>
              <td className="py-1.5 text-center"><Cell value={row.pro} isPro /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-5 space-y-2">
        {stripeLink ? (
          <a
            href={stripeLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-md bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand/90 transition-colors"
          >
            <Zap className="h-4 w-4" aria-hidden />
            Pro für €19 / Monat
          </a>
        ) : (
          <a
            href="mailto:hallo@infetch.de?subject=Pro-Plan"
            className="flex w-full items-center justify-center gap-2 rounded-md bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand/90 transition-colors"
          >
            <Zap className="h-4 w-4" aria-hidden />
            Pro anfragen — €19 / Monat
          </a>
        )}
        <button
          type="button"
          onClick={closeModal}
          className="w-full rounded-md border border-line py-2 text-sm text-muted hover:text-ink transition-colors"
        >
          Vielleicht später
        </button>
      </div>
    </Modal>
  );
}
