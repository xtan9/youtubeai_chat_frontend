-- Research uses complete neighboring transcript segments. Literal Search and
-- historical single-segment evidence retain their existing contracts.

create function project_private.project_research_context_window(
  p_project_id uuid, p_video_id uuid, p_anchor_ordinal bigint
)
returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  rows jsonb;
  first_row jsonb;
  last_row jsonb;
  start_ordinal bigint;
  end_ordinal bigint;
  content text;
begin
  -- Align neighboring hits to overlapping blocks to avoid spending the
  -- evidence budget on almost-identical windows from the same moment.
  start_ordinal := greatest(1, ((p_anchor_ordinal - 1) / 16) * 16 - 3);
  end_ordinal := start_ordinal + 23;
  -- Index just the bounded range in this transcript. Expanding all project
  -- transcripts for every hit made a five-video research question too slow.
  select jsonb_agg(to_jsonb(r) order by r.segment_ordinal) into rows
  from (
    select n.ordinal as segment_ordinal, v.youtube_video_id, v.title,
      v.channel_name, vt.language as transcript_language,
      segment.value ->> 'text' as transcript_text,
      timing.start_seconds, timing.duration_seconds,
      (jsonb_typeof(segment.value) = 'object'
        and jsonb_typeof(segment.value -> 'text') = 'string'
        and btrim(segment.value ->> 'text') <> ''
        and timing.start_seconds >= 0 and timing.duration_seconds >= 0) as segment_is_usable
    from public.project_videos pv
    join public.videos v on v.id=pv.video_id
    join public.video_transcripts vt on vt.video_id=v.id
    cross join lateral generate_series(start_ordinal,
      least(end_ordinal,case when jsonb_typeof(vt.segments)='array' then jsonb_array_length(vt.segments) else 0 end)) n(ordinal)
    cross join lateral (select vt.segments -> (n.ordinal::integer - 1) value) segment
    cross join lateral (select
      project_private.safe_transcript_seconds(segment.value -> 'start') start_seconds,
      project_private.safe_transcript_seconds(segment.value -> 'duration') duration_seconds) timing
    where pv.project_id=p_project_id and pv.video_id=p_video_id
      and pv.status='ready' and v.youtube_video_id is not null
      and project_private.video_has_durable_ready_evidence(v.id)
  ) r;
  if rows is null or not exists (
    select 1 from jsonb_array_elements(rows) r
    where (r ->> 'segment_ordinal')::bigint = p_anchor_ordinal
      and (r ->> 'segment_is_usable')::boolean
  ) then return null; end if;

  -- Never silently skip an invalid row inside an excerpt. Keep the contiguous
  -- usable region around the anchor, then shrink without dropping the match.
  select greatest(start_ordinal, coalesce(max((r ->> 'segment_ordinal')::bigint) + 1, start_ordinal))
  into start_ordinal from jsonb_array_elements(rows) r
  where not coalesce((r ->> 'segment_is_usable')::boolean, false)
    and (r ->> 'segment_ordinal')::bigint < p_anchor_ordinal;
  select least(end_ordinal, coalesce(min((r ->> 'segment_ordinal')::bigint) - 1, end_ordinal))
  into end_ordinal from jsonb_array_elements(rows) r
  where not coalesce((r ->> 'segment_is_usable')::boolean, false)
    and (r ->> 'segment_ordinal')::bigint > p_anchor_ordinal;
  select min((r ->> 'segment_ordinal')::bigint), max((r ->> 'segment_ordinal')::bigint)
  into start_ordinal, end_ordinal from jsonb_array_elements(rows) r
  where (r ->> 'segment_ordinal')::bigint between start_ordinal and end_ordinal;
  loop
    select string_agg(r ->> 'transcript_text', ' ' order by (r ->> 'segment_ordinal')::bigint)
    into content from jsonb_array_elements(rows) r
    where (r ->> 'segment_ordinal')::bigint between start_ordinal and end_ordinal;
    exit when char_length(content) <= 2400;
    if start_ordinal = end_ordinal then return null; end if;
    if p_anchor_ordinal - start_ordinal > end_ordinal - p_anchor_ordinal
      then start_ordinal := start_ordinal + 1;
      else end_ordinal := end_ordinal - 1;
    end if;
  end loop;
  select r into first_row from jsonb_array_elements(rows) r
    where (r ->> 'segment_ordinal')::bigint = start_ordinal;
  select r into last_row from jsonb_array_elements(rows) r
    where (r ->> 'segment_ordinal')::bigint = end_ordinal;
  return jsonb_build_object(
    'passageId', p_video_id::text || ':' || start_ordinal || '-' || end_ordinal || ':0:' || char_length(content),
    'videoId', p_video_id, 'youtubeVideoId', first_row -> 'youtube_video_id',
    'title', first_row -> 'title', 'channelName', first_row -> 'channel_name',
    'text', content, 'segmentOrdinal', start_ordinal, 'endSegmentOrdinal', end_ordinal,
    'excerptStartCharacter', 0, 'excerptEndCharacter', char_length(content),
    'startSeconds', first_row -> 'start_seconds',
    'endSeconds', case when (last_row ->> 'start_seconds')::double precision + (last_row ->> 'duration_seconds')::double precision
      > (first_row ->> 'start_seconds')::double precision
      then to_jsonb((last_row ->> 'start_seconds')::double precision + (last_row ->> 'duration_seconds')::double precision)
      else 'null'::jsonb end,
    'language', coalesce(first_row ->> 'transcript_language', 'und'),
    'truncatedStart', false, 'truncatedEnd', false
  );
