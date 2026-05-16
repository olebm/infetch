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
  var __pgSql: postgres.Sql | undefined;
}

function createClient(): postgres.Sql {
  const url = process.env.DATABASE_URL;

  if (!url || url.startsWith("./") || url.endsWith(".db")) {
    // During `next build` or in Vitest: return a no-op client whose first query
    // will fail with a connection error. This lets modules be imported without
    // DATABASE_URL — build never queries, and integration tests without DB fail
    // at query-time (individual test failure) rather than at module-load time
    // (which would crash the entire test file before any test can run).
    if (
      process.env.NEXT_PHASE === "phase-production-build" ||
      process.env.VITEST !== undefined
    ) {
      return postgres("postgresql://localhost/build", { prepare: false });
    }
    throw new Error(
      "DATABASE_URL must be a PostgreSQL connection string. " +
        "Set it in .env.local:\n" +
        "  DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
    );
  }

  return postgres(url, {
    // Supabase Pooler (Transaction Mode): prepared statements not supported.
    prepare: false,
    // Resilienz: ohne diese Werte hängen Queries bei Pooler-Ausfall
    // unbegrenzt und der Default-Pool (10) kann ohne Backpressure
    // erschöpfen. Bei DB-Störung lieber schnell fehlschlagen.
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idle_timeout: 30, // Sek.: ungenutzte Verbindungen schließen
    connect_timeout: 10, // Sek.: schneller Fehler statt Hänger
    max_lifetime: 60 * 30, // Sek.: Verbindungen periodisch erneuern
    // BIGINT (OID 20) values (BIGSERIAL IDs) are returned as strings by default
    // to avoid precision loss for very large numbers. For this app's ID space
    // (<= 2^53) returning them as JS numbers is safe and avoids type assertion
    // noise throughout the codebase.
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (v: number | bigint | string) => String(v),
        parse: (v: string) => Number(v),
      },
    },
  });
}

export const sql: postgres.Sql =
  globalThis.__pgSql ?? (globalThis.__pgSql = createClient());

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
