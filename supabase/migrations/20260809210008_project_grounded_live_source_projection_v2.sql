-- Mirror #317 readiness and failure inputs while expanding every member
-- Transcript's segment array once. Readiness accepts finite negative timing;
-- evidence usability and examined passage counts do not.

create function project_private.project_grounded_live_source_projection_v2(
  p_project_id uuid
)
returns table (
  video_id uuid,
  source_position smallint,
  membership_status text,
  membership_failure_code text,
  title text,
  channel_name text,
  youtube_video_id text,
  is_ready boolean,
  transcript_language text,
  segment_ordinal bigint,
  transcript_text text,
  start_seconds double precision,
  duration_seconds double precision,
  segment_is_usable boolean
)
language sql
stable
set search_path = ''
as $$
  with membership_identity as (
    select
      project_videos.video_id,
      project_videos.position,
      project_videos.status,
      project_videos.failure_code,
      videos.title,
      videos.channel_name,
      videos.youtube_video_id,
      project_private.video_has_durable_ready_evidence(
        project_videos.video_id
      ) as has_durable_ready_evidence
    from public.project_videos
    join public.videos on videos.id = project_videos.video_id
    where project_videos.project_id = p_project_id
  ), expanded as materialized (
    select
      membership_identity.*,
      video_transcripts.language as transcript_language,
      segment.ordinality::bigint as segment_ordinal,
      segment.value ->> 'text' as transcript_text,
      timing.start_seconds,
      timing.duration_seconds,
      (
        pg_catalog.jsonb_typeof(segment.value) = 'object'
        and pg_catalog.jsonb_typeof(segment.value -> 'text') = 'string'
        and btrim(segment.value ->> 'text') <> ''
        and timing.start_seconds is not null
        and timing.duration_seconds is not null
      ) as segment_is_ready,
      (
        pg_catalog.jsonb_typeof(segment.value) = 'object'
        and pg_catalog.jsonb_typeof(segment.value -> 'text') = 'string'
        and btrim(segment.value ->> 'text') <> ''
        and timing.start_seconds >= 0
        and timing.duration_seconds >= 0
      ) as segment_is_usable
    from membership_identity
    left join public.video_transcripts
      on video_transcripts.video_id = membership_identity.video_id
    left join lateral pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(video_transcripts.segments) = 'array'
        then video_transcripts.segments else '[]'::jsonb end
    ) with ordinality as segment(value, ordinality) on true
    left join lateral (
      select
        project_private.safe_transcript_seconds(segment.value -> 'start')
          as start_seconds,
        project_private.safe_transcript_seconds(segment.value -> 'duration')
          as duration_seconds
    ) as timing on true
  )
  select
    expanded.video_id,
    expanded.position,
    expanded.status,
    expanded.failure_code,
    expanded.title,
    expanded.channel_name,
    expanded.youtube_video_id,
    (
      expanded.status = 'ready'
      and expanded.youtube_video_id is not null
      and expanded.has_durable_ready_evidence
      and coalesce(
        pg_catalog.bool_or(expanded.segment_is_ready)
          over (partition by expanded.video_id),
        false
      )
    ) as is_ready,
    expanded.transcript_language,
    expanded.segment_ordinal,
    expanded.transcript_text,
    expanded.start_seconds,
    expanded.duration_seconds,
    expanded.segment_is_usable
  from expanded;
$$;

revoke all on function
  project_private.project_grounded_live_source_projection_v2(uuid)
  from public, anon, authenticated, service_role;
