DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_video_history'
      AND column_name = 'accessed_at'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: user_video_history.accessed_at is missing';
  END IF;

  IF NOT has_table_privilege(
    'service_role',
    'public.user_subscriptions',
    'SELECT, INSERT, UPDATE, DELETE'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: service_role cannot manage user_subscriptions';
  END IF;

  IF NOT has_table_privilege(
    'service_role',
    'public.stripe_webhook_events',
    'SELECT, INSERT, UPDATE, DELETE'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: service_role cannot manage stripe_webhook_events';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.user_subscriptions', 'SELECT') THEN
    RAISE EXCEPTION 'REGRESSION: authenticated cannot read its subscription';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.user_video_history', 'SELECT') THEN
    RAISE EXCEPTION 'REGRESSION: authenticated cannot read its history';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.videos', 'SELECT') THEN
    RAISE EXCEPTION 'REGRESSION: authenticated cannot read videos referenced by history';
  END IF;
END $$;
