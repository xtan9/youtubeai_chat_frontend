-- Stripe redelivers webhooks. Inserting event.id with ON CONFLICT
-- DO NOTHING gives us idempotency: a second delivery sees the conflict
-- and the handler returns 200 immediately. Phase 2 wires the actual
-- handler; this table lands in phase 1 so the schema is fully in place
-- before any Stripe code touches it.

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id    text         PRIMARY KEY,
  received_at timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stripe_webhook_events FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
