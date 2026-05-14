import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Refresht die Supabase-Session in der Middleware.
 * Muss in jeder Request-Runde laufen, damit das JWT nicht abläuft.
 *
 * Gibt zurück:
 * - `response`: die modifizierte Response mit aktualisierten Session-Cookies
 * - `userId`: die Supabase-User-ID, falls eingeloggt (sonst null)
 */
export async function updateSupabaseSession(
  request: NextRequest,
): Promise<{ response: NextResponse; userId: string | null }> {
  // Mutable response — wird ggf. mit neuen Cookie-Werten überschrieben
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Erst in den Request schreiben (für nachgelagerte Middleware)
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          // Dann neue Response mit aktualisierten Cookies erstellen
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() validiert das JWT serverseitig und refresht bei Bedarf
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, userId: user?.id ?? null };
}
