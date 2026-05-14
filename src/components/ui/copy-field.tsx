"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface CopyFieldProps {
  value: string;
  label?: string;
}

/**
 * Inline copy-to-clipboard field — pixel-matches Claude Design's `CopyField`.
 *
 * Two-part row: monospace value with surface bg + line border, copy button
 * with paper bg. Button label cycles "kopieren → kopiert → kopieren" with a
 * 1.8s window. Used in onboarding + fresh hero.
 */
export function CopyField({ value, label }: CopyFieldProps) {
  const [copied, setCopied] = useState(false);

  function copy() {
    try {
      navigator.clipboard?.writeText(value);
    } catch {
      /* ignore — modern browsers only */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div>
      {label && (
        <div className="mb-1.5 text-sm font-medium text-ink">{label}</div>
      )}
      <div className="flex items-stretch gap-2">
        <div className="flex h-10 flex-1 items-center truncate rounded border border-line bg-surface px-3 font-mono text-sm text-ink">
          {value}
        </div>
        <button
          type="button"
          onClick={copy}
          aria-label="Adresse kopieren"
          className="inline-flex h-10 items-center gap-1.5 rounded border border-line bg-white px-3 text-sm text-ink transition-colors hover:bg-surface"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-ok" aria-hidden /> kopiert
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden /> kopieren
            </>
          )}
        </button>
      </div>
    </div>
  );
}
