"use client";

import { VendorLogo } from "@/components/ui/vendor-logo";
import { MAIL_PROVIDERS, type MailProvider } from "@/lib/mail-providers";

type ProviderPresetGridProps = {
  /** Welcher Config-Typ wird befüllt */
  mode: "imap" | "smtp";
  /** Callback wenn ein Preset ausgewählt wird */
  onSelect: (preset: MailProvider) => void;
};

/**
 * Raster mit Schnell-Auswahl-Buttons für gängige Mailanbieter.
 * Jeder Button füllt die IMAP- oder SMTP-Felder des Formulars vor.
 */
export function ProviderPresetGrid({ onSelect }: ProviderPresetGridProps) {
  return (
    <div>
      <p className="mb-2 text-xs text-muted">
        Anbieter wählen — Servereinstellungen werden automatisch eingetragen:
      </p>
      <div className="flex flex-wrap gap-2">
        {MAIL_PROVIDERS.map((provider) => (
          <button
            key={provider.id}
            type="button"
            onClick={() => onSelect(provider)}
            className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-2.5 py-1.5 text-xs text-ink transition hover:border-brand/50 hover:bg-surface active:scale-95"
          >
            <VendorLogo domain={provider.domain} vendorName={provider.name} size={16} />
            <span>{provider.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
