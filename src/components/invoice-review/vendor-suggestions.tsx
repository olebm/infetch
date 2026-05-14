"use client";

import { Sparkles, Mail, FileText, Globe2 } from "lucide-react";
import type { VendorSuggestion } from "@/vendors/suggestions";

type Props = {
  suggestions: VendorSuggestion[];
  onPick: (vendorId: number) => void;
};

const REASON_ICON: Record<VendorSuggestion["reason"], typeof Sparkles> = {
  sender_history: Mail,
  domain_alias: Globe2,
  name_in_text: FileText,
  filename_pattern: FileText,
};

export function VendorSuggestions({ suggestions, onPick }: Props) {
  if (suggestions.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="text-2xs text-muted/60">Vorschläge</div>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((suggestion) => {
          const Icon = REASON_ICON[suggestion.reason];
          return (
            <button
              key={suggestion.vendorId}
              type="button"
              onClick={() => onPick(suggestion.vendorId)}
              className="group inline-flex items-center gap-1.5 rounded border border-line bg-white px-2.5 py-1 text-xs hover:border-brand hover:bg-brand/5"
              title={suggestion.detail}
            >
              <Icon className="h-3 w-3 text-muted group-hover:text-brand" aria-hidden />
              <span className="font-medium text-ink">{suggestion.vendorName}</span>
              <span className="text-muted">·</span>
              <span className="text-muted">{suggestion.detail}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
