-- Bind every v2 artifact and exact coverage metric to current canonical
-- Project membership and Transcript passage data.

create function project_private.project_grounded_artifact_matches_evidence_v2(
  p_project_id uuid,
  p_source_manifest jsonb,
  p_source_coverage jsonb,
  p_evidence_snapshot jsonb
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare artifact_matches boolean;
begin
  with live_rows as materialized (
    select *
    from project_private.project_grounded_live_source_projection_v2(
      p_project_id
    )
  ), live_membership as materialized (
    select distinct on (live_rows.video_id)
      live_rows.video_id,
      live_rows.source_position,
      live_rows.membership_status,
      live_rows.membership_failure_code,
      live_rows.title,
      live_rows.channel_name,
      live_rows.youtube_video_id,
      live_rows.is_ready
    from live_rows
    order by live_rows.video_id, live_rows.segment_ordinal nulls first
  ), live_metrics as (
    select
      count(*)::integer as total_videos,
      count(*) filter (where is_ready)::integer as ready_videos
    from live_membership
  ), live_examined as (
    select count(*)::bigint as passages_examined
    from live_rows
    where is_ready and segment_is_usable
  ), expected_unavailable as (
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'videoId', video_id,
        'youtubeVideoId', youtube_video_id,
        'title', title,
        'channelName', channel_name,
        'status', case
          when membership_status = 'processing' then 'processing'
          when membership_status = 'failed' then 'failed'
          else 'unavailable'
        end,
        'failureCode', case
          when membership_status = 'failed' then membership_failure_code
          when membership_status = 'ready' and youtube_video_id is null
            then 'identity_unavailable'
          when membership_status = 'ready' and not is_ready
            then 'evidence_unavailable'
          else null
        end
      ) order by source_position, video_id
    ), '[]'::jsonb) as unavailable_videos
    from live_membership where not is_ready
  ), evidence_input as (
    select
      item.passage,
      (item.passage ->> 'videoId')::uuid as video_id,
      (item.passage ->> 'segmentOrdinal')::bigint as segment_ordinal,
      (item.passage ->> 'excerptStartCharacter')::integer as excerpt_start,
      (item.passage ->> 'excerptEndCharacter')::integer as excerpt_end
    from pg_catalog.jsonb_array_elements(p_evidence_snapshot -> 'passages')
      as item(passage)
  )
  select
    live_metrics.total_videos is not distinct from
      (p_source_coverage ->> 'totalVideos')::integer
    and live_metrics.ready_videos is not distinct from
      (p_source_coverage ->> 'readyVideos')::integer
    and live_examined.passages_examined is not distinct from
      (p_source_coverage ->> 'passagesExamined')::bigint
    and expected_unavailable.unavailable_videos is not distinct from
      p_source_coverage -> 'unavailableVideos'
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_source_manifest -> 'sources')
        as manifest(source)
      left join live_membership
        on live_membership.video_id::text = manifest.source ->> 'videoId'
      where live_membership.video_id is null or not live_membership.is_ready
        or manifest.source ->> 'youtubeVideoId'
          is distinct from live_membership.youtube_video_id
        or manifest.source -> 'title' is distinct from
          coalesce(to_jsonb(live_membership.title), 'null'::jsonb)
        or manifest.source -> 'channelName' is distinct from
          coalesce(to_jsonb(live_membership.channel_name), 'null'::jsonb)
    )
    and not exists (
      select 1
      from evidence_input
      left join live_rows
        on live_rows.video_id = evidence_input.video_id
        and live_rows.segment_ordinal = evidence_input.segment_ordinal
      where live_rows.video_id is null or not live_rows.is_ready
        or not coalesce(live_rows.segment_is_usable, false)
        or evidence_input.excerpt_start >=
          pg_catalog.char_length(live_rows.transcript_text)
        or evidence_input.excerpt_end is distinct from least(
          pg_catalog.char_length(live_rows.transcript_text),
          evidence_input.excerpt_start + 600
        )
        or evidence_input.passage ->> 'passageId' is distinct from (
          evidence_input.video_id::text || ':'
          || evidence_input.segment_ordinal::text || ':'
          || evidence_input.excerpt_start::text || ':'
          || evidence_input.excerpt_end::text
        )
        or evidence_input.passage ->> 'text' is distinct from
          pg_catalog.substr(
            live_rows.transcript_text, evidence_input.excerpt_start + 1, 600
          )
        or evidence_input.passage ->> 'youtubeVideoId'
          is distinct from live_rows.youtube_video_id
        or evidence_input.passage -> 'title' is distinct from
          coalesce(to_jsonb(live_rows.title), 'null'::jsonb)
        or evidence_input.passage -> 'channelName' is distinct from
          coalesce(to_jsonb(live_rows.channel_name), 'null'::jsonb)
        or evidence_input.passage -> 'startSeconds'
          is distinct from to_jsonb(live_rows.start_seconds)
        or evidence_input.passage -> 'endSeconds' is distinct from case
          when live_rows.duration_seconds > 0
            then to_jsonb(live_rows.start_seconds + live_rows.duration_seconds)
          else 'null'::jsonb end
        or evidence_input.passage ->> 'language'
          is distinct from live_rows.transcript_language
        or evidence_input.passage -> 'truncatedStart'
          is distinct from to_jsonb(evidence_input.excerpt_start > 0)
        or evidence_input.passage -> 'truncatedEnd' is distinct from to_jsonb(
          evidence_input.excerpt_end
            < pg_catalog.char_length(live_rows.transcript_text)
        )
    )
  into artifact_matches
  from live_metrics cross join live_examined cross join expected_unavailable;
  return artifact_matches is true;
exception when others then return false;
end;
$$;

revoke all on function
  project_private.project_grounded_artifact_matches_evidence_v2(
    uuid, jsonb, jsonb, jsonb
  ) from public, anon, authenticated, service_role;
