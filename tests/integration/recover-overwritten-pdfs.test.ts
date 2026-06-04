import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import {
  recoverOverwrittenPdfs,
  pickAttachmentForSha,
  sha256Hex,
  type MailCoord,
} from "@/lib/automation/recover-overwritten-pdfs";
import type { ParsedMailPdfAttachment } from "@/mail/attachment-extractor";

const hasDb = Boolean(process.env.DATABASE_URL);
const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ORG = `org-rec-${SUFFIX}`;
const USER = `user-rec-${SUFFIX}`;
const SHARED_PATH = `${ORG}/2026/2026-06/unknown-vendor/unknown-vendor_unknown-product_2026-06-02.pdf`;

const contentSurvivor = Buffer.from("%PDF-1.7 survivor (zuletzt hochgeladen)");
const contentOriginal = Buffer.from("%PDF-1.7 original des überschriebenen Belegs");
const shaSurvivor = sha256Hex(contentSurvivor);
const shaOriginal = sha256Hex(contentOriginal);

let survivorFileId = 0;
let overwrittenFileId = 0;
const OVERWRITTEN_UID = 102;

async function seed() {
  await sql`INSERT INTO users (id, email, name) VALUES (${USER}, ${`${USER}@rec.local`}, 'Rec') ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO organizations (id, name, slug, tier, owner_user_id) VALUES (${ORG}, ${ORG}, ${ORG}, 'pro', ${USER}) ON CONFLICT DO NOTHING`;
  // `secure` weggelassen: Spalte ist in Prod INTEGER, lokal BOOLEAN (Env-Drift)
  // → Default greift; die injizierte Fetch-Dep nutzt `secure` ohnehin nicht.
  const [acct] = await sql<{ id: number }[]>`
    INSERT INTO mail_accounts (label, host, port, username, status, organization_id)
    VALUES ('Primary IMAP', 'imap.test', 993, 'rec@test', 'configured', ${ORG}) RETURNING id`;

  const mk = async (sha: string, uid: number) => {
    const [msg] = await sql<{ id: number }[]>`
      INSERT INTO mail_messages (mail_account_id, mailbox, uid, uidvalidity, seen_at, status)
      VALUES (${acct.id}, 'INBOX', ${uid}, '100', CURRENT_TIMESTAMP, 'processed') RETURNING id`;
    const [inv] = await sql<{ id: number }[]>`
      INSERT INTO invoices (organization_id, source, status, confidence, dedupe_key, invoice_date)
      VALUES (${ORG}, 'mail', 'exported', 0.9, ${`rec-${sha.slice(0, 12)}-${SUFFIX}`}, '2026-06-02') RETURNING id`;
    const [file] = await sql<{ id: number }[]>`
      INSERT INTO invoice_files (invoice_id, organization_id, original_filename, stored_path, sha256, size_bytes, mime_type, source_type, source_ref_id)
      VALUES (${inv.id}, ${ORG}, 'invoice.pdf', ${SHARED_PATH}, ${sha}, 100, 'application/pdf', 'mail', ${String(msg.id)}) RETURNING id`;
    return file.id;
  };
  survivorFileId = await mk(shaSurvivor, 101);
  overwrittenFileId = await mk(shaOriginal, OVERWRITTEN_UID);
}

async function cleanup() {
  await sql`DELETE FROM invoice_files WHERE organization_id = ${ORG}`;
  await sql`DELETE FROM mail_messages WHERE mail_account_id IN (SELECT id FROM mail_accounts WHERE organization_id = ${ORG})`;
  await sql`DELETE FROM invoices WHERE organization_id = ${ORG}`;
  await sql`DELETE FROM mail_accounts WHERE organization_id = ${ORG}`;
  await sql`DELETE FROM organizations WHERE id = ${ORG}`;
  await sql`DELETE FROM users WHERE id = ${USER}`;
}

// Injizierte Deps: Storage hält den Überlebenden-Inhalt; IMAP liefert für die
// überschriebene Datei das KORREKTE Original-Attachment.
const stored: Array<{ key: string; content: Buffer }> = [];
const deps = () => {
  stored.length = 0;
  return {
    downloadObject: async () => contentSurvivor,
    fetchAttachmentsByUid: async (
      _account: unknown,
      _coords: MailCoord[],
    ): Promise<Map<number, ParsedMailPdfAttachment[]>> =>
      new Map([
        [
          OVERWRITTEN_UID,
          [{ filename: "invoice.pdf", contentType: "application/pdf", content: contentOriginal }],
        ],
      ]),
    storePdf: async (key: string, content: Buffer) => {
      stored.push({ key, content });
    },
  };
};

describe("pickAttachmentForSha", () => {
  it("findet das Attachment mit passendem sha256", () => {
    const atts = [
      { filename: "a.pdf", contentType: "application/pdf", content: Buffer.from("falsch") },
      { filename: "b.pdf", contentType: "application/pdf", content: contentOriginal },
    ];
    expect(pickAttachmentForSha(atts, shaOriginal)?.content).toBe(contentOriginal);
    expect(pickAttachmentForSha(atts, "deadbeef")).toBeNull();
  });
});

describe.skipIf(!hasDb)("recoverOverwrittenPdfs", () => {
  beforeEach(async () => {
    await cleanup();
    await seed();
  });
  afterEach(cleanup);

  it("dry-run: klassifiziert Überlebenden vs. überschrieben, ohne zu schreiben", async () => {
    const r = await recoverOverwrittenPdfs({ dryRun: true, organizationId: ORG, deps: deps() });

    expect(r.details.find((d) => d.fileId === survivorFileId)?.outcome).toBe("not_overwritten");
    expect(r.details.find((d) => d.fileId === overwrittenFileId)?.outcome).toBe("would_recover");
    expect(stored.length).toBe(0);

    const [row] = await sql<{ storedPath: string }[]>`
      SELECT stored_path AS "storedPath" FROM invoice_files WHERE id = ${overwrittenFileId}`;
    expect(row.storedPath).toBe(SHARED_PATH); // unverändert
  });

  it("execute: legt das Original neu ab (eindeutiger Key) und aktualisiert stored_path", async () => {
    const r = await recoverOverwrittenPdfs({ dryRun: false, organizationId: ORG, deps: deps() });

    expect(r.details.find((d) => d.fileId === overwrittenFileId)?.outcome).toBe("recovered");
    expect(stored.length).toBe(1);
    expect(stored[0].content).toBe(contentOriginal);
    expect(stored[0].key).toContain(shaOriginal);
    expect(stored[0].key).not.toBe(SHARED_PATH);

    const [row] = await sql<{ storedPath: string }[]>`
      SELECT stored_path AS "storedPath" FROM invoice_files WHERE id = ${overwrittenFileId}`;
    expect(row.storedPath).toBe(stored[0].key); // stored_path zeigt jetzt auf den neuen, eindeutigen Key
    expect(row.storedPath).toContain(shaOriginal);
  });
});
