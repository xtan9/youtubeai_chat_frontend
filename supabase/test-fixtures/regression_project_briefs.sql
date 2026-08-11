-- Contract test for Project Brief persistence through the shared Project
-- Artifact lifecycle. Run after representative legacy and fresh migrations.

begin;

insert into auth.users (id, is_anonymous)
values
  ('87000000-0000-4000-8000-000000000007', false),
  ('88000000-0000-4000-8000-000000000008', false);

insert into public.projects (id, workspace_id, name, goal)
select fixture.project_id, workspaces.id, fixture.name, fixture.goal
from public.workspaces
join (values
  (
    'a8700000-0000-4000-8000-000000000007'::uuid,
    '87000000-0000-4000-8000-000000000007'::uuid,
    'Free Project Brief Project',
    'Compare launch evidence'
  )
) as fixture(project_id, owner_id, name, goal)
  on fixture.owner_id = workspaces.owner_id;

insert into public.project_source_sets (project_id, revision)
values ('a8700000-0000-4000-8000-000000000007', 1);

insert into public.videos (
  id, youtube_url, url_hash, title, channel_name, language
) values (
  '47000000-0000-4000-8000-000000000007',
  'https://www.youtube.com/watch?v=ggggggg0007',
  'project-brief-video-7',
  'Launch evidence',
  'Research channel',
  'en'
), (
  '47000000-0000-4000-8000-000000000008',
  'https://www.youtube.com/watch?v=hhhhhhh0008',
  'project-brief-video-8',
  'Launch context',
  'Research channel',
  'en'
);

insert into public.video_transcripts (
  video_id, transcript_source, language, segments
) values (
  '47000000-0000-4000-8000-000000000007',
  'manual_captions',
  'en',
  '[{"text":"The launch should happen in April because the team is ready.","start":42,"duration":16}]'::jsonb
), (
  '47000000-0000-4000-8000-000000000008',
  'manual_captions',
  'en',
  '[{"text":"A second ready source provides stable activation context.","start":12,"duration":8}]'::jsonb
);

insert into public.summaries (
  video_id, summary, transcript_source, output_language
) values (
  '47000000-0000-4000-8000-000000000007',
  'Launch evidence fixture',
  'manual_captions',
  null
), (
  '47000000-0000-4000-8000-000000000008',
  'Second launch context fixture',
  'manual_captions',
  null
);

insert into public.project_videos (
  project_id, video_id, position, status, processing_attempt_id
) values (
  'a8700000-0000-4000-8000-000000000007',
  '47000000-0000-4000-8000-000000000007',
  1,
  'ready',
  null
), (
  'a8700000-0000-4000-8000-000000000007',
  '47000000-0000-4000-8000-000000000008',
  2,
  'ready',
  null
);

do $$
begin
  if not has_function_privilege(
    'authenticated',
    'public.load_project_artifact(uuid,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.reserve_project_artifact_generation(uuid,text,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.reserve_project_artifact_generation(uuid,text,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.complete_project_artifact_generation(uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.complete_project_artifact_generation(uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'REGRESSION: Project Brief RPC grants drifted';
  end if;
end;
$$;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '87000000-0000-4000-8000-000000000007',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"87000000-0000-4000-8000-000000000007","app_metadata":{}}',
  true
);

do $$
declare
  result jsonb;
begin
  result := public.reserve_project_artifact_generation(
    'a8700000-0000-4000-8000-000000000007',
    'project_brief',
    '5c000000-0000-4000-8000-00000000000c'
  );
  if result ->> 'outcome' <> 'started'
    or result ->> 'kind' <> 'project_brief'
    or result ->> 'tier' <> 'free'
    or result ->> 'generationsUsed' <> '0'
  then
    raise exception 'REGRESSION: owner Project Brief reservation failed: %', result;
  end if;
  perform pg_catalog.set_config(
    'issue325.project_brief_attempt_id', result ->> 'attemptId', true
  );

  result := public.reserve_project_artifact_generation(
    'a8700000-0000-4000-8000-000000000007',
    'unsupported_kind',
    '5d000000-0000-4000-8000-00000000000d'
  );
  if result <> '{"outcome":"invalid"}'::jsonb then
    raise exception 'REGRESSION: invalid Project Artifact kind was accepted: %', result;
  end if;
