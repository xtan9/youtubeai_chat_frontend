-- Research metadata is bounded by project membership. The authenticated base
-- search remains the authority for ownership, readiness, and source coverage.

create or replace function public.search_project_research_passages(
  p_project_id uuid, p_query text, p_limit integer default 10
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb; excerpts jsonb; languages jsonb; titles jsonb;
begin
  -- The existing entrypoint enforces registered-user and project ownership.
  result := public.search_project_transcript_passages_balanced(p_project_id,p_query,p_limit);
  if result ->> 'outcome' not in ('ready','no_results','not_ready') then return result; end if;
  -- The base search already checked readiness once per project member. Reuse
  -- its unavailable set under the same statement snapshot; expanding every
  -- transcript again just to read its language/title exceeds hosted timeouts.
  with ready_sources as materialized (
    select coalesce(vt.language, 'und') as language, left(v.title, 500) as title
    from public.project_videos pv
    join public.videos v on v.id = pv.video_id
    join public.video_transcripts vt on vt.video_id = pv.video_id
    where pv.project_id = p_project_id and pv.status = 'ready'
      and v.youtube_video_id is not null
      and not exists (
        select 1 from jsonb_array_elements(result #> '{coverage,unavailableVideos}') unavailable
        where unavailable ->> 'videoId' = pv.video_id::text
      )
  )
  select
    (select coalesce(jsonb_agg(language order by language), '[]'::jsonb)
      from (select distinct language from ready_sources) languages),
    (select coalesce(jsonb_agg(title order by title), '[]'::jsonb)
      from (select distinct title from ready_sources
        where title is not null order by title limit 5) titles)
  into languages, titles;
  with expanded as materialized (
    select coalesce(project_private.project_research_context_window(
      p_project_id,(hit.p ->> 'videoId')::uuid,(hit.p ->> 'segmentOrdinal')::bigint
    ), hit.p) passage, hit.rank
    from jsonb_array_elements(result -> 'passages') with ordinality hit(p,rank)
  )
  select coalesce(jsonb_agg(passage order by rank), '[]'::jsonb) into excerpts
  from (
    select distinct on (passage ->> 'passageId') passage, rank
    from expanded
    order by passage ->> 'passageId', rank
  ) unique_windows;
  return result || jsonb_build_object('sourceLanguages',languages,'sourceTitles',titles,'passages',excerpts);
end;
$$;
revoke all on function public.search_project_research_passages(uuid,text,integer)
  from public, anon, service_role;
grant execute on function public.search_project_research_passages(uuid,text,integer) to authenticated;

-- Readiness depends on a video, not an individual transcript segment. Keep
-- the membership boundary materialized so evidence validation evaluates it
-- once per source even when the transcript expands to thousands of rows.
create or replace function project_private.project_grounded_live_source_projection_v2(
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
  with membership_identity as materialized (
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

NOTIFY pgrst, 'reload schema';
