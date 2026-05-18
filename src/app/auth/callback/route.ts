import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureUserProvisioned } from "@/lib/auth/users";

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
  const { searchParams, origin: rawOrigin } = new URL(request.url);
  // Behind Coolify/nginx, request.url resolves to the internal address (0.0.0.0:3000).
  // Use x-forwarded-host + x-forwarded-proto set by the reverse proxy instead.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : rawOrigin;
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
  let isNewUser = false;
  try {
    isNewUser = await ensureUserProvisioned({
      id: data.user.id,
      email: data.user.email,
      user_metadata: data.user.user_metadata ?? null,
    });
  } catch (err) {
    // Kein harter Fehler — App bleibt nutzbar, Profil wird ggf. beim nächsten Login angelegt
    console.error("[auth/callback] Postgres user sync failed:", err);
  }

  // Neue User direkt zum Onboarding — vermeidet den Doppel-Redirect über /
  if (isNewUser) {
    return NextResponse.redirect(`${origin}/onboarding`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
