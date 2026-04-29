-- Lifetime summary counter for anonymous browser sessions. anon_id is a
-- signed UUID cookie set by the app. Soft gate: clearing cookies resets
-- the count. Acceptable per spec — this nudges signup, doesn't stop
-- adversaries.

CREATE TABLE IF NOT EXISTS anon_summary_quota (
  anon_id      uuid         PRIMARY KEY,
  count        int          NOT NULL DEFAULT 0,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  last_used_at timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anon_summary_quota_last_used
  ON anon_summary_quota(last_used_at);

ALTER TABLE anon_summary_quota ENABLE ROW LEVEL SECURITY;

-- Anonymous browsers don't have a Supabase JWT; only service role reads
-- and writes this table. Make the denial explicit.
REVOKE ALL ON anon_summary_quota FROM anon, authenticated;

CREATE OR REPLACE FUNCTION increment_anon_summary_quota(p_anon_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO anon_summary_quota (anon_id, count, last_used_at)
  VALUES (p_anon_id, 1, now())
  ON CONFLICT (anon_id)
  DO UPDATE SET count = anon_summary_quota.count + 1, last_used_at = now()
  RETURNING count INTO new_count;

  RETURN new_count;
END;
$$;

REVOKE ALL ON FUNCTION increment_anon_summary_quota(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_anon_summary_quota(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
