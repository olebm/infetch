"use client";

import { useState } from "react";

const INTERVALS = ["15 Min", "30 Min", "stündlich", "täglich", "manuell"] as const;
const DEFAULT = "30 Min";

export function ScanIntervalSelector() {
  const [selected, setSelected] = useState<string>(DEFAULT);

  return (
    <div className="flex flex-wrap gap-2">
      {INTERVALS.map((label) => {
        const active = selected === label;
        return (
          <button
            key={label}
            type="button"
            onClick={() => setSelected(label)}
            className={`px-3 h-9 rounded text-sm border transition-colors ${
              active
                ? "border-brand bg-brand-soft text-ink font-medium"
                : "border-line bg-paper text-ink hover:bg-surface"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
