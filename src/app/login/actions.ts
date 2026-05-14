"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, deleteSession } from "@/lib/auth/session";
import { createUserWithDefaultOrg, findUserByEmail } from "@/lib/auth/users";
import { SESSION_COOKIE_NAME, getSessionId } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";

const STUB_EMAIL = "test@infetch.local";
const STUB_NAME = "Test User";

function sanitizeNext(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function loginAsTestUser(formData: FormData) {
  // SECURITY: Test-Login darf niemals in Production erreichbar sein.
  // Der UI-Guard in page.tsx reicht nicht — Server Actions sind direkte POST-Endpunkte.
  if ((process.env.NODE_ENV as string) === "production") {
    throw new Error("loginAsTestUser is not available in production");
  }

  const next = sanitizeNext(formData.get("next"));
  const db = getDb();

  let user = findUserByEmail(STUB_EMAIL, db);
  let organizationId: string | null = null;

  if (!user) {
    const created = createUserWithDefaultOrg({
      email: STUB_EMAIL,
      name: STUB_NAME,
      db,
    });
    user = created.user;
    organizationId = created.organization.id;
  } else {
    const row = db
      .prepare(
        `SELECT organization_id AS organizationId
         FROM org_members
         WHERE user_id = ?
         ORDER BY created_at
         LIMIT 1`,
      )
      .get(user.id) as { organizationId: string } | undefined;
    organizationId = row?.organizationId ?? null;
  }

  const session = createSession(user.id, {
    db,
    activeOrganizationId: organizationId,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.NODE_ENV as string) === "production",
    path: "/",
    expires: new Date(session.expiresAt),
  });

  redirect(next);
}

export async function logout() {
  const sessionId = await getSessionId();
  if (sessionId) {
    deleteSession(sessionId);
  }
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}