end;
$$;

reset role;
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '88000000-0000-4000-8000-000000000008',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"88000000-0000-4000-8000-000000000008","app_metadata":{}}',
  true
);

do $$
declare
  result jsonb;
begin
  result := public.reserve_project_artifact_generation(
    'a8700000-0000-4000-8000-000000000007',
    'project_brief',
    '5e000000-0000-4000-8000-00000000000e'
  );
  if result <> '{"outcome":"missing"}'::jsonb then
    raise exception 'REGRESSION: cross-owner Project Brief reservation succeeded: %', result;
  end if;
end;
$$;

reset role;
set local role service_role;

do $$
declare
  project_id uuid := 'a8700000-0000-4000-8000-000000000007';
  video_id uuid := '47000000-0000-4000-8000-000000000007';
  passage_id text := video_id::text || ':1:0:56';
  manifest jsonb;
  snapshot jsonb;
  result jsonb;
begin
  manifest := jsonb_build_object(
    'projectId', project_id,
    'sourceSetRevision', 1,
    'sources', jsonb_build_array(jsonb_build_object(
      'sourceId', 'S1',
      'videoId', video_id,
      'youtubeVideoId', 'ggggggg0007',
      'title', 'Launch evidence',
      'channelName', 'Research channel',
      'passages', jsonb_build_array(jsonb_build_object(
        'passageId', passage_id,
        'startSeconds', 42,
        'endSeconds', 58
      ))
    ))
  );
  snapshot := jsonb_build_object(
    'projectId', project_id,
    'sourceSetRevision', 1,
    'passages', jsonb_build_array(jsonb_build_object(
      'passageId', passage_id,
      'videoId', video_id,
      'youtubeVideoId', 'ggggggg0007',
      'title', 'Launch evidence',
      'channelName', 'Research channel',
      'text', 'The launch should happen in April because the team is ready.',
      'segmentOrdinal', 1,
      'excerptStartCharacter', 0,
      'excerptEndCharacter', 56,
      'startSeconds', 42,
      'endSeconds', 58,
      'language', 'en',
      'truncatedStart', false,
      'truncatedEnd', false
    ))
  );

  result := public.complete_project_artifact_generation(
    '87000000-0000-4000-8000-000000000007',
    project_id,
    current_setting('issue325.project_brief_attempt_id')::uuid,
    '5c000000-0000-4000-8000-00000000000c',
    'project_brief',
    '# Project Brief',
    1,
    manifest,
    '{"totalVideos":1,"readyVideos":1,"evidenceVideos":1,"unavailableVideos":[],"passagesExamined":1,"evidencePassages":1}'::jsonb,
    snapshot,
    '[]'::jsonb,
    '{"model":"gpt-5.3-codex-spark","promptVersion":"project-brief-v4","generatedAt":"2026-08-09T20:00:00.000Z"}'::jsonb
  );
  if result <> '{"outcome":"invalid"}'::jsonb then
    raise exception 'REGRESSION: Project Brief completion accepted missing normalization audit: %', result;
  end if;

  result := public.complete_project_artifact_generation(
    '87000000-0000-4000-8000-000000000007',
    project_id,
    current_setting('issue325.project_brief_attempt_id')::uuid,
    '5c000000-0000-4000-8000-00000000000c',
    'project_brief',
    E'# Project Brief\n\n> Trust note: Only exact source-language clauses and canonical citations are authoritative evidence. Agreement, disagreement, and open-question labels are non-authoritative model Interpretation; inspect the cited clauses.\n\n## Important findings\n\n- The launch should happen in April [S1 @ 00:42].\n\n## Agreements\n\n- No model-identified cross-source agreement in this Evidence Snapshot.\n\n## Material disagreements\n\n- No model-identified material disagreement in this Evidence Snapshot.\n\n## Open questions\n\n- No model-identified open question in this Evidence Snapshot.',
    1,
    manifest,
    '{"totalVideos":1,"readyVideos":1,"evidenceVideos":1,"unavailableVideos":[],"passagesExamined":1,"evidencePassages":1}'::jsonb,
    snapshot,
    '[]'::jsonb,
    '{"model":"gpt-5.3-codex-spark","promptVersion":"project-brief-v4","generatedAt":"2026-08-09T20:00:00.000Z","normalizationAudit":{"version":"project-brief-normalization-v2","recordSetHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}'::jsonb
  );
  if result ->> 'outcome' <> 'completed'
    or result #>> '{artifact,kind}' <> 'project_brief'
    or result #>> '{artifact,evidenceSnapshot,passages,0,text}'
      <> 'The launch should happen in April because the team is ready.'
  then
    raise exception 'REGRESSION: service Project Brief completion failed: %', result;
  end if;

  result := public.record_project_activated_generation_usage(
    project_id,
    '87000000-0000-4000-8000-000000000007',
    '5c000000-0000-4000-8000-00000000000c',
    'project_brief',
    'gpt-5.3-codex-spark',
    'cliproxyapi',
    'unavailable',
    null,
    null,
    null,
    null,
    1200,
    null,
    null,
    null,
    'usage_unavailable',
    'artifact',
    clock_timestamp()
  );
  if result <> '{"outcome":"inserted"}'::jsonb then
    raise exception 'REGRESSION: Project Brief usage accounting rejected governed kind: %', result;
  end if;
