"use client";

import { useTransition } from "react";
import { Globe } from "lucide-react";
import { setLocaleAction } from "@/app/actions/locale";
import type { Locale } from "@/lib/i18n";

export function LocaleSwitcher({ current }: { current: Locale }) {
  const [isPending, startTransition] = useTransition();

  const next: Locale = current === "de" ? "en" : "de";

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await setLocaleAction(next);
        })
      }
      className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-2 py-1.5 text-xs font-medium text-muted hover:border-brand/40 hover:text-ink disabled:opacity-50"
      title={next === "en" ? "Switch to English" : "Auf Deutsch wechseln"}
      aria-label={next === "en" ? "Switch to English" : "Auf Deutsch wechseln"}
    >
      <Globe className="h-3.5 w-3.5" aria-hidden />
      {current.toUpperCase()}
    </button>
  );
}
