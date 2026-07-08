-- ════════════════════════════════════════════════════════════════════════════
--  Infetch · Extraktions-Genauigkeit & Confidence-Kalibrierung  (READ-ONLY)
-- ════════════════════════════════════════════════════════════════════════════
--
--  ZWECK   Dogfooding-Auswertung des eigenen Prod-Kontos. Misst, ob die KI-
--          Extraktion stimmt (Hebel 1) und ob die Confidence ehrlich ist
--          (Hebel 2) — anhand des eingebauten Ground Truth: KI-Rohwert
--          (ai_extractions.output_json) vs. finaler Wert (invoices), plus das
--          invoice_review_updated-Event als "Mensch hat die Rechnung berührt"-Label.
--
--  SICHER  Nur SELECT. Keine Schreiboperation. Keine PII in der Ausgabe —
--          ausschliesslich Counts, Quoten, Buckets. Keine Vendor-Namen,
--          keine Einzelbetraege.
--
--  FAHREN  Supabase Dashboard → SQL Editor. Jeden der 4 Bloecke EINZELN
--          markieren und "Run" — der Editor zeigt pro Lauf eine Tabelle.
--          Ergebnis-Tabellen zurueck an Claude (sind anonym/aggregiert).
--
--  ORG     ⚠ Platzhalter: ersetze die Null-UUID (00000000-…) in JEDEM Block
--            durch deine eigene organizations.id. So org-gefiltert, kein Cross-Tenant.
--
--  STATUS  Auf lokaler DB (230 echte KI-Extraktionen) verifiziert: laeuft
--          syntaktisch + typ-sauber durch. Auf synthetischen Testdaten war
--          Drift=0 trotz 76 Review-Events → der echte Test ist der Prod-Lauf.
--
--  GRENZEN DER INTERPRETATION (wichtig, ehrlich):
--   • "angefasst" (Review-Event) ≠ "Feld korrigiert" (Drift). Ein Mensch kann
--     eine Rechnung freigeben, ohne ein Feld zu aendern. BLOCK 1 weist beides
--     getrennt aus: drift_gesamt (alle) vs. drift_bei_review (bestaetigte Fehler).
--   • "Drift" (KI-Wert ≠ finaler Wert) ist eine OBERGRENZE fuer KI-Fehler:
--     enthaelt echte Korrekturen, aber auch lokale-Parser-Overrides. Erst der
--     Filter auf review-beruehrte Rechnungen macht Drift zum bestaetigten Fehler.
--   • "glatt durch ohne Review-Event" = SCHWACHES Positiv-Label: nie widersprochen,
--     aber auch nie explizit bestaetigt.
--   • n ist klein (ein Konto). Qualitativ aussagekraeftig, statistisch duenn.
-- ════════════════════════════════════════════════════════════════════════════


-- ═══ BLOCK 0 · Bestandsaufnahme (wie viel Signal ist ueberhaupt da?) ══════════
-- Sagt uns, ob n gross genug fuer Aussagen ist. Ohne das ist alles andere Kaffeesatz.
WITH params AS (
  SELECT '00000000-0000-0000-0000-000000000000'::text AS org
)
SELECT 'invoices gesamt' AS kennzahl, COUNT(*) AS wert
FROM invoices, params WHERE organization_id = params.org
UNION ALL
SELECT 'davon status=exported',      COUNT(*) FROM invoices, params
  WHERE organization_id = params.org AND status = 'exported'
UNION ALL
SELECT 'davon status=needs_review',  COUNT(*) FROM invoices, params
  WHERE organization_id = params.org AND status = 'needs_review'
UNION ALL
SELECT 'davon status=ignored',       COUNT(*) FROM invoices, params
  WHERE organization_id = params.org AND status = 'ignored'
UNION ALL
SELECT 'davon status=duplicate',     COUNT(*) FROM invoices, params
  WHERE organization_id = params.org AND status = 'duplicate'
UNION ALL
SELECT 'mit KI-Extraktion (succeeded)',
  COUNT(DISTINCT ae.invoice_id)
  FROM ai_extractions ae JOIN invoices i ON i.id = ae.invoice_id, params
  WHERE i.organization_id = params.org AND ae.status = 'succeeded' AND ae.output_json IS NOT NULL