end;
$$;

reset role;
update public.project_source_sets
set revision = 2
where project_id = 'a8700000-0000-4000-8000-000000000007';

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '87000000-0000-4000-8000-000000000007',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"87000000-0000-4000-8000-000000000007","app_metadata":{}}',
  true
);

do $$
declare
  loaded jsonb;
  result jsonb;
begin
  loaded := public.load_project_artifact(
    'a8700000-0000-4000-8000-000000000007', 'project_brief'
  );
  if loaded ->> 'outcome' <> 'ready'
    or loaded ->> 'currentSourceSetRevision' <> '2'
    or loaded #>> '{current,kind}' <> 'project_brief'
    or loaded #>> '{current,sourceSetRevision}' <> '1'
    or loaded #>> '{current,sourceManifest,sourceSetRevision}' <> '1'
    or loaded #>> '{current,evidenceSnapshot,sourceSetRevision}' <> '1'
    or loaded #>> '{current,evidenceSnapshot,passages,0,text}'
      <> 'The launch should happen in April because the team is ready.'
    or loaded #>> '{current,generation,promptVersion}' <> 'project-brief-v4'
    or loaded #>> '{current,generation,normalizationAudit,version}'
      <> 'project-brief-normalization-v2'
    or loaded #>> '{current,generation,normalizationAudit,recordSetHash}'
      <> 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    or (loaded #> '{current,generation,normalizationAudit}')
      - 'version' - 'recordSetHash' <> '{}'::jsonb
    or loaded ->> 'generationsUsed' <> '1'
  then
    raise exception 'REGRESSION: owner Project Brief reload/provenance drifted: %', loaded;
  end if;

  result := public.reserve_project_artifact_generation(
    'a8700000-0000-4000-8000-000000000007',
    'study_guide',
    '5f000000-0000-4000-8000-00000000000f'
  );
  if result ->> 'outcome' <> 'limit_reached'
    or result ->> 'generationsUsed' <> '1'
  then
    raise exception 'REGRESSION: Project Brief did not consume shared Free quota: %', result;
  end if;
end;
$$;

reset role;
insert into public.user_subscriptions (user_id, stripe_customer_id, tier, status)
values (
  '87000000-0000-4000-8000-000000000007',
  'cus_project_brief_pro',
  'pro',
  'active'
);

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '87000000-0000-4000-8000-000000000007',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"87000000-0000-4000-8000-000000000007","app_metadata":{}}',
  true
);

do $$
declare
  result jsonb;
begin
  result := public.reserve_project_artifact_generation(
    'a8700000-0000-4000-8000-000000000007',
    'project_brief',
    '60000000-0000-4000-8000-000000000010'
  );
  if result ->> 'outcome' <> 'started' or result ->> 'tier' <> 'pro' then
    raise exception 'REGRESSION: Pro Project Brief regeneration reservation failed: %', result;
  end if;
  perform pg_catalog.set_config(
    'issue325.project_brief_regeneration_attempt_id',
    result ->> 'attemptId',
    true
  );
end;
$$;

reset role;
set local role service_role;

do $$
declare
  project_id uuid := 'a8700000-0000-4000-8000-000000000007';
  video_id uuid := '47000000-0000-4000-8000-000000000007';
  passage_id text := video_id::text || ':1:0:56';
  manifest jsonb;
  snapshot jsonb;
  result jsonb;
