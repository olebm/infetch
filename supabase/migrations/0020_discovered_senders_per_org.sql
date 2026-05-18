-- ─────────────────────────────────────────────────────────────────────────────
-- 0020_discovered_senders_per_org.sql
--
-- SECURITY (Multi-Tenancy, Fortsetzung von 0019):
-- discovered_senders war single-tenant — from_address GLOBAL UNIQUE. Folgen
-- in einer Mehr-Mandanten-DB:
--   • Absender-Cache (mail_count, pdf_count, …) über alle Orgs geteilt.
--   • Block-Status global: Org A blockt einen Absender → Org B's Scan
--     überspringt denselben Absender ebenfalls.
--   • matched_vendor_id global statt pro Org.
--
-- In 0019 bewusst zurückgestellt, weil die Writer (Mail-Scanner,
-- backfillFromMailMessages, autoAssignSenders, senders/actions) noch nicht
-- org-aware waren. Diese Migration läuft GEMEINSAM mit dem zugehörigen
-- Code-Refactor (recordSenderObservation/isSenderBlocked/… nehmen jetzt
-- organizationId; Crons iterieren pro Org).
--
-- Pre-Prod-Annahme (konsistent zu 0011/0013/0019): discovered_senders ist
-- reiner Scan-Cache. Nicht zuordenbare Rows werden geleert — sie werden beim
-- nächsten IMAP-Scan pro Org neu entdeckt. ACHTUNG: ein zuvor gesetzter
-- Block-Status nicht zuordenbarer Rows geht dabei verloren und muss pro Org
-- neu gesetzt werden.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE discovered_senders
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE;

-- Soweit möglich über den gematchten (org-spezifischen) Vendor ableiten.
UPDATE discovered_senders ds
SET organization_id = v.organization_id
FROM vendors v
WHERE v.id = ds.matched_vendor_id
  AND ds.organization_id IS NULL
  AND v.organization_id IS NOT NULL;

-- Rest ist reiner Scan-Cache (inkl. Block-Status) → verwerfen, wird beim
-- nächsten Scan pro Org neu entdeckt.
DELETE FROM discovered_senders WHERE organization_id IS NULL;

ALTER TABLE discovered_senders
  DROP CONSTRAINT IF EXISTS discovered_senders_from_address_key;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_discovered_senders_org_addr
  ON discovered_senders (organization_id, from_address);
CREATE INDEX IF NOT EXISTS idx_discovered_senders_org
  ON discovered_senders (organization_id);

-- 0010 hatte RLS aktiviert aber KEINE Policy (System-Tabelle). Jetzt org-scoped.
DROP POLICY IF EXISTS discovered_senders_org ON discovered_senders;
CREATE POLICY discovered_senders_org ON discovered_senders
  FOR ALL USING (
    organization_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.user_id = auth.uid()::TEXT
        AND org_members.organization_id = discovered_senders.organization_id
    )
  );
