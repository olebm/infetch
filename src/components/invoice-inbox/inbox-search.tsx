"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

interface InboxSearchProps {
  initialValue: string;
  tab?: string;
  year?: string;
  defaultTab?: string;
  /** Immer aufgeklappt, volle Breite, Icon links — für Sticky-Bar auf Mobile */
  expanded?: boolean;
}

export function InboxSearch({
  initialValue,
  tab,
  year,
  defaultTab = "review",
  expanded = false,
}: InboxSearchProps) {
  const [value, setValue] = useState(initialValue);
  const [open, setOpen] = useState(!!initialValue || expanded);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setValue(initialValue);
    if (initialValue) setOpen(true);
  }, [initialValue]);

  useEffect(() => {
    // Im expanded-Modus nie schließen; sonst auf open-Änderung fokussieren
    if (!expanded && open) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open, expanded]);

  function buildHref(q: string): string {
    const params = new URLSearchParams();
    if (tab && tab !== defaultTab) params.set("tab", tab);
    if (year) params.set("year", year);
    if (q) params.set("q", q);
    const qs = params.toString();
    return qs ? `/audit?${qs}` : "/audit";
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setValue(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => router.push(buildHref(q)), 300);
  }

  /** Icon button / Esc: closes + clears everything */
  function handleClose() {
    setValue("");
    setOpen(false);
    router.push(buildHref(""));
  }

  /** Blur: only collapse if field is empty (not in expanded mode) */
  function handleBlur() {
    if (!expanded && !value) setOpen(false);
  }

  // ── Expanded (Sticky-Bar auf Mobile): immer aufgeklappt, Icon links ──────────
  if (expanded) {
    return (
      <div className="flex w-full items-center gap-2 rounded border border-line bg-paper px-3 h-10">
        <Search size={15} className="shrink-0 text-muted/60" aria-hidden />
        {/* A11Y (INFETCH-104): aria-label für Screen-Reader (kein sichtbares Label) */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          placeholder="Suchen…"
          aria-label="Suche"
          className="flex-1 bg-transparent text-sm text-ink placeholder:text-muted/50 outline-none"
        />
        {value && (
          <button
            type="button"
            onClick={handleClose}
            className="flex h-6 w-6 shrink-0 items-center justify-center text-muted/60 hover:text-muted transition-colors"
            aria-label="Suche löschen"
          >
            <X size={14} />
          </button>
        )}
      </div>
    );
  }

  // ── Default (Desktop, Tab-Bar): aufklappbar, Icon rechts ────────────────────
  return (
    <div className="flex shrink-0 items-center justify-end gap-1">
      {/* Expanding input — grows left from the icon */}
      <div
        className={`overflow-hidden transition-[width,opacity] duration-200 ease-out ${
          open ? "w-56 opacity-100" : "w-0 opacity-0"
        }`}
      >
        <div className="relative w-56">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder="Suchen…"
            aria-label="Suche"
            className="h-9 w-full border-0 bg-transparent pl-1 pr-2 text-sm text-ink placeholder:text-muted/50 outline-none"
          />
        </div>
      </div>

      {/* Icon button — Search when closed, X when open */}
      <button
        type="button"
        onClick={open ? handleClose : () => setOpen(true)}
        className="flex h-9 w-9 shrink-0 items-center justify-center text-muted/60 transition-colors hover:text-muted"
        aria-label={open ? "Suche schließen" : "Suche öffnen"}
      >
        {open ? <X size={15} /> : <Search size={15} />}
      </button>
    </div>
  );
}