end;
$$;
revoke all on function project_private.project_research_context_window(uuid,uuid,bigint)
  from public, anon, authenticated, service_role;

create function public.search_project_research_passages(
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
  select coalesce(jsonb_agg(language order by language), '[]'::jsonb) into languages
  from (select distinct coalesce(transcript_language,'und') language
    from project_private.project_grounded_live_source_projection_v2(p_project_id)
    where is_ready and segment_is_usable) l;
  select coalesce(jsonb_agg(title order by title), '[]'::jsonb) into titles
  from (select distinct left(title,500) title
    from project_private.project_grounded_live_source_projection_v2(p_project_id)
    where is_ready and title is not null limit 5) t;
  select coalesce(jsonb_agg(passage order by rank), '[]'::jsonb) into excerpts
  from (
    select distinct on (passage ->> 'passageId') passage, rank
    from (
      select coalesce(project_private.project_research_context_window(
        p_project_id,(hit.p ->> 'videoId')::uuid,(hit.p ->> 'segmentOrdinal')::bigint
      ), hit.p) passage, hit.rank
      from jsonb_array_elements(result -> 'passages') with ordinality hit(p,rank)
    ) expanded
    order by passage ->> 'passageId', rank
  ) unique_windows;
  return result || jsonb_build_object('sourceLanguages',languages,'sourceTitles',titles,'passages',excerpts);
end;
$$;
revoke all on function public.search_project_research_passages(uuid,text,integer)
  from public, anon, service_role;
grant execute on function public.search_project_research_passages(uuid,text,integer) to authenticated;

-- Reconstruct every contextual excerpt from current canonical transcript
-- rows. Only exact contiguous ranges with honest timing and metadata pass.
create function project_private.project_research_windows_match_evidence(
  p_project_id uuid, p_evidence_snapshot jsonb
)
returns boolean
language plpgsql stable set search_path = ''
as $$
declare matches boolean;
begin
  with live as materialized (
    select * from project_private.project_grounded_live_source_projection_v2(p_project_id)
  ), windows as (
    select p, (p ->> 'videoId')::uuid video_id,
      (p ->> 'segmentOrdinal')::bigint first_ordinal,
      (p ->> 'endSegmentOrdinal')::bigint last_ordinal
    from jsonb_array_elements(p_evidence_snapshot -> 'passages') p
    where p ? 'endSegmentOrdinal'
  )
  select not exists (
    select 1 from windows w
    left join lateral (
      select count(*) row_count, bool_and(coalesce(is_ready and segment_is_usable,false)) usable,
        string_agg(transcript_text,' ' order by segment_ordinal) content
      from live where video_id = w.video_id and segment_ordinal between w.first_ordinal and w.last_ordinal
    ) r on true
    left join live first_row on first_row.video_id = w.video_id and first_row.segment_ordinal = w.first_ordinal
    left join live last_row on last_row.video_id = w.video_id and last_row.segment_ordinal = w.last_ordinal
    where w.last_ordinal < w.first_ordinal or w.last_ordinal - w.first_ordinal >= 32
      or r.row_count <> w.last_ordinal - w.first_ordinal + 1 or not coalesce(r.usable,false)
      or char_length(r.content) not between 1 and 2400
      or w.p ->> 'text' is distinct from r.content
      or w.p ->> 'passageId' is distinct from w.video_id::text || ':' || w.first_ordinal || '-' || w.last_ordinal || ':0:' || char_length(r.content)
      or w.p -> 'excerptStartCharacter' is distinct from '0'::jsonb
      or w.p -> 'excerptEndCharacter' is distinct from to_jsonb(char_length(r.content))
      or w.p -> 'startSeconds' is distinct from to_jsonb(first_row.start_seconds)
      or w.p -> 'endSeconds' is distinct from case
        when last_row.start_seconds + last_row.duration_seconds > first_row.start_seconds
          then to_jsonb(last_row.start_seconds + last_row.duration_seconds) else 'null'::jsonb end
      or w.p ->> 'youtubeVideoId' is distinct from first_row.youtube_video_id
      or w.p -> 'title' is distinct from coalesce(to_jsonb(first_row.title),'null'::jsonb)
      or w.p -> 'channelName' is distinct from coalesce(to_jsonb(first_row.channel_name),'null'::jsonb)
      or w.p ->> 'language' is distinct from coalesce(first_row.transcript_language,'und')
      or w.p -> 'truncatedStart' is distinct from 'false'::jsonb
      or w.p -> 'truncatedEnd' is distinct from 'false'::jsonb
  ) into matches;
  return matches is true;
exception when others then return false;
end;
$$;
revoke all on function project_private.project_research_windows_match_evidence(uuid,jsonb)
  from public, anon, authenticated, service_role;

create function project_private.project_research_window_shape_valid(p jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  return jsonb_typeof(p -> 'endSegmentOrdinal') = 'number'
    and (p ->> 'endSegmentOrdinal') ~ '^[1-9][0-9]*$'
    and (p ->> 'endSegmentOrdinal')::bigint between (p ->> 'segmentOrdinal')::bigint and (p ->> 'segmentOrdinal')::bigint + 31
    and p -> 'excerptStartCharacter' = '0'::jsonb
    and p -> 'excerptEndCharacter' = to_jsonb(char_length(p ->> 'text'))
    and p -> 'truncatedStart' = 'false'::jsonb
    and p -> 'truncatedEnd' = 'false'::jsonb
    and p ->> 'passageId' = p ->> 'videoId' || ':' || (p ->> 'segmentOrdinal') || '-' || (p ->> 'endSegmentOrdinal') || ':0:' || char_length(p ->> 'text');
exception when others then return false;
end;
$$;
revoke all on function project_private.project_research_window_shape_valid(jsonb)
  from public,anon,authenticated,service_role;

-- Extend the artifact/legacy shape contract without changing old evidence.
-- Validate and persist one terminal Grounded Answer. Only service_role can
-- cross this seam; the opaque attempt token fences stale or cross-request
-- completion and the user row is the sole in-progress artifact.

create or replace function project_private.project_grounded_artifact_is_coherent(
  p_project_id uuid,
  p_source_set_revision bigint,
  p_answer_classification text,
  p_source_manifest jsonb,
  p_source_coverage jsonb,
  p_evidence_snapshot jsonb,
  p_citation_diagnostics jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  sources jsonb;
  passages jsonb;
  unavailable jsonb;
  total_videos integer;
  ready_videos integer;
  evidence_videos integer;
  passages_examined integer;
  evidence_passages integer;
  manifest_passages integer;
  snapshot_videos integer;
begin
  if p_source_set_revision < 0
    or p_answer_classification not in ('supported', 'abstained', 'unsupported')
    or jsonb_typeof(p_source_manifest) <> 'object'
    or jsonb_typeof(p_source_coverage) <> 'object'
    or jsonb_typeof(p_evidence_snapshot) <> 'object'
    or jsonb_typeof(p_citation_diagnostics) <> 'array'
    or octet_length(p_source_manifest::text) > 65536
    or octet_length(p_source_coverage::text) > 32768
    or octet_length(p_evidence_snapshot::text) > 131072
    or octet_length(p_citation_diagnostics::text) > 16384
  then
    return false;
  end if;

  sources := p_source_manifest -> 'sources';
  passages := p_evidence_snapshot -> 'passages';
  unavailable := p_source_coverage -> 'unavailableVideos';

  if p_source_manifest ->> 'projectId' <> p_project_id::text
    or p_evidence_snapshot ->> 'projectId' <> p_project_id::text
    or jsonb_typeof(p_source_manifest -> 'sourceSetRevision') <> 'number'
    or jsonb_typeof(p_evidence_snapshot -> 'sourceSetRevision') <> 'number'
    or jsonb_typeof(sources) <> 'array'
    or jsonb_typeof(passages) <> 'array'
    or jsonb_typeof(unavailable) <> 'array'
    or jsonb_typeof(p_source_coverage -> 'totalVideos') <> 'number'
    or jsonb_typeof(p_source_coverage -> 'readyVideos') <> 'number'
    or jsonb_typeof(p_source_coverage -> 'evidenceVideos') <> 'number'
    or jsonb_typeof(p_source_coverage -> 'passagesExamined') <> 'number'
    or jsonb_typeof(p_source_coverage -> 'evidencePassages') <> 'number'
    or jsonb_array_length(sources) > 5
    or jsonb_array_length(passages) > 10
    or jsonb_array_length(unavailable) > 5
    or jsonb_array_length(p_citation_diagnostics) > 20
  then
    return false;
  end if;

  begin
    if (p_source_manifest ->> 'sourceSetRevision') !~ '^(0|[1-9][0-9]*)$'
      or (p_evidence_snapshot ->> 'sourceSetRevision') !~ '^(0|[1-9][0-9]*)$'
      or (p_source_coverage ->> 'totalVideos') !~ '^(0|[1-9][0-9]*)$'
      or (p_source_coverage ->> 'readyVideos') !~ '^(0|[1-9][0-9]*)$'
      or (p_source_coverage ->> 'evidenceVideos') !~ '^(0|[1-9][0-9]*)$'
      or (p_source_coverage ->> 'passagesExamined') !~ '^(0|[1-9][0-9]*)$'
      or (p_source_coverage ->> 'evidencePassages') !~ '^(0|[1-9][0-9]*)$'
      or (p_source_manifest ->> 'sourceSetRevision')::bigint
        <> p_source_set_revision
      or (p_evidence_snapshot ->> 'sourceSetRevision')::bigint
        <> p_source_set_revision
    then
      return false;
    end if;

    total_videos := (p_source_coverage ->> 'totalVideos')::integer;
    ready_videos := (p_source_coverage ->> 'readyVideos')::integer;
    evidence_videos := (p_source_coverage ->> 'evidenceVideos')::integer;
    passages_examined := (p_source_coverage ->> 'passagesExamined')::integer;
    evidence_passages := (p_source_coverage ->> 'evidencePassages')::integer;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      return false;
  end;

  if total_videos not between 0 and 5
    or ready_videos not between 0 and 5
    or evidence_videos not between 0 and 5
    or passages_examined < 0
    or evidence_passages not between 0 and 10
    or ready_videos + jsonb_array_length(unavailable) <> total_videos
    or evidence_videos > ready_videos
    or evidence_passages > passages_examined
    or evidence_passages <> jsonb_array_length(passages)
    or evidence_videos <> jsonb_array_length(sources)
  then
    return false;
  end if;

  select count(*)::integer,
    count(distinct source ->> 'sourceId')::integer
  into manifest_passages, snapshot_videos
  from jsonb_array_elements(sources) as source_row(source)
  cross join lateral jsonb_array_elements(source -> 'passages')
    as passage_row(passage)
  where jsonb_typeof(source) = 'object'
    and source ->> 'sourceId' ~ '^S[1-5]$'
    and jsonb_typeof(source -> 'passages') = 'array';

  -- Reuse snapshot_videos temporarily above to prove source ids are unique.
  if snapshot_videos <> jsonb_array_length(sources)
    or manifest_passages <> jsonb_array_length(passages)
  then
    return false;
  end if;

  select count(distinct passage ->> 'videoId')::integer
  into snapshot_videos
  from jsonb_array_elements(passages) as passage_row(passage);

  if snapshot_videos <> evidence_videos then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(sources) with ordinality as manifest(source, ordinal)
    where jsonb_typeof(manifest.source) <> 'object'
      or coalesce(manifest.source ->> 'sourceId', '')
        <> 'S' || manifest.ordinal::text
      or coalesce(manifest.source ->> 'videoId', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      or coalesce(manifest.source ->> 'youtubeVideoId', '')
        !~ '^[A-Za-z0-9_-]{11}$'
      or jsonb_typeof(manifest.source -> 'passages') <> 'array'
      or jsonb_array_length(manifest.source -> 'passages') not between 1 and 10
  ) then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(passages) as evidence(passage)
    where jsonb_typeof(evidence.passage) <> 'object'
      or evidence.passage ->> 'passageId' is null
      or char_length(evidence.passage ->> 'passageId') not between 1 and 80
      or coalesce(evidence.passage ->> 'videoId', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      or coalesce(evidence.passage ->> 'youtubeVideoId', '')
        !~ '^[A-Za-z0-9_-]{11}$'
      or jsonb_typeof(evidence.passage -> 'text') <> 'string'
      or char_length(evidence.passage ->> 'text') not between 1 and
        case when evidence.passage ? 'endSegmentOrdinal' then 2400 else 600 end
      or (evidence.passage ? 'endSegmentOrdinal' and not coalesce(
        project_private.project_research_window_shape_valid(evidence.passage), false))
      or not exists (
        select 1
        from jsonb_array_elements(sources) as manifest(source)
        cross join lateral jsonb_array_elements(manifest.source -> 'passages')
          as manifest_passage(passage)
        where manifest.source ->> 'videoId' = evidence.passage ->> 'videoId'
          and manifest.source ->> 'youtubeVideoId'
            = evidence.passage ->> 'youtubeVideoId'
          and manifest_passage.passage ->> 'passageId'
            = evidence.passage ->> 'passageId'
          and manifest_passage.passage -> 'startSeconds'
            = evidence.passage -> 'startSeconds'
          and manifest_passage.passage -> 'endSeconds'
            is not distinct from evidence.passage -> 'endSeconds'
      )
  ) then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(unavailable) as item(video)
    where jsonb_typeof(item.video) <> 'object'
      or coalesce(item.video ->> 'videoId', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      or coalesce(item.video ->> 'status', '')
        not in ('processing', 'failed', 'unavailable')
  ) then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_citation_diagnostics) as diagnostic(item)
    where jsonb_typeof(diagnostic.item) <> 'object'
      or coalesce(diagnostic.item ->> 'kind', '') not in (
        'malformed', 'unknown_source', 'timestamp_not_in_evidence'
      )
      or char_length(coalesce(diagnostic.item ->> 'raw', '')) not between 1 and 80
  ) then
    return false;
  end if;

  if p_answer_classification = 'supported'
    and jsonb_array_length(passages) = 0
  then
    return false;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

revoke all on function project_private.project_grounded_artifact_is_coherent(
  uuid, bigint, text, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;


-- Validate only the new v2 terminal artifact shape. The deployed v1 helper
-- remains intact so old application instances can complete during rollout.

create or replace function project_private.project_grounded_artifact_is_coherent_v2(
  p_project_id uuid,
  p_source_set_revision bigint,
  p_answer_classification text,
  p_source_manifest jsonb,
  p_source_coverage jsonb,
  p_evidence_snapshot jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  sources jsonb;
  passages jsonb;
  unavailable jsonb;
  total_videos integer;
  ready_videos integer;
  used_videos integer;
  passages_examined integer;
  passages_used integer;
begin
  if p_project_id is null or p_source_set_revision is null
    or p_source_set_revision < 0
    or p_answer_classification not in ('supported', 'abstained', 'unsupported')
    or pg_catalog.jsonb_typeof(p_source_manifest) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_source_coverage) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_evidence_snapshot) is distinct from 'object'
    or not (p_source_manifest ?& array['projectId','sourceSetRevision','sources'])
    or not (p_source_coverage ?& array[
      'totalVideos','readyVideos','usedVideos','unavailableVideos',
      'passagesExamined','passagesUsed'
    ])
    or not (p_evidence_snapshot ?& array[
      'projectId','sourceSetRevision','passages'
    ])
    or (select count(*) from pg_catalog.jsonb_object_keys(p_source_manifest)) <> 3
    or (select count(*) from pg_catalog.jsonb_object_keys(p_source_coverage)) <> 6
    or (select count(*) from pg_catalog.jsonb_object_keys(p_evidence_snapshot)) <> 3
    or pg_catalog.octet_length(p_source_manifest::text) > 65536
    or pg_catalog.octet_length(p_source_coverage::text) > 32768
    or pg_catalog.octet_length(p_evidence_snapshot::text) > 131072
  then return false; end if;

  sources := p_source_manifest -> 'sources';
  passages := p_evidence_snapshot -> 'passages';
  unavailable := p_source_coverage -> 'unavailableVideos';
  if p_source_manifest ->> 'projectId' is distinct from p_project_id::text
    or p_evidence_snapshot ->> 'projectId' is distinct from p_project_id::text
    or pg_catalog.jsonb_typeof(p_source_manifest -> 'projectId') <> 'string'
    or pg_catalog.jsonb_typeof(p_evidence_snapshot -> 'projectId') <> 'string'
    or pg_catalog.jsonb_typeof(p_source_manifest -> 'sourceSetRevision') <> 'number'
    or pg_catalog.jsonb_typeof(p_evidence_snapshot -> 'sourceSetRevision') <> 'number'
    or pg_catalog.jsonb_typeof(sources) <> 'array'
    or pg_catalog.jsonb_typeof(passages) <> 'array'
    or pg_catalog.jsonb_typeof(unavailable) <> 'array'
    or pg_catalog.jsonb_array_length(sources) > 5
    or pg_catalog.jsonb_array_length(passages) > 10
    or pg_catalog.jsonb_array_length(unavailable) > 5
  then return false; end if;

  begin
    if (p_source_manifest ->> 'sourceSetRevision') !~ '^(0|[1-9][0-9]*)$'
      or (p_evidence_snapshot ->> 'sourceSetRevision') !~ '^(0|[1-9][0-9]*)$'
      or (p_source_coverage ->> 'totalVideos') !~ '^(0|[1-9][0-9]*)$'
      or (p_source_coverage ->> 'readyVideos') !~ '^(0|[1-9][0-9]*)$'
      or (p_source_coverage ->> 'usedVideos') !~ '^(0|[1-9][0-9]*)$'
      or (p_source_coverage ->> 'passagesExamined') !~ '^(0|[1-9][0-9]*)$'
      or (p_source_coverage ->> 'passagesUsed') !~ '^(0|[1-9][0-9]*)$'
      or (p_source_manifest ->> 'sourceSetRevision')::bigint
        <> p_source_set_revision
      or (p_evidence_snapshot ->> 'sourceSetRevision')::bigint
        <> p_source_set_revision
    then return false; end if;
    total_videos := (p_source_coverage ->> 'totalVideos')::integer;
    ready_videos := (p_source_coverage ->> 'readyVideos')::integer;
    used_videos := (p_source_coverage ->> 'usedVideos')::integer;
    passages_examined := (p_source_coverage ->> 'passagesExamined')::integer;
    passages_used := (p_source_coverage ->> 'passagesUsed')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return false;
  end;
  if total_videos not between 0 and 5 or ready_videos not between 0 and 5
    or used_videos not between 0 and 5 or passages_examined < 0
    or passages_used not between 0 and 10
    or ready_videos + pg_catalog.jsonb_array_length(unavailable) <> total_videos
    or used_videos > ready_videos or passages_used > passages_examined
    or passages_used <> pg_catalog.jsonb_array_length(passages)
    or used_videos <> pg_catalog.jsonb_array_length(sources)
  then return false; end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(sources) with ordinality
      as item(source, ordinal)
    where pg_catalog.jsonb_typeof(item.source) <> 'object'
      or not (item.source ?& array[
        'sourceId','videoId','youtubeVideoId','title','channelName','passages'
      ])
      or (select count(*) from pg_catalog.jsonb_object_keys(item.source)) <> 6
      or item.source ->> 'sourceId' is distinct from 'S' || item.ordinal::text
      or coalesce(item.source ->> 'videoId','') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      or coalesce(item.source ->> 'youtubeVideoId','') !~ '^[A-Za-z0-9_-]{11}$'
      or pg_catalog.jsonb_typeof(item.source -> 'title') not in ('string','null')
      or pg_catalog.jsonb_typeof(item.source -> 'channelName') not in ('string','null')
      or pg_catalog.jsonb_typeof(item.source -> 'passages') <> 'array'
      or pg_catalog.jsonb_array_length(item.source -> 'passages') not between 1 and 10
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(item.source -> 'passages') as mp(p)
        where pg_catalog.jsonb_typeof(mp.p) <> 'object'
          or not (mp.p ?& array['passageId','startSeconds','endSeconds'])
          or (select count(*) from pg_catalog.jsonb_object_keys(mp.p)) <> 3
          or pg_catalog.jsonb_typeof(mp.p -> 'passageId') <> 'string'
          or pg_catalog.jsonb_typeof(mp.p -> 'startSeconds') <> 'number'
          or pg_catalog.jsonb_typeof(mp.p -> 'endSeconds') not in ('number','null')
      )
  ) then return false; end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(passages) as item(p)
    where pg_catalog.jsonb_typeof(item.p) <> 'object'
      or not (item.p ?& array[
        'passageId','videoId','youtubeVideoId','title','channelName','text',
        'segmentOrdinal','excerptStartCharacter','excerptEndCharacter',
        'startSeconds','endSeconds','language','truncatedStart','truncatedEnd'
      ])
      or (select count(*) from pg_catalog.jsonb_object_keys(item.p)) <>
        case when item.p ? 'endSegmentOrdinal' then 15 else 14 end
      or (item.p ? 'endSegmentOrdinal' and not coalesce(
        project_private.project_research_window_shape_valid(item.p), false))
      or pg_catalog.char_length(coalesce(item.p ->> 'passageId','')) not between 1 and 80
      or pg_catalog.char_length(coalesce(item.p ->> 'text','')) not between 1 and
        case when item.p ? 'endSegmentOrdinal' then 2400 else 600 end
      or coalesce(item.p ->> 'videoId','') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      or coalesce(item.p ->> 'youtubeVideoId','') !~ '^[A-Za-z0-9_-]{11}$'
      or pg_catalog.jsonb_typeof(item.p -> 'startSeconds') <> 'number'
      or pg_catalog.jsonb_typeof(item.p -> 'endSeconds') not in ('number','null')
      or pg_catalog.jsonb_typeof(item.p -> 'truncatedStart') <> 'boolean'
      or pg_catalog.jsonb_typeof(item.p -> 'truncatedEnd') <> 'boolean'
      or coalesce(item.p ->> 'segmentOrdinal','') !~ '^[1-9][0-9]*$'
      or coalesce(item.p ->> 'excerptStartCharacter','') !~ '^(0|[1-9][0-9]*)$'
      or coalesce(item.p ->> 'excerptEndCharacter','') !~ '^[1-9][0-9]*$'
  ) then return false; end if;

  if (select count(distinct item.p ->> 'passageId')
      from pg_catalog.jsonb_array_elements(passages) as item(p))
      <> pg_catalog.jsonb_array_length(passages)
    or (select count(distinct item.source ->> 'videoId')
      from pg_catalog.jsonb_array_elements(sources) as item(source))
      <> pg_catalog.jsonb_array_length(sources)
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(passages) as evidence(p)
      where not exists (
        select 1
        from pg_catalog.jsonb_array_elements(sources) as source_row(source)
        cross join lateral pg_catalog.jsonb_array_elements(
          source_row.source -> 'passages'
        ) as manifest_row(p)
        where source_row.source ->> 'videoId' = evidence.p ->> 'videoId'
          and manifest_row.p ->> 'passageId' = evidence.p ->> 'passageId'
          and manifest_row.p -> 'startSeconds' = evidence.p -> 'startSeconds'
          and manifest_row.p -> 'endSeconds' = evidence.p -> 'endSeconds'
      )
    )
    or (select count(*)
      from pg_catalog.jsonb_array_elements(sources) as source_row(source)
      cross join lateral pg_catalog.jsonb_array_elements(
        source_row.source -> 'passages'
      )) <> pg_catalog.jsonb_array_length(passages)
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(unavailable) as item(video)
      where pg_catalog.jsonb_typeof(item.video) <> 'object'
        or not (item.video ?& array[
          'videoId','youtubeVideoId','title','channelName','status','failureCode'
        ])
        or (select count(*) from pg_catalog.jsonb_object_keys(item.video)) <> 6
        or coalesce(item.video ->> 'status','') not in (
          'processing','failed','unavailable'
        )
    )
    or (select count(distinct item.video ->> 'videoId')
      from pg_catalog.jsonb_array_elements(unavailable) as item(video))
      <> pg_catalog.jsonb_array_length(unavailable)
    or (p_answer_classification = 'supported'
      and pg_catalog.jsonb_array_length(passages) = 0)
  then return false; end if;
  return true;
