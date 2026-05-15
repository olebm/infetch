-- Prevent double-processing of Stripe webhook events.
-- Each event is inserted before handling; a duplicate event_id causes a conflict
-- (DO NOTHING) and the handler skips processing.
CREATE TABLE IF NOT EXISTS stripe_processed_events (
  event_id     TEXT        PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep the table small: events older than 30 days are irrelevant.
CREATE INDEX IF NOT EXISTS idx_stripe_events_processed_at
  ON stripe_processed_events (processed_at);
