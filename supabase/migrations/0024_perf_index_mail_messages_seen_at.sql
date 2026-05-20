-- Performance-Index für die Retention-Cron auf `mail_messages`.
--
-- src/lib/automation/retention.ts DELETE-t Zeilen, deren seen_at älter ist als
-- `RETENTION_MAIL_METADATA_MONTHS` (Default 12). Bisher gab es keinen Index auf
-- seen_at, also musste der Cron jedes Mal die komplette mail_messages-Tabelle
-- scannen. Bei wachsendem Mandantenbestand wäre das ein wiederkehrender
-- Lock/I/O-Hotspot (siehe Audit-Plan, Stream C-Indexe).
--
-- Partial-Index: nur Zeilen mit seen_at IS NOT NULL — die anderen filtert die
-- WHERE-Klausel ohnehin aus, und so bleibt der Index klein.
-- CONCURRENTLY damit der Build keinen Schreib-Lock auf Prod erzeugt.
--
-- Indexe für `(mail_account_id, mailbox, uidvalidity, uid)` (mail_messages-Upsert)
-- und `invoice_files (organization_id)` (bulk-cleanup) existieren bereits:
--   • mail_messages: UNIQUE-Constraint in 0001_initial_schema.sql liefert
--     automatisch einen B-Tree-Backing-Index.
--   • invoice_files: 0019_multitenant_isolation.sql legt `idx_invoice_files_org`
--     an.
-- Dieser Sweep deckt also nur den verbleibenden Hotspot ab.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_messages_seen_at
  ON mail_messages (seen_at)
  WHERE seen_at IS NOT NULL;
