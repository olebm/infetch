import { afterEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";

/**
 * Sichert die Delete-Reihenfolge von deleteImapAccountAction: die Scan-Historie
 * (mail_messages) muss VOR dem mail_accounts-Slot entfernt werden, weil
 * mail_messages.mail_account_id ein NOT-NULL-FK ist. Ein direkter
 * mail_accounts-Delete scheitert sonst am Constraint. Genau diese Reihenfolge
 * hält die Action ein — importierte Rechnungen bleiben davon unberührt, weil
 * invoices keine FK auf mail_messages haben.
 */
describe("Empfangs-Postfach entfernen (FK-Reihenfolge)", () => {
  const label = "Secondary IMAP FKTest";

  afterEach(async () => {
    await sql`DELETE FROM mail_messages WHERE mail_account_id IN (
      SELECT id FROM mail_accounts WHERE label = ${label}
    )`;
    await sql`DELETE FROM mail_accounts WHERE label = ${label}`;
  });

  it("mail_accounts-Delete scheitert mit Scan-Historie; die Reihenfolge löst es", async () => {
    const [acct] = await sql<{ id: number }[]>`
      INSERT INTO mail_accounts (label, host, port, secure, username, status)
      VALUES (${label}, 'imap.fk.test', 993, true, 'fk-test@example.com', 'configured')
      RETURNING id
    `;
    await sql`
      INSERT INTO mail_messages (mail_account_id, mailbox, uid, uidvalidity)
      VALUES (${acct.id}, 'INBOX', 1, '1')
    `;

    // Direkter Slot-Delete scheitert — mail_messages verweist noch (FK).
    await expect(sql`DELETE FROM mail_accounts WHERE id = ${acct.id}`).rejects.toThrow();

    // Reihenfolge wie in deleteImapAccountAction: erst Historie, dann Slot.
    await sql`DELETE FROM mail_messages WHERE mail_account_id = ${acct.id}`;
    await sql`DELETE FROM mail_accounts WHERE id = ${acct.id}`;

    const [row] = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM mail_accounts WHERE id = ${acct.id}
    `;
    expect(Number(row.count)).toBe(0);
  });
});
