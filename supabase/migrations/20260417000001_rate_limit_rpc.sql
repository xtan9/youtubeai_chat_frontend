-- Atomic rate limit increment.
-- Replaces a read-then-write pattern that could allow concurrent requests
-- to exceed the limit.
--
-- Returns the NEW request_count after the increment. Caller compares against
-- the limit to decide allow/deny.

CREATE OR REPLACE FUNCTION increment_rate_limit(
  p_user_id TEXT,
  p_window_start TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count INTEGER;
BEGIN
  INSERT INTO rate_limits (user_id, window_start, request_count)
  VALUES (p_user_id, p_window_start, 1)
  ON CONFLICT (user_id, window_start)
  DO UPDATE SET request_count = rate_limits.request_count + 1
  RETURNING request_count INTO new_count;

  RETURN new_count;
END;
$$;

-- Only service_role should call this.
REVOKE ALL ON FUNCTION increment_rate_limit(TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_rate_limit(TEXT, TIMESTAMPTZ) TO service_role;
