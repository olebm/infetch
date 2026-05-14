"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { getDb } from "@/lib/db/client";
import { findUserByEmail, createUserWithDefaultOrg } from "@/lib/auth/users";

const STUB_EMAIL = "test@infetch.local";
const STUB_NAME = "Test User";

function sanitizeNext(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

/**
 * Dev-only: einloggen als Test-User über Supabase Admin API.
 * Erstellt den Supabase-User falls nötig und generiert einen Magic-Link,
 * zu dem direkt weitergeleitet wird.
 */
export async function loginAsTestUser(formData: FormData) {
  // SECURITY: Test-Login ist niemals in Production erreichbar.
  if ((process.env.NODE_ENV as string) === "production") {
    throw new Error("loginAsTestUser is not available in production");
  }

  const next = sanitizeNext(formData.get("next"));

  const supabaseAdmin = createSupabaseAdminClient();

  // Test-User in Supabase anlegen (idempotent)
  try {
    await supabaseAdmin.auth.admin.createUser({
      email: STUB_EMAIL,
      email_confirm: true,
      user_metadata: { full_name: STUB_NAME },
    });
  } catch {
    // User existiert bereits — kein Fehler
  }

  // SQLite-Profil anlegen falls noch nicht vorhanden
  try {
    const db = getDb();
    const existing = findUserByEmail(STUB_EMAIL, db);
    if (!existing) {
      const { data: sbUser } = await supabaseAdmin.auth.admin.getUserByEmail(STUB_EMAIL) as { data: { user: { id: string } | null } };
      if (sbUser?.user) {
        createUserWithDefaultOrg({ email: STUB_EMAIL, name: STUB_NAME, db, userId: sbUser.user.id });
      }
    }
  } catch {
    // Non-fatal
  }

  // Supabase-User-ID nachschlagen
  const { data: sbUserData } = await supabaseAdmin.auth.admin.getUserByEmail(STUB_EMAIL) as {
    data: { user: { id: string } | null };
  };
  const supabaseUserId = sbUserData?.user?.id;
  if (!supabaseUserId) throw new Error("Test login failed: Supabase user not found");

  // Session serverseitig erstellen — kein externer Redirect nötig
  const { data: sessionData, error: sessionError } = await supabaseAdmin.auth.admin.createSession({
    user_id: supabaseUserId,
  });
  if (sessionError || !sessionData?.session) {
    throw new Error(`Test login failed: ${sessionError?.message ?? "no session"}`);
  }

  // Session in SSR-Cookies schreiben
  const supabase = await createSupabaseServerClient();
  await supabase.auth.setSession({
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
  });

  redirect(next);
}

/**
 * Abmelden — Supabase-Session beenden und zum Login weiterleiten.
 */
export async function logout() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
