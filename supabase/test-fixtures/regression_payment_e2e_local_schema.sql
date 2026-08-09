DO $$
DECLARE
  fixture_user_id constant uuid := 'e2000000-0000-4000-8000-000000000001';
  fixture_video_id constant uuid := 'e2000000-0000-4000-8000-000000000002';
  history_result jsonb;
  service_video_count integer;
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

  IF has_table_privilege('authenticated', 'public.videos', 'SELECT') THEN
    RAISE EXCEPTION 'REGRESSION: authenticated can enumerate the shared Video cache';
  END IF;

  IF NOT has_table_privilege(
    'service_role',
    'public.videos',
    'SELECT, INSERT, UPDATE'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: service_role cannot use the shared Video cache';
  END IF;

  INSERT INTO auth.users (id, is_anonymous)
  VALUES (fixture_user_id, false)
  ON CONFLICT (id) DO UPDATE SET is_anonymous = excluded.is_anonymous;

  INSERT INTO public.videos (
    id,
    youtube_url,
    youtube_video_id,
    title,
    language
  )
  VALUES (
    fixture_video_id,
    'https://www.youtube.com/watch?v=payfix00001',
    'payfix00001',
    'Payment fixture History boundary',
    'en'
  )
  ON CONFLICT (youtube_video_id) DO UPDATE SET title = excluded.title;

  INSERT INTO public.user_video_history (user_id, video_id)
  VALUES (fixture_user_id, fixture_video_id)
  ON CONFLICT (user_id, video_id) DO NOTHING;

  SET LOCAL ROLE service_role;
  SELECT count(*) INTO service_video_count
  FROM public.videos
  WHERE youtube_video_id = 'payfix00001';
  RESET ROLE;
  IF service_video_count <> 1 THEN
    RAISE EXCEPTION 'REGRESSION: service_role cannot read the shared Video cache';
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claim.sub',
    fixture_user_id::text,
    true
  );
  BEGIN
    EXECUTE 'SELECT count(*) FROM public.videos';
    RAISE EXCEPTION 'REGRESSION: authenticated enumerated Videos directly';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  history_result := public.list_user_video_history(fixture_user_id, 1, 25);
  RESET ROLE;
  IF history_result ->> 'outcome' <> 'resolved'
    OR jsonb_array_length(history_result -> 'rows') <> 1
    OR history_result -> 'rows' -> 0 ->> 'youtubeVideoId' <> 'payfix00001'
  THEN
    RAISE EXCEPTION 'REGRESSION: authenticated owner History RPC failed: %', history_result;
  END IF;

  DELETE FROM public.user_video_history WHERE user_id = fixture_user_id;
  DELETE FROM public.videos WHERE id = fixture_video_id;
  DELETE FROM auth.users WHERE id = fixture_user_id;
END $$;
