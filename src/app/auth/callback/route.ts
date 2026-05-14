import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findUserByEmail, createUserWithDefaultOrg } from "@/lib/auth/users";

/**
 * Supabase Auth Callback — tauscht den One-Time-Code gegen eine Session.
 *
 * Supabase leitet nach dem Magic-Link-Klick hierher weiter:
 *   GET /auth/callback?code=xxx&next=/ziel
 *
 * Nach erfolgreichem Tausch wird der Nutzer entweder zu `/next` oder nach `/`
 * weitergeleitet. Fehler landen auf `/login?error=auth_error`.
 *
 * Phase-1-Bridge: Falls der Nutzer noch kein Postgres-Profil hat (Erst-Login),
 * wird es hier angelegt.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_error`);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user?.email) {
    console.error("[auth/callback] code exchange failed:", error?.message);
    return NextResponse.redirect(`${origin}/login?error=auth_error`);
  }

  // Phase-1-Bridge: Nutzer in Postgres anlegen falls noch nicht vorhanden
  try {
    const existing = await findUserByEmail(data.user.email);
    if (!existing) {
      await createUserWithDefaultOrg({
        email: data.user.email,
        name: (data.user.user_metadata?.full_name as string | undefined) ?? null,
        userId: data.user.id,
      });
    }
  } catch (err) {
    // Kein harter Fehler — App bleibt nutzbar, Profil wird ggf. beim nächsten Login angelegt
    console.error("[auth/callback] Postgres user sync failed:", err);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
