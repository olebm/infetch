"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { findUserByEmail, createUserWithDefaultOrg, ensureUserProvisioned } from "@/lib/auth/users";

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
      await createUserWithDefaultOrg({
        email: STUB_EMAIL,
        name: STUB_NAME,
        userId: supabaseUserId,
      });
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
 * OTP-Code serverseitig einlösen — verifyOtp läuft im selben Request, der die
 * Session-Cookies setzt (Set-Cookie auf der Action-Response). Das ersetzt den
 * vorherigen Pfad „Client-verifyOtp → separate Server-Action getUser()", dessen
 * Cross-Boundary-Cookie-Race der Auslöser des Login-Loops war: sah die Server-
 * Action die frisch im Browser gesetzten Cookies nicht, kam {ok:false} zurück
 * und der Client fiel auf den Start-Screen zurück (INFETCH-219).
 *
 * Spiegelt damit den bewährten Magic-Link-Pfad in /auth/callback:
 *   1. Verify im selben Request, der die Cookies schreibt (kein zweiter Hop).
 *   2. Provisioning aus `data.user` direkt — kein redundanter getUser().
 *   3. Provisioning-Fehler ist NICHT fatal: die Session steht, der User kommt
 *      rein; ein fehlendes Profil legt der nächste Request / das Layout-Gate an.
 */
export async function verifyOtpCode(input: {
  email: string;
  code: string;
}): Promise<{ ok: true; isNewUser: boolean } | { ok: false; error: string }> {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const code = typeof input.code === "string" ? input.code.trim() : "";

  if (!email || !/^\d{6}$/.test(code)) {
    return { ok: false, error: "invalid_input" };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: "email",
  });

  if (error || !data.user?.email) {
    // Falscher/abgelaufener Code → Client bleibt auf dem Code-Screen.
    return { ok: false, error: error?.message ?? "verify_failed" };
  }

  // Provisioning wie im Magic-Link-Callback: NICHT fatal. Ein transienter
  // DB-Fehler darf den frisch authentifizierten User nicht zurück ins Login
  // werfen — die Session steht bereits.
  let isNewUser = false;
  try {
    isNewUser = await ensureUserProvisioned({
      id: data.user.id,
      email: data.user.email,
      user_metadata: data.user.user_metadata ?? null,
    });
  } catch (err) {
    console.error("[login] OTP provisioning failed (non-fatal):", err);
  }

  return { ok: true, isNewUser };
}

/**
 * Nach erfolgreichem OTP-Login (Magic-Link im anderen Tab): Postgres-Profil
 * sicherstellen. Wird nur noch vom Cross-Tab-`onAuthStateChange`-Pfad genutzt,
 * wo die Browser-Session via StorageEvent bereits steht. Der Code-Eingabe-Pfad
 * läuft über `verifyOtpCode` (serverseitig).
 */
export async function provisionAfterOtp(): Promise<{ ok: boolean; isNewUser?: boolean }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) return { ok: false };

  try {
    // ensureUserProvisioned gibt true zurueck, wenn der User neu angelegt
    // wurde — der OTP-Code-Pfad nutzt das fuer einen direkten Onboarding-
    // Redirect (kein Doppel-Hop ueber das Layout-Gate, INFETCH-195).
    const isNewUser = await ensureUserProvisioned({
      id: user.id,
      email: user.email,
      user_metadata: user.user_metadata ?? null,
    });
    return { ok: true, isNewUser };
  } catch (err) {
    console.error("[login] OTP user provisioning failed:", err);
    return { ok: false };
  }
}

/**
 * Abmelden — Supabase-Session beenden und zum Login weiterleiten.
 */
export async function logout() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
