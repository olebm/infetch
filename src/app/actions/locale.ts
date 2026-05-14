"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { I18N_COOKIE_NAME, SUPPORTED_LOCALES, type Locale } from "@/lib/i18n";

export async function setLocaleAction(locale: Locale): Promise<void> {
  if (!SUPPORTED_LOCALES.includes(locale)) return;
  const store = await cookies();
  store.set(I18N_COOKIE_NAME, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "lax",
    httpOnly: false,
  });
  revalidatePath("/");
}
