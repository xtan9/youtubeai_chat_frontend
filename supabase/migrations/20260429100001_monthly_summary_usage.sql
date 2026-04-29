-- Per-user monthly summary counter. year_month is a 'YYYY-MM' string in
-- UTC (computed by the app), so the boundary is UTC midnight on the 1st.
-- Mirrors the rate_limits table pattern.

CREATE TABLE IF NOT EXISTS monthly_summary_usage (
  user_id    uuid  NOT NULL,
  year_month text  NOT NULL,
  count      int   NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_summary_usage_user
  ON monthly_summary_usage(user_id, year_month DESC);

ALTER TABLE monthly_summary_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "monthly_summary_usage_select_own" ON monthly_summary_usage;
CREATE POLICY "monthly_summary_usage_select_own"
  ON monthly_summary_usage FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON monthly_summary_usage FROM anon, authenticated;

-- Atomic increment. Returns the NEW count after the increment, so the
-- caller can compare against the limit. ON CONFLICT prevents the
-- double-spend race two concurrent requests would otherwise create.
CREATE OR REPLACE FUNCTION increment_monthly_summary(
  p_user_id uuid,
  p_year_month text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO monthly_summary_usage (user_id, year_month, count)
  VALUES (p_user_id, p_year_month, 1)
  ON CONFLICT (user_id, year_month)
  DO UPDATE SET count = monthly_summary_usage.count + 1
  RETURNING count INTO new_count;

  RETURN new_count;
END;
$$;

REVOKE ALL ON FUNCTION increment_monthly_summary(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_monthly_summary(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
