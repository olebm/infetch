import { cookies } from "next/headers";
import de from "@/../messages/de.json";
import en from "@/../messages/en.json";

export type Locale = "de" | "en";

const MESSAGES: Record<Locale, typeof de> = { de, en };
const COOKIE_NAME = "invoice-agent-locale";
const DEFAULT_LOCALE: Locale = "de";

export async function getLocale(): Promise<Locale> {
  try {
    const store = await cookies();
    const value = store.get(COOKIE_NAME)?.value;
    if (value === "de" || value === "en") return value;
  } catch {
    // outside request context (server startup) — fall through
  }
  return DEFAULT_LOCALE;
}

export async function getMessages(): Promise<typeof de> {
  const locale = await getLocale();
  return MESSAGES[locale];
}

/**
 * Lookup a translation by dot-path with optional {placeholder} interpolation.
 *
 *   const t = await getTranslator();
 *   t("nav.overview")                          // "Übersicht"
 *   t("tier.limitReached", { current: 2, max: 3 })
 */
export type Translator = (path: string, vars?: Record<string, string | number>) => string;

export async function getTranslator(): Promise<Translator> {
  const messages = await getMessages();
  return (path, vars) => {
    const value = path
      .split(".")
      .reduce<unknown>(
        (acc, key) =>
          acc && typeof acc === "object" && key in acc
            ? (acc as Record<string, unknown>)[key]
            : undefined,
        messages,
      );
    if (typeof value !== "string") return path;
    if (!vars) return value;
    return value.replace(/\{(\w+)\}/g, (_, key: string) =>
      key in vars ? String(vars[key]) : `{${key}}`,
    );
  };
}

export const I18N_COOKIE_NAME = COOKIE_NAME;
export const SUPPORTED_LOCALES: Locale[] = ["de", "en"];