UNION ALL
SELECT 'KI uebersprungen (lokal reichte)',
  COUNT(DISTINCT ae.invoice_id)
  FROM ai_extractions ae JOIN invoices i ON i.id = ae.invoice_id, params
  WHERE i.organization_id = params.org AND ae.status = 'skipped'
UNION ALL
SELECT 'je manuell im Review angefasst',
  COUNT(DISTINCT se.invoice_id)
  FROM sync_events se JOIN invoices i ON i.id = se.invoice_id, params
  WHERE i.organization_id = params.org AND se.event_type = 'invoice_review_updated';


-- ═══ BLOCK 1 · Feld-Drift = Genauigkeits-Proxy pro Feld ══════════════════════
-- Pro Kernfeld: bei wie vielen Rechnungen weicht der finale Wert vom KI-Rohwert
-- ab? drift_gesamt = alle mit KI-Extraktion; drift_bei_review = nur review-
-- beruehrte (= bestaetigte KI-Fehler). Betrag mit 0,5-Cent-Toleranz gg. Float.
WITH params AS (
  SELECT '00000000-0000-0000-0000-000000000000'::text AS org
),
latest_ai AS (   -- neueste erfolgreiche KI-Extraktion pro Rechnung, JSON geparst
  SELECT DISTINCT ON (ae.invoice_id) ae.invoice_id, (ae.output_json::jsonb) AS oj
  FROM ai_extractions ae JOIN invoices i ON i.id = ae.invoice_id, params
  WHERE i.organization_id = params.org
    AND ae.status = 'succeeded' AND ae.output_json IS NOT NULL
  ORDER BY ae.invoice_id, ae.created_at DESC
),
reviewed AS (    -- Rechnungen, die der Mensch je im Review angefasst hat
  SELECT DISTINCT se.invoice_id
  FROM sync_events se JOIN invoices i ON i.id = se.invoice_id, params
  WHERE i.organization_id = params.org AND se.event_type = 'invoice_review_updated'
),
drift AS (
  SELECT
    i.id,
    (r.invoice_id IS NOT NULL) AS touched,
    CASE
      WHEN i.amount_gross IS NULL AND (a.oj->>'amount_gross') IS NULL THEN false
      WHEN i.amount_gross IS NULL OR  (a.oj->>'amount_gross') IS NULL THEN true
      ELSE abs(i.amount_gross - (a.oj->>'amount_gross')::real) > 0.005
    END AS amount_drift,
    (i.invoice_date IS DISTINCT FROM (a.oj->>'invoice_date')) AS date_drift,
    (i.currency     IS DISTINCT FROM (a.oj->>'currency'))     AS currency_drift
  FROM invoices i
  JOIN latest_ai a ON a.invoice_id = i.id
  LEFT JOIN reviewed r ON r.invoice_id = i.id
  CROSS JOIN params   -- params getrennt cross-joinen, NICHT per Komma in die JOIN-Kette (bricht i-Scope)
  WHERE i.organization_id = params.org
)
SELECT 'Betrag' AS feld, COUNT(*) AS n_mit_ki,
  SUM(amount_drift::int) AS drift_gesamt,
  SUM((amount_drift AND touched)::int) AS drift_bei_review,
  ROUND(100.0 * SUM(amount_drift::int) / NULLIF(COUNT(*),0), 1) AS drift_pct
FROM drift
UNION ALL SELECT 'Datum', COUNT(*), SUM(date_drift::int), SUM((date_drift AND touched)::int),
  ROUND(100.0 * SUM(date_drift::int) / NULLIF(COUNT(*),0), 1) FROM drift
UNION ALL SELECT 'Waehrung', COUNT(*), SUM(currency_drift::int), SUM((currency_drift AND touched)::int),
  ROUND(100.0 * SUM(currency_drift::int) / NULLIF(COUNT(*),0), 1) FROM drift;


