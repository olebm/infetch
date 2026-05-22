import { afterEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";

// Sichert zu, dass alle triggered_by-Werte, die der Code in sync_runs schreibt,
// von der DB-CHECK ('user' | 'schedule' | 'system') erlaubt sind — und
// dokumentiert, dass ungültige Werte (z. B. 'cron', die 9554466-Regression)
// abgelehnt werden. Fängt künftige Code↔Constraint-Drift (INFETCH-222-Klasse),
// bevor sie einen Scan-/Job-Lauf zum Absturz bringt.

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("db constraints — sync_runs.triggered_by", () => {
  const created: number[] = [];

  afterEach(async () => {
    if (created.length) {
      await sql`DELETE FROM sync_runs WHERE id = ANY(${created})`;
      created.length = 0;
    }
  });

  it("accepts every triggered_by value the code writes ('user', 'schedule')", async () => {
    for (const tb of ["user", "schedule"]) {
      const rows = await sql<{ id: number }[]>`
        INSERT INTO sync_runs (type, status, triggered_by, started_at)
        VALUES ('imap_scan', 'running', ${tb}, CURRENT_TIMESTAMP)
        RETURNING id
      `;
      expect(rows[0]?.id).toBeTruthy();
      created.push(Number(rows[0].id));
    }
  });

  it("rejects an out-of-constraint value ('cron' — the 9554466 regression)", async () => {
    await expect(
      sql`INSERT INTO sync_runs (type, status, triggered_by, started_at) VALUES ('imap_scan', 'running', 'cron', CURRENT_TIMESTAMP)`,
    ).rejects.toThrow();
  });
});
