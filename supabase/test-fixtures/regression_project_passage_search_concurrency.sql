-- Two real PostgreSQL sessions prove Search never combines revision,
-- readiness, Transcript passages, and coverage from opposite sides of a
-- concurrent service status transition.

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

begin;

insert into auth.users (id, is_anonymous)
values ('73000000-0000-4000-8000-000000000003', false)
on conflict (id) do update set is_anonymous = excluded.is_anonymous;

insert into public.projects (id, workspace_id, name)
select 'd3000000-0000-4000-8000-000000000003', id, 'Concurrent Search snapshot'
from public.workspaces
where owner_id = '73000000-0000-4000-8000-000000000003';

insert into public.videos (
  id,
  youtube_url,
  url_hash,
  title,
  channel_name,
  language
)
values (
  '86000000-0000-4000-8000-000000000006',
  'https://www.youtube.com/watch?v=fffffff1006',
  'fffffff1006',
  'Concurrent evidence',
  'Snapshot Lab',
  'en'
);

insert into public.video_transcripts (
  video_id,
  transcript_source,
  language,
  segments
)
values (
  '86000000-0000-4000-8000-000000000006',
  'manual_captions',
  'en',
  '[{"text":"coherent snapshot evidence","start":12,"duration":4}]'::jsonb
);

insert into public.summaries (
  video_id,
  summary,
  transcript_source,
  output_language
)
values (
  '86000000-0000-4000-8000-000000000006',
  'Snapshot summary',
  'manual_captions',
  null
);

insert into public.project_source_sets (project_id, revision)
values ('d3000000-0000-4000-8000-000000000003', 1);

insert into public.project_videos (
  project_id,
  video_id,
  position,
  status,
  processing_attempt_id
)
values (
  'd3000000-0000-4000-8000-000000000003',
  '86000000-0000-4000-8000-000000000006',
  1,
  'processing',
  '92000000-0000-4000-8000-000000000001'
);

commit;

do $$
declare
  connection_string text := 'dbname=' || pg_catalog.current_database();
  transition_result jsonb;
  during_result jsonb;
  after_result jsonb;
begin
  perform extensions.dblink_connect('project_search_reader', connection_string);
  perform extensions.dblink_connect('project_search_writer', connection_string);
  perform extensions.dblink_exec('project_search_reader', 'set role authenticated');
  perform extensions.dblink_exec(
    'project_search_reader',
    'set request.jwt.claim.sub = ''73000000-0000-4000-8000-000000000003'''
  );
  perform extensions.dblink_exec('project_search_writer', 'begin');
  perform extensions.dblink_exec('project_search_writer', 'set local role service_role');

  perform extensions.dblink_send_query(
    'project_search_writer',
    $query$
      select public.finalize_project_video_processing(
        'd3000000-0000-4000-8000-000000000003',
        '86000000-0000-4000-8000-000000000006',
        '92000000-0000-4000-8000-000000000001',
        'ready',
        null
      )
    $query$
  );
  select result into transition_result
  from extensions.dblink_get_result('project_search_writer')
    as transitioned(result jsonb);
  perform result
  from extensions.dblink_get_result('project_search_writer')
    as cleared(result jsonb);

  if transition_result ->> 'outcome' <> 'transitioned'
    or (transition_result ->> 'revision')::integer <> 2 then
    raise exception 'REGRESSION: concurrent readiness transition did not stage';
  end if;

  -- The writer holds an uncommitted revision/status update. MVCC Search must
  -- return the complete old processing snapshot immediately, never ready
  -- coverage or passages with the old revision.
  select result into during_result
  from extensions.dblink(
    'project_search_reader',
    $query$
      select public.search_project_transcript_passages(
        'd3000000-0000-4000-8000-000000000003',
        'snapshot',
        8
      )
    $query$
  ) as searched(result jsonb);

  if during_result ->> 'outcome' <> 'not_ready'
    or (during_result ->> 'sourceSetRevision')::integer <> 1
    or (during_result #>> '{coverage,readyVideos}')::integer <> 0
    or during_result #>> '{coverage,unavailableVideos,0,status}' <> 'processing'
    or pg_catalog.jsonb_array_length(during_result -> 'passages') <> 0
  then
    raise exception 'REGRESSION: concurrent Search returned a torn old snapshot: %', during_result;
  end if;

  perform extensions.dblink_exec('project_search_writer', 'commit');

  select result into after_result
  from extensions.dblink(
    'project_search_reader',
    $query$
      select public.search_project_transcript_passages(
        'd3000000-0000-4000-8000-000000000003',
        'snapshot',
        8
      )
    $query$
  ) as searched(result jsonb);

  if after_result ->> 'outcome' <> 'ready'
    or (after_result ->> 'sourceSetRevision')::integer <> 2
    or (after_result #>> '{coverage,readyVideos}')::integer <> 1
    or pg_catalog.jsonb_array_length(after_result -> 'passages') <> 1
    or after_result #>> '{passages,0,text}' <> 'coherent snapshot evidence'
  then
    raise exception 'REGRESSION: concurrent Search returned a torn new snapshot: %', after_result;
  end if;

  perform extensions.dblink_disconnect('project_search_reader');
  perform extensions.dblink_disconnect('project_search_writer');
end;
$$;

delete from auth.users
where id = '73000000-0000-4000-8000-000000000003';

delete from public.videos
where id = '86000000-0000-4000-8000-000000000006';

reset search_path;
