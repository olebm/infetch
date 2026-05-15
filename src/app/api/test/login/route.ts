import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { findUserByEmail, createUserWithDefaultOrg } from "@/lib/auth/users";

const STUB_EMAIL = "test@infetch.local";
const STUB_NAME = "Test User";

/**
 * POST /api/test/login
 * Programmatischer Test-Login für Playwright-Setup wenn kein Test-Login-Button vorhanden.
 * Nur aktiv wenn ENABLE_TEST_LOGIN=true und nicht in production.
 */
export async function POST(_req: NextRequest) {
  if (process.env.ENABLE_TEST_LOGIN !== "true" || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not enabled" }, { status: 403 });
  }

  const supabaseAdmin = createSupabaseAdminClient();

  let supabaseUserId: string | undefined;
  const { data: createData } = await supabaseAdmin.auth.admin.createUser({
    email: STUB_EMAIL,
    email_confirm: true,
    user_metadata: { full_name: STUB_NAME },
  });

  if (createData?.user?.id) {
    supabaseUserId = createData.user.id;
  } else {
    const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const found = (listData?.users ?? []).find(
      (u: { email?: string; id: string }) => u.email === STUB_EMAIL,
    );
    supabaseUserId = found?.id;
  }

  if (!supabaseUserId) {
    return NextResponse.json({ error: "Supabase user not found" }, { status: 500 });
  }

  try {
    const existing = await findUserByEmail(STUB_EMAIL);
    if (!existing) {
      await createUserWithDefaultOrg({ email: STUB_EMAIL, name: STUB_NAME, userId: supabaseUserId });
    }
  } catch {
    // Non-fatal
  }

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: STUB_EMAIL,
    options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/` },
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    return NextResponse.json({ error: linkError?.message ?? "no link" }, { status: 500 });
  }

  const supabase = await createSupabaseServerClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });

  if (verifyError) {
    return NextResponse.json({ error: verifyError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
