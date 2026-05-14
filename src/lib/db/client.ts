import postgres from "postgres";

/**
 * Supabase Postgres client (porsager/postgres).
 * Wird als Singleton gehalten — safe in Next.js Server Actions / Route Handlers.
 *
 * DATABASE_URL Format:
 *   postgresql://postgres.[project-ref]:[password]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
 *
 * Im Dev-Betrieb: DIRECT_URL für Migrationen (keine Session-Multiplexing-Einschränkungen).
 * Im Prod-Betrieb: Pooler-URL (Transaction Mode) für maximale Parallelität.
 */

// Prevent multiple connections in Next.js hot-reload (dev mode)
declare global {
  // eslint-disable-next-line no-var
  var __pgSql: postgres.Sql | undefined;
}

function createClient(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url || url.startsWith("./") || url.endsWith(".db")) {
    throw new Error(
      "DATABASE_URL must be a PostgreSQL connection string. " +
        "Set it in .env.local:\n" +
        "  DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
    );
  }
  return postgres(url, {
    // Supabase Pooler (Transaction Mode): max 1 concurrent query per connection
    // — prepared statements not supported in transaction mode
    prepare: false,
    // Transform snake_case column names to camelCase
    // Disabled — queries use explicit AS aliases instead
    // transform: postgres.camel,
  });
}

// Lazy singleton — only connects on first query.
// This allows `next build` to succeed without DATABASE_URL (all routes are
// force-dynamic and don't execute DB queries at build time).
function getOrCreateSql(): postgres.Sql {
  return globalThis.__pgSql ?? (globalThis.__pgSql = createClient());
}

export const sql: postgres.Sql = new Proxy({} as postgres.Sql, {
  get(_t, prop) {
    return Reflect.get(getOrCreateSql(), prop, getOrCreateSql());
  },
  apply(_t, _thisArg, args) {
    return Reflect.apply(getOrCreateSql() as unknown as (...a: unknown[]) => unknown, getOrCreateSql(), args);
  },
});

/**
 * @deprecated Verwende `sql` direkt. Diese Funktion existiert nur für die
 * schrittweise Migration der legacy-Dateien (Phase 2).
 *
 * Da `sql` kein better-sqlite3-Database-Objekt ist, gibt diese Funktion
 * den sql-Client zurück — alle Aufrufer müssen auf async/await umgestellt werden.
 */
export function getDb(): postgres.Sql {
  return sql;
}
