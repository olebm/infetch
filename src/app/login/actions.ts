"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
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
  // SECURITY (INFETCH-85): Test-Login nur wenn explizit aktiviert.
  // NODE_ENV-Check ist nicht ausreichend — Staging-Envs können NODE_ENV=development haben.
  // Einziger Weg: ENABLE_TEST_LOGIN=true muss bewusst gesetzt werden.
  if (process.env.ENABLE_TEST_LOGIN !== "true") {
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