-- ═══ BLOCK 2 · Confidence-Kalibrierung: Outcome pro Confidence-Bucket ═════════
-- invoices.confidence in Baender. Pro Band: wie viele landeten im Review / wurden
-- angefasst / liefen glatt durch? GUTE Kalibrierung: hohe Baender laufen fast
-- immer glatt durch, niedrige landen im Review. Bricht das → Schwelle/Modell falsch.
WITH params AS (
  SELECT '00000000-0000-0000-0000-000000000000'::text AS org
),
reviewed AS (
  SELECT DISTINCT se.invoice_id
  FROM sync_events se JOIN invoices i ON i.id = se.invoice_id, params
  WHERE i.organization_id = params.org AND se.event_type = 'invoice_review_updated'
),
b AS (
  SELECT
    CASE
      WHEN i.confidence IS NULL THEN '0 · keine'
      WHEN i.confidence <  0.75 THEN '1 · <0.75'
      WHEN i.confidence <  0.90 THEN '2 · 0.75–0.90'
      WHEN i.confidence <  0.95 THEN '3 · 0.90–0.95'
      ELSE                           '4 · ≥0.95'
    END AS conf_band,
    (i.status = 'needs_review')        AS is_review,
    (i.status IN ('ready','exported')) AS is_auto,
    (r.invoice_id IS NOT NULL)         AS touched
  FROM invoices i
  LEFT JOIN reviewed r ON r.invoice_id = i.id, params
  WHERE i.organization_id = params.org
    AND i.status NOT IN ('ignored','duplicate')   -- Junk raus
)
SELECT conf_band, COUNT(*) AS n,
  SUM(is_review::int) AS jetzt_review,
  SUM(touched::int) AS manuell_angefasst,
  SUM((is_auto AND NOT touched)::int) AS glatt_durch,
  ROUND(100.0 * SUM(touched::int) / NULLIF(COUNT(*),0), 1) AS angefasst_pct
FROM b GROUP BY conf_band ORDER BY conf_band;


-- ═══ BLOCK 3 · Reliability: ist die KI-SELBSTeinschaetzung ehrlich? ═══════════
-- Die per-Feld-Confidence der KI (amount_confidence) gegen den tatsaechlichen
-- Drift des Betrags. Kernfrage: sagt die KI "≥0.95 sicher beim Betrag" und lag
-- doch daneben? Das ist Overconfidence — der gefaehrlichste Fall, weil auto-approved.
WITH params AS (
  SELECT '00000000-0000-0000-0000-000000000000'::text AS org
),
latest_ai AS (
  SELECT DISTINCT ON (ae.invoice_id) ae.invoice_id, (ae.output_json::jsonb) AS oj
  FROM ai_extractions ae JOIN invoices i ON i.id = ae.invoice_id, params
  WHERE i.organization_id = params.org
    AND ae.status = 'succeeded' AND ae.output_json IS NOT NULL
  ORDER BY ae.invoice_id, ae.created_at DESC
),
amt AS (
  SELECT
    CASE
      WHEN (a.oj->>'amount_confidence') IS NULL THEN '0 · keine'
      WHEN (a.oj->>'amount_confidence')::real < 0.75 THEN '1 · <0.75'
      WHEN (a.oj->>'amount_confidence')::real < 0.90 THEN '2 · 0.75–0.90'
      WHEN (a.oj->>'amount_confidence')::real < 0.95 THEN '3 · 0.90–0.95'
      ELSE '4 · ≥0.95'
    END AS amount_conf_band,
    CASE
      WHEN i.amount_gross IS NULL AND (a.oj->>'amount_gross') IS NULL THEN false
      WHEN i.amount_gross IS NULL OR  (a.oj->>'amount_gross') IS NULL THEN true
      ELSE abs(i.amount_gross - (a.oj->>'amount_gross')::real) > 0.005
    END AS amount_drift
  FROM invoices i
  JOIN latest_ai a ON a.invoice_id = i.id, params
  WHERE i.organization_id = params.org
)
SELECT amount_conf_band, COUNT(*) AS n,
  SUM(amount_drift::int) AS betrag_spaeter_geaendert,
  ROUND(100.0 * SUM(amount_drift::int) / NULLIF(COUNT(*),0), 1) AS fehlerquote_pct
FROM amt GROUP BY amount_conf_band ORDER BY amount_conf_band;


