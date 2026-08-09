-- Reserved attempts have a durable lease. NULL preserves v1/old-row rollout
-- compatibility; reapers derive the original 135-second lease from created_at.

alter table public.project_conversation_messages
  add column lease_expires_at timestamptz;
