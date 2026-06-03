"use client";

import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

interface YearSelectorProps {
  years: number[];
  selectedYear: string | null;
  currentStatus: string;
}

export function YearSelector({ years, selectedYear, currentStatus }: YearSelectorProps) {
  const router = useRouter();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams();
    if (currentStatus) params.set("status", currentStatus);
    if (e.target.value) params.set("year", e.target.value);
    const qs = params.toString();
    router.push(qs ? `/audit?${qs}` : "/audit");
  }

  if (years.length === 0) return null;

  return (
    <div className="relative inline-flex items-center">
      <select
        value={selectedYear ?? ""}
        onChange={handleChange}
        className="appearance-none bg-transparent py-1.5 pl-0 pr-5 text-sm text-muted hover:text-ink focus:outline-none"
      >
        <option value="">Alle Jahre</option>
        {years.map((year) => (
          <option key={year} value={String(year)}>
            {year}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-0 h-3 w-3 text-muted"
        aria-hidden
      />
    </div>
  );
}