exception when others then
  return false;
end;
$$;

revoke all on function
  project_private.project_grounded_artifact_is_coherent_v2(
    uuid, bigint, text, jsonb, jsonb, jsonb
  ) from public, anon, authenticated, service_role;

-- Bind every v2 artifact and exact coverage metric to current canonical
-- Project membership and Transcript passage data.

create or replace function project_private.project_grounded_artifact_matches_evidence_v2(
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
    where not item.passage ? 'endSegmentOrdinal'
  )
  select
    project_private.project_research_windows_match_evidence(p_project_id, p_evidence_snapshot)
    and live_metrics.total_videos is not distinct from
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

-- Public reservation/artifact functions are wrapped by the analytics and GA
-- migrations. Patch the core definitions in place so those wrappers and their
-- grants remain intact on both fresh and upgraded installations.
do $$
declare
  fn record; definition text; updated integer := 0;
  temporary_owner_inheritance boolean := not pg_has_role(current_user, 'project_beta_rpc_owner', 'USAGE');
  had_self_grant boolean;
begin
  -- Production migrations run without superuser privileges. The prior beta
  -- migration moved these RPCs to a NOLOGIN owner. Its creator can administer
  -- that role but does not inherit it. Use a separate self-grant inside this
  -- atomic block, preserving the original grantor and membership options.
  if temporary_owner_inheritance then
    select exists(select 1 from pg_auth_members
      where roleid = 'project_beta_rpc_owner'::regrole
        and member = current_user::regrole and grantor = current_user::regrole)
      into had_self_grant;
    if current_setting('server_version_num')::integer >= 160000 then
      execute format('grant project_beta_rpc_owner to %I with inherit true granted by %I', current_user, current_user);
    else
      execute format('grant project_beta_rpc_owner to %I', current_user);
    end if;
  end if;
  for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'start_project_grounded_question%'
      and p.prosrc like '%char_length(normalized_question) not between 2 and 200%'
  loop
    definition := pg_get_functiondef(fn.oid);
    execute replace(definition, 'char_length(normalized_question) not between 2 and 200',
      'char_length(normalized_question) not between 2 and 4000');
    updated := updated + 1;
  end loop;
  if updated = 0 then raise exception 'Research question reservation implementation missing'; end if;
  for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'complete_project_artifact%'
      and p.prosrc like '%or not project_private.project_grounded_artifact_is_coherent(%'
  loop
    definition := pg_get_functiondef(fn.oid);
    execute replace(definition, 'or not project_private.project_grounded_artifact_is_coherent(',
      'or not project_private.project_research_windows_match_evidence(p_project_id,p_evidence_snapshot)
    or not project_private.project_grounded_artifact_is_coherent(');
  end loop;
  if temporary_owner_inheritance then
    if had_self_grant and current_setting('server_version_num')::integer >= 160000 then
      execute format('grant project_beta_rpc_owner to %I with inherit false granted by %I', current_user, current_user);
    elsif current_setting('server_version_num')::integer < 160000 then
      execute format('revoke project_beta_rpc_owner from %I', current_user);
    else
      execute format('revoke project_beta_rpc_owner from %I granted by %I', current_user, current_user);
    end if;
  end if;
end;
$$;

alter table public.project_conversation_messages
  drop constraint if exists project_conversation_messages_audit_shape_check;

alter table public.project_conversation_messages
  add constraint project_conversation_messages_audit_shape_check
  check (
    (
      role = 'user'
      and in_reply_to_message_id is null
      and char_length(content) <= 4000
      and completion_attempt_token is not null
      and completion_state is not null
      and (source_set_revision is null or source_set_revision >= 0)
      and answer_classification is null
      and source_manifest is null
      and source_coverage is null
      and evidence_snapshot is null
      and citation_diagnostics is null
      and completed_at is null
    )
    or
    (
      role = 'assistant'
      and in_reply_to_message_id is not null
      and completion_attempt_token is null
      and completion_state is null
      and answer_classification is not null
      and source_set_revision is not null
      and source_set_revision >= 0
      and source_manifest is not null
      and source_coverage is not null
      and evidence_snapshot is not null
      and citation_diagnostics is not null
      and completed_at is not null
      and jsonb_typeof(source_manifest) = 'object'
      and jsonb_typeof(source_coverage) = 'object'
      and jsonb_typeof(evidence_snapshot) = 'object'
      and jsonb_typeof(citation_diagnostics) = 'array'
      and octet_length(source_manifest::text) <= 65536
      and octet_length(source_coverage::text) <= 32768
      and octet_length(evidence_snapshot::text) <= 131072
      and octet_length(citation_diagnostics::text) <= 16384
    )
  );


-- Preserve a match from every represented video before filling remaining
-- slots. Prepending missing sources and truncating could previously evict the
-- only match from a different source at the tail of the base results.
do $migration$
declare
  fn record; definition text; updated integer := 0;
  temporary_owner_inheritance boolean := not pg_has_role(current_user, 'project_beta_rpc_owner', 'USAGE');
  had_self_grant boolean;
begin
  -- Match the reservation patch above without changing this RPC's owner or ACL.
  if temporary_owner_inheritance then
    select exists(select 1 from pg_auth_members
      where roleid = 'project_beta_rpc_owner'::regrole
        and member = current_user::regrole and grantor = current_user::regrole)
      into had_self_grant;
    if current_setting('server_version_num')::integer >= 160000 then
      execute format('grant project_beta_rpc_owner to %I with inherit true granted by %I', current_user, current_user);
    else
      execute format('grant project_beta_rpc_owner to %I', current_user);
    end if;
  end if;
  for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'search_project_transcript_passages_balanced%'
      and p.prosrc like '%into merged%'
  loop
    definition := pg_get_functiondef(fn.oid);
    if position($old$  select coalesce(jsonb_agg(value), '[]'::jsonb)
  into merged
  from (
    select value
    from jsonb_array_elements(coalesce(supplemental, '[]'::jsonb))
    union all
    select value
    from jsonb_array_elements(coalesce(base_result -> 'passages', '[]'::jsonb))
    limit result_limit
  ) as bounded;$old$ in definition)=0 then
      raise exception 'Research source balance implementation drifted';
    end if;
    execute replace(definition,$old$  select coalesce(jsonb_agg(value), '[]'::jsonb)
  into merged
  from (
    select value
    from jsonb_array_elements(coalesce(supplemental, '[]'::jsonb))
    union all
    select value
    from jsonb_array_elements(coalesce(base_result -> 'passages', '[]'::jsonb))
    limit result_limit
  ) as bounded;$old$,$new$  with candidates as (
    select value, 0 priority, ordinal
    from jsonb_array_elements(coalesce(supplemental,'[]'::jsonb)) with ordinality x(value,ordinal)
    union all
    select value, 1 priority, ordinal
    from jsonb_array_elements(coalesce(base_result -> 'passages','[]'::jsonb)) with ordinality x(value,ordinal)
  ), per_source as (
    select *, row_number() over (partition by value ->> 'videoId' order by priority,ordinal) source_rank
    from candidates
  ), bounded as (
    select * from per_source
    order by (source_rank=1) desc,priority,ordinal limit result_limit
  )
  select coalesce(jsonb_agg(value order by (source_rank=1) desc,priority,ordinal),'[]'::jsonb)
  into merged from bounded;$new$);
    updated := updated + 1;
  end loop;
  if updated=0 then raise exception 'Research source balance implementation missing'; end if;
  if temporary_owner_inheritance then
    if had_self_grant and current_setting('server_version_num')::integer >= 160000 then
      execute format('grant project_beta_rpc_owner to %I with inherit false granted by %I', current_user, current_user);
    elsif current_setting('server_version_num')::integer < 160000 then
      execute format('revoke project_beta_rpc_owner from %I', current_user);
    else
      execute format('revoke project_beta_rpc_owner from %I granted by %I', current_user, current_user);
    end if;
  end if;
end;
$migration$;

notify pgrst, 'reload schema';
