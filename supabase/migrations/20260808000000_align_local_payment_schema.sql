-- Fresh local Supabase projects do not inherit the hosted project's API
-- grants. Make the payment tables usable by the same roles the application
-- already relies on, and align the history timestamp with production.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_video_history'
      AND column_name = 'created_at'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_video_history'
      AND column_name = 'accessed_at'
  ) THEN
    ALTER TABLE public.user_video_history RENAME COLUMN created_at TO accessed_at;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.user_subscriptions,
     public.stripe_webhook_events,
     public.monthly_summary_usage,
     public.user_video_history
  TO service_role;

GRANT SELECT
  ON public.user_subscriptions,
     public.monthly_summary_usage,
     public.user_video_history,
     public.videos
  TO authenticated;

NOTIFY pgrst, 'reload schema';
