-- Stripe-Integration: Customer-ID und updated_at für Tier-Management
--
-- stripe_customer_id: Wird bei erstem Checkout gesetzt.
--   Stripe → Infetch-Webhook setzt Tier automatisch.
-- Tier-Flow:
--   1. User klickt Upgrade → Stripe Payment Link (mit ?client_reference_id={orgId})
--   2. Stripe feuert checkout.session.completed
--   3. Webhook setzt stripe_customer_id + tier auf org
--   4. Folge-Events (subscription.updated/deleted) ändern tier automatisch

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_stripe_customer_id
  ON organizations(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
