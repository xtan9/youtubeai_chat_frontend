-- Validate only the new v2 terminal artifact shape. The deployed v1 helper
-- remains intact so old application instances can complete during rollout.

create function project_private.project_grounded_artifact_is_coherent_v2(
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
      or (select count(*) from pg_catalog.jsonb_object_keys(item.p)) <> 14
      or pg_catalog.char_length(coalesce(item.p ->> 'passageId','')) not between 1 and 80
      or pg_catalog.char_length(coalesce(item.p ->> 'text','')) not between 1 and 600
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