begin
  manifest := jsonb_build_object(
    'projectId', project_id,
    'sourceSetRevision', 2,
    'sources', jsonb_build_array(jsonb_build_object(
      'sourceId', 'S1',
      'videoId', video_id,
      'youtubeVideoId', 'ggggggg0007',
      'title', 'Launch evidence',
      'channelName', 'Research channel',
      'passages', jsonb_build_array(jsonb_build_object(
        'passageId', passage_id,
        'startSeconds', 42,
        'endSeconds', 58
      ))
    ))
  );
  snapshot := jsonb_build_object(
    'projectId', project_id,
    'sourceSetRevision', 2,
    'passages', jsonb_build_array(jsonb_build_object(
      'passageId', passage_id,
      'videoId', video_id,
      'youtubeVideoId', 'ggggggg0007',
      'title', 'Launch evidence',
      'channelName', 'Research channel',
      'text', 'The launch should happen in April because the team is ready.',
      'segmentOrdinal', 1,
      'excerptStartCharacter', 0,
      'excerptEndCharacter', 56,
      'startSeconds', 42,
      'endSeconds', 58,
      'language', 'en',
      'truncatedStart', false,
      'truncatedEnd', false
    ))
  );

  result := public.complete_project_artifact_generation(
    '87000000-0000-4000-8000-000000000007',
    project_id,
    current_setting('issue325.project_brief_regeneration_attempt_id')::uuid,
    '60000000-0000-4000-8000-000000000010',
    'project_brief',
    E'# Project Brief\n\n> Trust note: Only exact source-language clauses and canonical citations are authoritative evidence. Agreement, disagreement, and open-question labels are non-authoritative model Interpretation; inspect the cited clauses.\n\n## Important findings\n\n- The launch should happen in April [S1 @ 00:42].\n\n## Agreements\n\n- No model-identified cross-source agreement in this Evidence Snapshot.\n\n## Material disagreements\n\n- No model-identified material disagreement in this Evidence Snapshot.\n\n## Open questions\n\n- No model-identified open question in this Evidence Snapshot.',
    2,
    manifest,
    '{"totalVideos":1,"readyVideos":1,"evidenceVideos":1,"unavailableVideos":[],"passagesExamined":1,"evidencePassages":1}'::jsonb,
    snapshot,
    '[]'::jsonb,
    '{"model":"gpt-5.3-codex-spark","promptVersion":"project-brief-v4","generatedAt":"2026-08-09T20:05:00.000Z","normalizationAudit":{"version":"project-brief-normalization-v2","recordSetHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}'::jsonb
  );
  if result ->> 'outcome' <> 'completed' then
    raise exception 'REGRESSION: Pro Project Brief regeneration failed: %', result;
  end if;
end;
$$;

reset role;
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '87000000-0000-4000-8000-000000000007',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"87000000-0000-4000-8000-000000000007","app_metadata":{}}',
  true
);

do $$
declare
  loaded jsonb;
begin
  loaded := public.load_project_artifact(
    'a8700000-0000-4000-8000-000000000007', 'project_brief'
  );
  if loaded #>> '{current,generation,promptVersion}' <> 'project-brief-v4'
    or loaded #>> '{history,0,generation,promptVersion}' <> 'project-brief-v4'
    or loaded #>> '{current,generation,normalizationAudit,recordSetHash}'
      <> 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    or loaded #>> '{history,0,generation,normalizationAudit,recordSetHash}'
      <> 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    or loaded #>> '{history,0,generation,normalizationAudit,version}'
      <> 'project-brief-normalization-v2'
  then
    raise exception 'REGRESSION: normalization audit did not survive current/history reload: %', loaded;
  end if;
end;
$$;

reset role;
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '88000000-0000-4000-8000-000000000008',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"88000000-0000-4000-8000-000000000008","app_metadata":{}}',
  true
);

do $$
begin
  if public.load_project_artifact(
    'a8700000-0000-4000-8000-000000000007', 'project_brief'
  ) <> '{"outcome":"missing"}'::jsonb then
    raise exception 'REGRESSION: cross-owner Project Brief load succeeded';
  end if;
end;
$$;

rollback;
