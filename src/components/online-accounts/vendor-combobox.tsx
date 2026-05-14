"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

export type VendorOption = {
  canonicalKey: string;
  name: string;
};

export function VendorCombobox({
  options,
  value,
  onChange,
  placeholder = "Lieferant aus deinem Posteingang waehlen...",
}: {
  options: VendorOption[];
  value: string;
  onChange: (canonicalKey: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = options.find((o) => o.canonicalKey === value);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options.slice(0, 50);
    return options
      .filter((o) => o.name.toLowerCase().includes(needle))
      .slice(0, 50);
  }, [options, query]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded border border-line bg-surface px-3 py-2 text-left text-sm hover:border-brand/40"
      >
        <span className={selected ? "text-ink" : "text-muted"}>
          {selected ? selected.name : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 text-muted" aria-hidden />
      </button>
      {open && (
        <div className="absolute z-10 mt-1 max-h-80 w-full overflow-hidden rounded border border-line bg-white shadow-soft">
          <div className="relative border-b border-line">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Suchen..."
              className="w-full bg-transparent py-2 pl-9 pr-3 text-sm outline-none"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm text-muted">
                Kein passender Lieferant. Lege einen neuen an (Schritt unten).
              </li>
            ) : (
              filtered.map((option) => (
                <li key={option.canonicalKey}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(option.canonicalKey);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`flex w-full items-center px-3 py-2 text-left text-sm transition hover:bg-surface ${
                      option.canonicalKey === value ? "bg-brand/5 text-brand" : "text-ink"
                    }`}
                  >
                    {option.name}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
