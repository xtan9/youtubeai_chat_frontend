-- One row per user. Lazily created on first checkout. Webhook (phase 2)
-- is the sole writer of `tier`; everything else reads. `tier` is
-- denormalized from `status` + `current_period_end` for fast reads on
-- the request path (every metered endpoint dispatches off it).

CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id                uuid         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id     text         NOT NULL UNIQUE,
  stripe_subscription_id text         UNIQUE,
  tier                   text         NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro')),
  plan                   text         CHECK (plan IS NULL OR plan IN ('monthly', 'yearly')),
  -- Unconstrained by design: Stripe may add statuses at any time; a CHECK here would break webhook inserts.
  status                 text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean      NOT NULL DEFAULT false,
  updated_at             timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_customer
  ON user_subscriptions(stripe_customer_id);

ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_subscriptions_select_own" ON user_subscriptions;
CREATE POLICY "user_subscriptions_select_own"
  ON user_subscriptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Service role bypasses RLS; no INSERT/UPDATE policies needed for
-- authenticated. The REVOKE below makes the denial explicit so a future
-- accidental policy can't widen access silently.
REVOKE INSERT, UPDATE, DELETE ON user_subscriptions FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
