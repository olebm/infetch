-- ─────────────────────────────────────────────────────────────────────────────
-- 0029_mail_accounts_cleanup_null_org.sql
--
-- Bereinigt null-org mail_accounts-Altlasten aus der Pre-Multi-Tenant-Zeit
-- (INFETCH-204).
--
-- Kontext: Der org-scoped Onboarding-Scan (runPrimaryImapScan limitToOrgId)
-- warf "Kein konfiguriertes IMAP-Postfach vorhanden", weil
-- listConfiguredImapAccounts eine alte organization_id=NULL-Row statt der
-- org-spezifischen pickte (rows.find über ORDER BY id ASC). Hotfix 11127ac
-- filtert org jetzt auf DB-Ebene, und completeOnboardingAction "claimt" eine
-- null-org-Row (UPDATE) statt ein Duplikat anzulegen. Diese Migration räumt
-- die BESTANDS-Duplikate weg.
--
-- Strategie (konservativ, idempotent, FK-sicher):
--   Eine null-org-Row, für die bereits eine org-scoped Row mit gleichem Label
--   existiert, ist ein totes Duplikat. Sie wird NICHT gelöscht (mail_messages
--   referenzieren mail_account_id ohne ON DELETE CASCADE → DELETE würde
--   scheitern bzw. Scan-Historie vernichten), sondern auf status='disabled'
--   gesetzt. listConfiguredImapAccounts filtert status='configured' → die
--   Row verschwindet aus jedem Scan, Historie bleibt erhalten.
--
--   Echte Waisen (aktive null-org-Row OHNE org-Pendant) bleiben unangetastet:
--   sie sind das einzige Postfach des Nutzers und werden beim nächsten
--   Onboarding von completeOnboardingAction der Org zugeordnet. Daten nie
--   blind anfassen — nur per RAISE NOTICE sichtbar machen.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE mail_accounts AS m_null
SET status = 'disabled', updated_at = NOW()::TEXT
WHERE m_null.organization_id IS NULL
  AND m_null.status = 'configured'
  AND EXISTS (
    SELECT 1 FROM mail_accounts m_org
    WHERE m_org.organization_id IS NOT NULL
      AND m_org.label = m_null.label
  );

-- Verbleibende echte Waisen melden (kein Abbruch — reine Sichtbarkeit).
DO $$
DECLARE orphan_count int;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM mail_accounts m_null
  WHERE m_null.organization_id IS NULL
    AND m_null.status = 'configured'
    AND NOT EXISTS (
      SELECT 1 FROM mail_accounts m_org
      WHERE m_org.organization_id IS NOT NULL
        AND m_org.label = m_null.label
    );
  IF orphan_count > 0 THEN
    RAISE NOTICE
      'mail_accounts: % aktive null-org Row(s) ohne org-Pendant. Werden beim '
      'nächsten Onboarding (completeOnboardingAction) der Org zugeordnet — '
      'kein Handlungsbedarf, nur zur Kenntnis.', orphan_count;
  END IF;
END $$;
