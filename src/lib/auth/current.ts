import { cookies } from "next/headers";
import { loadOrganization, loadSession, loadUser, type OrganizationRow, type SessionRow, type UserRow } from "@/lib/auth/session";

export const SESSION_COOKIE_NAME = "ia_session";

export type CurrentAuth = {
  session: SessionRow;
  user: UserRow;
  organization: OrganizationRow | null;
};

export async function getSessionId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function getCurrentAuth(): Promise<CurrentAuth | null> {
  const sessionId = await getSessionId();
  if (!sessionId) return null;

  const session = loadSession(sessionId);
  if (!session) return null;

  const user = loadUser(session.userId);
  if (!user) return null;

  const organization = session.activeOrganizationId
    ? loadOrganization(session.activeOrganizationId)
    : null;

  return { session, user, organization };
}

export async function requireCurrentAuth(): Promise<CurrentAuth> {
  const auth = await getCurrentAuth();
  if (!auth) {
    throw new Error("Not authenticated");
  }
  return auth;
}
