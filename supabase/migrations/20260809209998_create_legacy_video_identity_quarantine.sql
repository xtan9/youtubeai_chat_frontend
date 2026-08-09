-- Unsupported legacy cache rows have no truthful external Video identity.
-- Preserve their complete row data outside the active cache rather than
-- inventing an ID or allowing them to become Project evidence.

create table project_private.legacy_video_identity_quarantine (
  video_id uuid primary key,
  reason text not null,
  video_snapshot jsonb not null,
  transcript_snapshot jsonb not null,
  quarantined_at timestamptz not null default statement_timestamp(),
  constraint legacy_video_identity_quarantine_reason_valid
    check (reason = 'unsupported_channel_url'),
  constraint legacy_video_identity_quarantine_video_object
    check (jsonb_typeof(video_snapshot) = 'object'),
  constraint legacy_video_identity_quarantine_transcript_object
    check (jsonb_typeof(transcript_snapshot) = 'object'),
  constraint legacy_video_identity_quarantine_video_id_matches
    check ((video_snapshot ->> 'id')::uuid is not distinct from video_id),
  constraint legacy_video_identity_quarantine_transcript_id_matches
    check (
      (transcript_snapshot ->> 'video_id')::uuid is not distinct from video_id
    )
);

alter table project_private.legacy_video_identity_quarantine
  enable row level security;

revoke all on table project_private.legacy_video_identity_quarantine
  from public, anon, authenticated, service_role;
