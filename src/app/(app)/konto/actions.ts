"use server";

import { revalidatePath } from "next/cache";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { getCurrentAuth } from "@/lib/auth/current";
import { updateUserAvatar } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getLimits, getOrgTier } from "@/lib/tier";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MemberActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function assertOwnerOrAdmin(orgId: string, userId: string) {
  const rows = await sql<{ role: string }[]>`
    SELECT role FROM org_members
    WHERE organization_id = ${orgId} AND user_id = ${userId}
    LIMIT 1
  `;
  const role = rows[0]?.role;
  if (role !== "owner" && role !== "admin") {
    throw new Error("Nur Inhaber oder Bearbeiter können Mitglieder verwalten.");
  }
  return role as "owner" | "admin";
}

async function countOrgMembers(orgId: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*) AS count FROM org_members WHERE organization_id = ${orgId}
  `;
  return Number(rows[0]?.count ?? 0);
}

// ── Invite ────────────────────────────────────────────────────────────────────

/**
 * Sendet eine Einlade-E-Mail an eine neue E-Mail-Adresse.
 * Der Empfänger klickt den Link → /auth/callback → wird zur Org hinzugefügt.
 */
export async function inviteMemberAction(
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const auth = await getCurrentAuth();
  if (!auth?.user || !auth?.organization) {
    return { status: "error", message: "Nicht eingeloggt." };
  }

  const orgId = auth.organization.id;
  const callerId = auth.user.id;

  try {
    await assertOwnerOrAdmin(orgId, callerId);
  } catch (e) {
    return { status: "error", message: (e as Error).message };
  }

  const email = (formData.get("email") as string | null)?.trim().toLowerCase();
  const role = (formData.get("role") as string | null) ?? "member";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: "error", message: "Bitte eine gültige E-Mail-Adresse angeben." };
  }

  const validRoles = ["admin", "member"] as const;
  const invitedRole = validRoles.includes(role as "admin" | "member") ? role : "member";

  // Tier-Limit prüfen
  const tier = await getOrgTier(orgId);
  const limits = getLimits(tier);
  const currentCount = await countOrgMembers(orgId);

  if (currentCount >= limits.maxUsers) {
    return {
      status: "error",
      message: `Mitglieder-Limit erreicht (${limits.maxUsers}/${limits.maxUsers}). Bitte auf Pro upgraden.`,
    };
  }

  // Prüfen ob Nutzer bereits Mitglied ist
  const existing = await sql<{ id: string }[]>`
    SELECT u.id FROM users u
    INNER JOIN org_members m ON m.user_id = u.id
    WHERE u.email = ${email} AND m.organization_id = ${orgId}
    LIMIT 1
  `;
  if (existing.length > 0) {
    return { status: "error", message: "Diese E-Mail ist bereits Mitglied des Arbeitsbereichs." };
  }

  // Supabase Invite senden
  const supabaseAdmin = createSupabaseAdminClient();
  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: {
      invited_org_id: orgId,
      invited_role: invitedRole,
    },
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/auth/callback?next=/`,
  });

  if (error) {
    console.error("[inviteMemberAction]", error);
    return { status: "error", message: `Einladung fehlgeschlagen: ${error.message}` };
  }

  revalidatePath("/konto");
  return {
    status: "success",
    message: `Einladung an ${email} gesendet.`,
  };
}

// ── Remove ────────────────────────────────────────────────────────────────────

export async function removeMemberAction(
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const auth = await getCurrentAuth();
  if (!auth?.user || !auth?.organization) {
    return { status: "error", message: "Nicht eingeloggt." };
  }

  const orgId = auth.organization.id;
  const callerId = auth.user.id;
  const targetUserId = formData.get("userId") as string | null;

  if (!targetUserId) return { status: "error", message: "Kein Nutzer angegeben." };
  if (targetUserId === callerId)
    return { status: "error", message: "Du kannst dich nicht selbst entfernen." };

  try {
    const callerRole = await assertOwnerOrAdmin(orgId, callerId);

    // Zielrolle prüfen
    const targetRows = await sql<{ role: string }[]>`
      SELECT role FROM org_members WHERE organization_id = ${orgId} AND user_id = ${targetUserId} LIMIT 1
    `;
    const targetRole = targetRows[0]?.role;
    if (!targetRole) return { status: "error", message: "Mitglied nicht gefunden." };

    // Admins dürfen keine Owners entfernen
    if (callerRole === "admin" && targetRole === "owner") {
      return { status: "error", message: "Bearbeiter können keine Inhaber entfernen." };
    }
    // Owner kann nicht sich selbst entfernen (bereits geprüft) und nicht den letzten Owner
    if (targetRole === "owner") {
      const ownerCount = await sql<{ count: string }[]>`
        SELECT COUNT(*) AS count FROM org_members WHERE organization_id = ${orgId} AND role = 'owner'
      `;
      if (Number(ownerCount[0]?.count ?? 0) <= 1) {
        return { status: "error", message: "Der letzte Inhaber kann nicht entfernt werden." };
      }
    }

    await sql`
      DELETE FROM org_members WHERE organization_id = ${orgId} AND user_id = ${targetUserId}
    `;
  } catch (e) {
    return { status: "error", message: (e as Error).message };
  }

  revalidatePath("/konto");
  return { status: "success", message: "Mitglied entfernt." };
}

