"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { findUserByEmail, createUserWithDefaultOrg } from "@/lib/auth/users";
import { syncSupabaseUser } from "@/lib/auth/sync-supabase-user";

export type OtpActionResult = { ok: true } | { ok: false; error: string };

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed) ? trimmed : null;
}

/**
 * Schritt 1: 6-stelligen OTP-Code per E-Mail anfordern.
 *
 * Kein `emailRedirectTo` → Supabase sendet den Code aus dem `{{ .Token }}`-
 * Template statt eines klickbaren Links. Dadurch entfällt die PKCE-
 * `code_verifier`-Cookie-Abhängigkeit (Geräte-/Browser-unabhängig) und
 * Link-Scanner können den Token nicht vorab verbrauchen.
 */
export async function requestEmailOtp(email: string): Promise<OtpActionResult> {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, error: "Bitte gib eine gültige E-Mail-Adresse ein." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: normalized,
    options: { shouldCreateUser: true },
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Schritt 2: OTP-Code serverseitig einlösen, Session-Cookies setzen,
 * Postgres-Profil syncen und zum Ziel weiterleiten.
 */
export async function verifyEmailOtp(
  email: string,
  token: string,
  nextRaw: unknown,
): Promise<OtpActionResult> {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, error: "Bitte gib eine gültige E-Mail-Adresse ein." };

  const code = token.trim();
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: "Der Code besteht aus 6 Ziffern." };
  }

  const next = sanitizeNext(nextRaw);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email: normalized,
    token: code,
    type: "email",
  });

  if (error || !data.user) {
    return { ok: false, error: "Code ungültig oder abgelaufen. Bitte neuen Code anfordern." };
  }

  await syncSupabaseUser(data.user);
  redirect(next);
}

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
  // SECURITY (INFETCH-85): Test-Login nur wenn explizit aktiviert UND nicht prod.
  // Doppelte Absicherung: falls ENABLE_TEST_LOGIN versehentlich in prod gesetzt
  // wird, blockt der NODE_ENV-Check trotzdem.
  if (process.env.ENABLE_TEST_LOGIN !== "true" || process.env.NODE_ENV === "production") {
    throw new Error("loginAsTestUser is not enabled in this environment");
  }

  const next = sanitizeNext(formData.get("next"));
  const supabaseAdmin = createSupabaseAdminClient();

  // Test-User anlegen — gibt bei Erfolg direkt die ID zurück
  let supabaseUserId: string | undefined;

  const { data: createData } = await supabaseAdmin.auth.admin.createUser({
    email: STUB_EMAIL,
    email_confirm: true,
    user_metadata: { full_name: STUB_NAME },
  });

  if (createData?.user?.id) {
    supabaseUserId = createData.user.id;
  } else {
    // User existiert bereits — per listUsers suchen
    const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const found = (listData?.users ?? []).find(
      (u: { email?: string; id: string }) => u.email === STUB_EMAIL,
    );
    supabaseUserId = found?.id;
  }

  if (!supabaseUserId) throw new Error("Test login failed: Supabase user not found");

  // Postgres-Profil anlegen falls noch nicht vorhanden
  try {
    const existing = await findUserByEmail(STUB_EMAIL);
    if (!existing) {
      await createUserWithDefaultOrg({ email: STUB_EMAIL, name: STUB_NAME, userId: supabaseUserId });
    }
  } catch {
    // Non-fatal
  }

  // Magic-Link generieren und hashed_token extrahieren — kein Versand, kein externer Redirect
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: STUB_EMAIL,
    options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}${next}` },
  });
  if (linkError || !linkData?.properties?.hashed_token) {
    throw new Error(`Test login failed: ${linkError?.message ?? "no link"}`);
  }

  // Token serverseitig einlösen — setzt JWT-Cookies direkt ohne externen Redirect
  const supabase = await createSupabaseServerClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError) {
    throw new Error(`Test login failed: ${verifyError.message}`);
  }

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
