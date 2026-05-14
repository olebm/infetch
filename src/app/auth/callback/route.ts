import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findUserByEmail, createUserWithDefaultOrg, createUserAndJoinOrg } from "@/lib/auth/users";
import { sendOnboardingEmail } from "@/lib/mail/notify";

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
      // Eingeladener Nutzer: user_metadata enthält invited_org_id + invited_role
      const invitedOrgId = data.user.user_metadata?.invited_org_id as string | undefined;
      const invitedRole = (data.user.user_metadata?.invited_role as string | undefined) ?? "member";
      const validRole = (["owner", "admin", "member"] as const).includes(invitedRole as "owner" | "admin" | "member")
        ? (invitedRole as "owner" | "admin" | "member")
        : "member";

      if (invitedOrgId) {
        // Einlade-Flow: User anlegen + zur bestehenden Org hinzufügen
        await createUserAndJoinOrg({
          email: data.user.email,
          name: (data.user.user_metadata?.full_name as string | undefined) ?? null,
          userId: data.user.id,
          organizationId: invitedOrgId,
          role: validRole,
        });
      } else {
        // Normaler Magic-Link-Login: eigene Org anlegen
        const name = (data.user.user_metadata?.full_name as string | undefined) ?? null;
        await createUserWithDefaultOrg({ email: data.user.email, name, userId: data.user.id });
        // Onboarding-Mail — fire & forget, blockiert den Login nicht
        void sendOnboardingEmail({ to: data.user.email, name }).catch((err) =>
          console.error("[auth/callback] onboarding email failed:", err),
        );
      }
    }
  } catch (err) {
    // Kein harter Fehler — App bleibt nutzbar, Profil wird ggf. beim nächsten Login angelegt
    console.error("[auth/callback] Postgres user sync failed:", err);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
