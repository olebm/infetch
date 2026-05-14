"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase-Client für Client Components.
 * Instanz wird pro Render neu erzeugt (ist idempotent / cached intern).
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
