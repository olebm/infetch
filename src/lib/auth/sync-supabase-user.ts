import type { User } from "@supabase/supabase-js";
import { findUserByEmail, createUserWithDefaultOrg, createUserAndJoinOrg } from "@/lib/auth/users";
import { sendOnboardingEmail } from "@/lib/mail/notify";

/**
 * Phase-1-Bridge: Legt für einen frisch authentifizierten Supabase-Nutzer
 * das Postgres-Profil an, falls noch nicht vorhanden.
 *
 * Invite-Flow: `user_metadata.invited_org_id` → User der bestehenden Org
 * hinzufügen. Sonst normaler Login → eigene Org + Onboarding-Mail.
 *
 * Wirft nie hart — ein fehlgeschlagener Sync darf den Login nicht blockieren,
 * das Profil wird beim nächsten Login erneut versucht.
 */
export async function syncSupabaseUser(user: User): Promise<void> {
  if (!user.email) return;

  try {
    const existing = await findUserByEmail(user.email);
    if (existing) return;

    const invitedOrgId = user.user_metadata?.invited_org_id as string | undefined;
    const invitedRole = (user.user_metadata?.invited_role as string | undefined) ?? "member";
    const validRole = (["owner", "admin", "member"] as const).includes(
      invitedRole as "owner" | "admin" | "member",
    )
      ? (invitedRole as "owner" | "admin" | "member")
      : "member";
    const name = (user.user_metadata?.full_name as string | undefined) ?? null;

    if (invitedOrgId) {
      await createUserAndJoinOrg({
        email: user.email,
        name,
        userId: user.id,
        organizationId: invitedOrgId,
        role: validRole,
      });
    } else {
      await createUserWithDefaultOrg({ email: user.email, name, userId: user.id });
      void sendOnboardingEmail({ to: user.email, name }).catch((err) =>
        console.error("[syncSupabaseUser] onboarding email failed:", err),
      );
    }
  } catch (err) {
    console.error("[syncSupabaseUser] Postgres user sync failed:", err);
  }
}