// ── Change Role ───────────────────────────────────────────────────────────────

export async function changeMemberRoleAction(
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const auth = await getCurrentAuth();
  if (!auth?.user || !auth?.organization) {
    return { status: "error", message: "Nicht eingeloggt." };
  }

  const orgId = auth.organization.id;
  const callerId = auth.user.id;
  const targetUserId = formData.get("userId") as string | null;
  const newRole = formData.get("role") as string | null;

  if (!targetUserId || !newRole) return { status: "error", message: "Fehlende Parameter." };

  const validRoles = ["owner", "admin", "member"] as const;
  if (!validRoles.includes(newRole as "owner" | "admin" | "member")) {
    return { status: "error", message: "Ungültige Rolle." };
  }

  try {
    const callerRole = await assertOwnerOrAdmin(orgId, callerId);
    if (callerRole !== "owner") {
      return { status: "error", message: "Nur Inhaber können Rollen ändern." };
    }

    await sql`
      UPDATE org_members SET role = ${newRole}
      WHERE organization_id = ${orgId} AND user_id = ${targetUserId}
    `;
  } catch (e) {
    return { status: "error", message: (e as Error).message };
  }

  revalidatePath("/konto");
  return { status: "success", message: "Rolle aktualisiert." };
}

// ── Revoke Invitation ─────────────────────────────────────────────────────────

/**
 * Zieht eine offene Einladung zurück, indem der unbestätigte Supabase-Auth-User
 * gelöscht wird. Da er noch kein org_member ist, gibt es keine Seiteneffekte.
 */
export async function revokeInvitationAction(
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const auth = await getCurrentAuth();
  if (!auth?.user || !auth?.organization) {
    return { status: "error", message: "Nicht eingeloggt." };
  }

  const orgId = auth.organization.id;
  const callerId = auth.user.id;
  const targetUserId = formData.get("userId") as string | null;

  if (!targetUserId) return { status: "error", message: "Kein Nutzer angegeben." };

  try {
    await assertOwnerOrAdmin(orgId, callerId);
  } catch (e) {
    return { status: "error", message: (e as Error).message };
  }

  const supabaseAdmin = createSupabaseAdminClient();
  const { error } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);

  if (error) {
    console.error("[revokeInvitationAction]", error);
    return {
      status: "error",
      message: `Einladung konnte nicht zurückgezogen werden: ${error.message}`,
    };
  }

  revalidatePath("/konto");
  return { status: "success", message: "Einladung zurückgezogen." };
}

// ── Avatar Upload ─────────────────────────────────────────────────────────────

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function uploadAvatarAction(
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const auth = await getCurrentAuth();
  if (!auth) return { status: "error", message: "Nicht angemeldet." };

  const file = formData.get("avatar") as File | null;
  if (!file || file.size === 0) return { status: "error", message: "Kein Bild ausgewählt." };
  if (file.size > MAX_AVATAR_BYTES)
    return { status: "error", message: "Bild zu groß (max. 2 MB)." };
  if (!ALLOWED_TYPES.includes(file.type))
    return { status: "error", message: "Nur JPG, PNG, WebP oder GIF erlaubt." };

  const ext =
    file.type === "image/jpeg"
      ? "jpg"
      : file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : "gif";
  const key = `${auth.user.id}/avatar.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.storage.from("avatars").upload(key, buffer, {
    contentType: file.type,
    upsert: true,
  });
  if (error) {
    console.error("[uploadAvatarAction] storage error:", error);
    return { status: "error", message: "Upload fehlgeschlagen." };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("avatars").getPublicUrl(key);
  await updateUserAvatar(auth.user.id, publicUrl);

  revalidatePath("/konto");
  revalidatePath("/");
  return { status: "success", message: "Profilbild gespeichert." };
}

// ── Wöchentliche Zusammenfassung ─────────────────────────────────────────────

export async function updateNotifyWeeklyAction(
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const auth = await getCurrentAuth();
  if (!auth?.user) return { status: "error", message: "Nicht angemeldet." };

  const enabled = formData.get("notifyWeekly") === "true";

  await sql`
    UPDATE users SET notify_weekly = ${enabled}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${auth.user.id}
  `;

  revalidatePath("/konto");
  return {
    status: "success",
    message: enabled
      ? "Wöchentliche Zusammenfassung aktiviert."
      : "Wöchentliche Zusammenfassung deaktiviert.",
  };
}

// idle is intentionally not exported — "use server" files may only export async functions.
