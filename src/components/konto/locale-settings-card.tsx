"use client";

import { useActionState } from "react";
import { saveLocaleSettingsAction, type LocaleActionState } from "@/app/(app)/konto/actions";
import { Check, Loader2 } from "lucide-react";

// ── Static timezone list (Europa + UTC) ───────────────────────────────────────

const TIMEZONES: { value: string; label: string }[] = [
  { value: "Europe/Berlin", label: "Berlin (MEZ/MESZ)" },
  { value: "Europe/Vienna", label: "Wien (MEZ/MESZ)" },
  { value: "Europe/Zurich", label: "Zürich (MEZ/MESZ)" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Paris", label: "Paris (MEZ/MESZ)" },
  { value: "Europe/Amsterdam", label: "Amsterdam (MEZ/MESZ)" },
  { value: "Europe/Brussels", label: "Brüssel (MEZ/MESZ)" },
  { value: "Europe/Warsaw", label: "Warschau (MEZ/MESZ)" },
  { value: "Europe/Prague", label: "Prag (MEZ/MESZ)" },
  { value: "Europe/Budapest", label: "Budapest (MEZ/MESZ)" },
  { value: "Europe/Rome", label: "Rom (MEZ/MESZ)" },
  { value: "Europe/Madrid", label: "Madrid (MEZ/MESZ)" },
  { value: "Europe/Lisbon", label: "Lissabon (WEZ/WEST)" },
  { value: "Europe/Stockholm", label: "Stockholm (MEZ/MESZ)" },
  { value: "Europe/Oslo", label: "Oslo (MEZ/MESZ)" },
  { value: "Europe/Copenhagen", label: "Kopenhagen (MEZ/MESZ)" },
  { value: "Europe/Helsinki", label: "Helsinki (OEZ/OESZ)" },
  { value: "Europe/Athens", label: "Athen (OEZ/OESZ)" },
  { value: "Europe/Bucharest", label: "Bukarest (OEZ/OESZ)" },
  { value: "Europe/Istanbul", label: "Istanbul (TRT)" },
  { value: "UTC", label: "UTC" },
];

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  initialLanguage: string;
  initialTimezone: string;
};

const idle: LocaleActionState = { status: "idle", message: "" };

export function LocaleSettingsCard({ initialLanguage, initialTimezone }: Props) {
  const [state, formAction, isPending] = useActionState(saveLocaleSettingsAction, idle);

  return (
    <div>
      <div className="mb-3 text-sm font-medium text-ink">Sprache & Zeitzone</div>

      <form action={formAction} className="space-y-4">
        {/* Language */}
        <div>
          <label htmlFor="locale-language" className="mb-1 block text-xs font-medium text-muted">
            Sprache
          </label>
          <select
            id="locale-language"
            name="language"
            defaultValue={initialLanguage}
            disabled={isPending}
            className="h-9 w-full rounded border border-line bg-white px-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
          <p className="mt-1 text-[11px] text-muted">
            Wird für zukünftige Sprachumstellung der Oberfläche verwendet.
          </p>
        </div>

        {/* Timezone */}
        <div>
          <label htmlFor="locale-timezone" className="mb-1 block text-xs font-medium text-muted">
            Zeitzone
          </label>
          <select
            id="locale-timezone"
            name="timezone"
            defaultValue={initialTimezone}
            disabled={isPending}
            className="h-9 w-full rounded border border-line bg-white px-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted">
            Beeinflusst Datumsangaben in E-Mail-Betreffzeilen und Exporten.
          </p>
        </div>

        {/* Feedback */}
        {state.status === "error" && <p className="text-xs text-danger">{state.message}</p>}
        {state.status === "success" && (
          <p className="flex items-center gap-1 text-xs text-ok">
            <Check size={12} aria-hidden />
            {state.message}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-9 items-center gap-1.5 rounded bg-brand px-4 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        >
          {isPending && <Loader2 size={13} className="animate-spin" aria-hidden />}
          Speichern
        </button>
      </form>
    </div>
  );
}