-- ═══ BLOCK 4 · Was steckt in den "ignored"? (Junk vs. stiller Datenverlust) ═══
-- Kernfrage: Sind die aussortierten Rechnungen wirklich Nicht-Belege — oder hat
-- der Filter/die KI echte Rechnungen weggeworfen? Eine Zeile "invoice" mit n>0
-- ist der Alarm: eine echte Rechnung wurde still ignoriert (schlimmster Fehler,
-- weil der Nutzer nicht merkt, dass etwas fehlt).
WITH params AS (
  SELECT '00000000-0000-0000-0000-000000000000'::text AS org
),
latest_ai AS (
  SELECT DISTINCT ON (ae.invoice_id) ae.invoice_id, (ae.output_json::jsonb) AS oj
  FROM ai_extractions ae JOIN invoices i ON i.id = ae.invoice_id, params
  WHERE i.organization_id = params.org
    AND ae.status = 'succeeded' AND ae.output_json IS NOT NULL
  ORDER BY ae.invoice_id, ae.created_at DESC
)
SELECT
  COALESCE(a.oj->>'document_type', '(kein KI-Output → Junk-Filter/Dateiname)') AS doc_type,
  count(*) AS n
FROM invoices i
LEFT JOIN latest_ai a ON a.invoice_id = i.id, params
WHERE i.organization_id = params.org AND i.status = 'ignored'
GROUP BY 1 ORDER BY 2 DESC;


-- ═══ BLOCK 5 · Anbieter-Match × Outcome (wie groß ist der Anbieter-Hebel?) ════
-- ERGEBNIS 2026-07-08: Hebel ist MARGINAL. 8/10 ohne Match liefen trotzdem auto
-- durch — "ready" braucht bewusst keinen vendor_id (review.ts:100). These
-- "kein Match → Handarbeit" damit WIDERLEGT.
WITH params AS (
  SELECT '00000000-0000-0000-0000-000000000000'::text AS org
)
SELECT
  CASE WHEN i.vendor_id IS NULL THEN 'kein Anbieter-Match' ELSE 'Anbieter gematcht' END AS match_status,
  count(*) AS n,
  count(*) FILTER (WHERE i.status = 'needs_review')          AS needs_review,
  count(*) FILTER (WHERE i.status IN ('ready','exported'))   AS auto_durch
FROM invoices i CROSS JOIN params
WHERE i.organization_id = params.org AND i.status NOT IN ('ignored','duplicate')
GROUP BY 1 ORDER BY 1;


-- ═══ BLOCK 6 · Anbieter wiederkehrend vs. einmalig (Fix-Strategie) ═══════════
-- Wiederkehrende (2+) → gezieltes Seeding/Alias lohnt; einmalige → nur Auto-Lernen.
-- (Für dieses Konto nachrangig, da Anbieter-Hebel marginal — s. Block 5.)
WITH params AS (
  SELECT '00000000-0000-0000-0000-000000000000'::text AS org
),
latest_ai AS (
  SELECT DISTINCT ON (ae.invoice_id) ae.invoice_id, (ae.output_json::jsonb) AS oj
  FROM ai_extractions ae JOIN invoices i ON i.id = ae.invoice_id, params
  WHERE i.organization_id = params.org AND ae.status = 'succeeded' AND ae.output_json IS NOT NULL
  ORDER BY ae.invoice_id, ae.created_at DESC
),
anbieter AS (
  SELECT lower(nullif(trim(a.oj->>'normalized_vendor'),'')) AS vk, count(*) AS rechnungen
  FROM invoices i JOIN latest_ai a ON a.invoice_id = i.id CROSS JOIN params
  WHERE i.organization_id = params.org AND i.status NOT IN ('ignored','duplicate')
  GROUP BY 1
)
SELECT
  CASE WHEN vk IS NULL THEN '(KI ohne Anbietername)'
       WHEN rechnungen >= 2 THEN 'wiederkehrend (2+)' ELSE 'einmalig (1)' END AS typ,
  count(*) AS anzahl_anbieter, sum(rechnungen) AS summe_rechnungen
FROM anbieter GROUP BY 1 ORDER BY 1;
