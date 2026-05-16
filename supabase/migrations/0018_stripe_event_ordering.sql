-- Schutz vor Out-of-Order-Stripe-Events.
-- Stripe garantiert KEINE Reihenfolge der Webhook-Zustellung. Trifft ein
-- verzögertes `customer.subscription.updated (active)` NACH einem
-- `customer.subscription.deleted` ein, wurde die Org fälschlich wieder
-- hochgestuft. `stripe_event_ts` speichert den `created`-Timestamp (Unix-
-- Sekunden) des zuletzt angewandten Events; ältere Events werden ignoriert.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS stripe_event_ts BIGINT;
