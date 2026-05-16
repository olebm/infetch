import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import { runRetention } from "@/lib/automation/retention";

const hasDb = Boolean(process.env.DATABASE_URL);
const SUFFIX = `${Date.now()}`;
const ACCT_USER = `retention-${SUFFIX}@iso.local`;

let acctId = 0;

async function cleanup() {
  await sql`DELETE FROM mail_messages WHERE mail_account_id = ${acctId}`;
  await sql`DELETE FROM mail_accounts WHERE username = ${ACCT_USER}`;
}

describe.skipIf(!hasDb)("retention — mail metadata purge", () => {
  beforeEach(async () => {
    const [acct] = await sql<{ id: number }[]>`
      INSERT INTO mail_accounts (label, host, port, secure, username, status)
      VALUES ('Retention Test', 'imap.test', 993, true, ${ACCT_USER}, 'configured')
      RETURNING id
    `;
    acctId = acct.id;
    await cleanup();
    // erneut anlegen (cleanup hat acct gelöscht)
    const [acct2] = await sql<{ id: number }[]>`
      INSERT INTO mail_accounts (label, host, port, secure, username, status)
      VALUES ('Retention Test', 'imap.test', 993, true, ${ACCT_USER}, 'configured')
      RETURNING id
    `;
    acctId = acct2.id;

    await sql`
      INSERT INTO mail_messages (mail_account_id, mailbox, uid, uidvalidity, from_address, subject, seen_at, status)
      VALUES
        (${acctId}, 'INBOX', 1, 'v1', 'old@example.com', 'Old private mail',
         (NOW() - INTERVAL '13 months')::text, 'no_pdf'),
        (${acctId}, 'INBOX', 2, 'v1', 'recent@example.com', 'Recent mail',
         (NOW() - INTERVAL '1 month')::text, 'no_pdf')
    `;
  });
  afterEach(cleanup);

  it("deletes metadata older than the retention window but keeps recent rows", async () => {
    const result = await runRetention();
    expect(result.cutoffMonths).toBe(12);
    expect(result.deletedMailMessages).toBeGreaterThanOrEqual(1);

    const remaining = await sql<{ subject: string }[]>`
      SELECT subject FROM mail_messages WHERE mail_account_id = ${acctId}
    `;
    const subjects = remaining.map((r) => r.subject);
    expect(subjects).toContain("Recent mail");
    expect(subjects).not.toContain("Old private mail");
  });
});
