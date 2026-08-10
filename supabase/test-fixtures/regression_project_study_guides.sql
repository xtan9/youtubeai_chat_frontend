-- Contract test for durable Project Study Guides, immutable provenance,
-- owner isolation, explicit regeneration, and failure-safe Free allowance.
-- Run after both representative legacy and fresh migration replays.

begin;

insert into auth.users (id, is_anonymous)
values
  ('81000000-0000-4000-8000-000000000001', false),
  ('82000000-0000-4000-8000-000000000002', false);

insert into public.user_subscriptions (
  user_id,
  stripe_customer_id,
  tier,
  status
) values (
  '82000000-0000-4000-8000-000000000002',
  'cus_project_study_guide_pro',
  'pro',
  'active'
);

insert into public.projects (id, workspace_id, name, goal)
select fixture.project_id, workspaces.id, fixture.name, fixture.goal
from public.workspaces
join (values
  (
    'a8100000-0000-4000-8000-000000000001'::uuid,
    '81000000-0000-4000-8000-000000000001'::uuid,
    'Free Study Guide Project',
    'Guidance is not evidence'
  ),
  (
    'a8200000-0000-4000-8000-000000000002'::uuid,
    '82000000-0000-4000-8000-000000000002'::uuid,
    'Pro Study Guide Project',
    null
  )
) as fixture(project_id, owner_id, name, goal)
  on fixture.owner_id = workspaces.owner_id;

insert into public.project_source_sets (project_id, revision)
values
  ('a8100000-0000-4000-8000-000000000001', 3),
  ('a8200000-0000-4000-8000-000000000002', 3);

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
    'service_role',
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
  ) or not has_function_privilege(
    'service_role',
    'public.fail_project_artifact_generation(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'REGRESSION: Project Artifact RPC grants are not least privilege';
  end if;

  if not has_table_privilege(
    'authenticated', 'public.project_artifacts', 'SELECT'
  ) or has_table_privilege(
    'authenticated', 'public.project_artifacts', 'INSERT'
  ) or has_table_privilege(
    'authenticated', 'public.project_artifacts', 'UPDATE'
  ) or has_table_privilege(
    'authenticated', 'public.project_artifact_generation_attempts', 'SELECT'
  ) or has_table_privilege(
    'service_role', 'public.project_artifacts', 'INSERT'
  ) then
    raise exception 'REGRESSION: direct Project Artifact mutation or quota access is exposed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class
    where oid = 'public.project_artifacts'::regclass
      and relrowsecurity
  ) or not exists (
    select 1
    from pg_catalog.pg_class
    where oid = 'public.project_artifact_generation_attempts'::regclass
      and relrowsecurity
  ) then
    raise exception 'REGRESSION: Project Artifact RLS is disabled';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc
    where oid = 'public.complete_project_artifact_generation(uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=""']
  ) then
    raise exception 'REGRESSION: Project Artifact completion RPC is not hardened';
  end if;
end;
$$;

-- A failed Free attempt must release the only allowance.
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '81000000-0000-4000-8000-000000000001',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000001","app_metadata":{}}',
  true
);

do $$
declare
  result jsonb;
begin
  result := public.reserve_project_artifact_generation(
    'a8100000-0000-4000-8000-000000000001',
    'study_guide',
    '51000000-0000-4000-8000-000000000001'
  );
  if result ->> 'outcome' <> 'started'
    or result ->> 'tier' <> 'free'
    or result ->> 'generationsUsed' <> '0'
  then
    raise exception 'REGRESSION: first Free Artifact reservation failed: %', result;
  end if;
  perform pg_catalog.set_config(
    'issue323.failed_attempt_id', result ->> 'attemptId', true
  );
end;
$$;

reset role;
set local role service_role;

do $$
declare
  result jsonb;
begin
  result := public.fail_project_artifact_generation(
    '81000000-0000-4000-8000-000000000001',
    'a8100000-0000-4000-8000-000000000001',
    current_setting('issue323.failed_attempt_id')::uuid,
    '51000000-0000-4000-8000-000000000001'
  );
  if result <> '{"outcome":"failed"}'::jsonb then
    raise exception 'REGRESSION: failed Artifact reservation was not released: %', result;
  end if;
end;
$$;

reset role;
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '81000000-0000-4000-8000-000000000001',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000001","app_metadata":{}}',
  true
);

do $$
declare
  result jsonb;
begin
  result := public.reserve_project_artifact_generation(
    'a8100000-0000-4000-8000-000000000001',
    'study_guide',
    '52000000-0000-4000-8000-000000000002'
  );
  if result ->> 'outcome' <> 'started' then
    raise exception 'REGRESSION: failure consumed Free Artifact allowance: %', result;
  end if;
  perform pg_catalog.set_config(
    'issue323.free_attempt_id', result ->> 'attemptId', true
  );
end;
$$;

reset role;
set local role service_role;

do $$
declare
  project_id uuid := 'a8100000-0000-4000-8000-000000000001';
  video_id uuid := '41000000-0000-4000-8000-000000000001';
  passage_id text := video_id::text || ':1:0:45';
  manifest jsonb;
  coverage jsonb := '{
    "totalVideos":1,
    "readyVideos":1,
    "evidenceVideos":1,
    "unavailableVideos":[],
    "passagesExamined":6,
    "evidencePassages":1
  }'::jsonb;
  snapshot jsonb;
  result jsonb;
begin
  manifest := jsonb_build_object(
    'projectId', project_id,
    'sourceSetRevision', 3,
    'sources', jsonb_build_array(jsonb_build_object(
      'sourceId', 'S1',
      'videoId', video_id,
      'youtubeVideoId', 'aaaaaaa0001',
      'title', 'Launch notes',
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
    'sourceSetRevision', 3,
    'passages', jsonb_build_array(jsonb_build_object(
      'passageId', passage_id,
      'videoId', video_id,
      'youtubeVideoId', 'aaaaaaa0001',
      'title', 'Launch notes',
      'channelName', 'Research channel',
      'text', 'The source says the launch happened in April.',
      'segmentOrdinal', 1,
      'excerptStartCharacter', 0,
      'excerptEndCharacter', 45,
      'startSeconds', 42,
      'endSeconds', 58,
      'language', 'en',
      'truncatedStart', false,
      'truncatedEnd', false
    ))
  );

  result := public.complete_project_artifact_generation(
    '81000000-0000-4000-8000-000000000001',
    project_id,
    current_setting('issue323.free_attempt_id')::uuid,
    '52000000-0000-4000-8000-000000000002',
    'study_guide',
    E'# Study Guide\n\n## Overview\n\nThe launch happened in April [S1 @ 00:42].\n\n## Key ideas\n\n- April is named [S1 @ 00:42].\n\n## Review questions\n\n1. When was the launch [S1 @ 00:42]?',
    3,
    manifest,
    coverage,
    snapshot,
    '[]'::jsonb,
    '{"model":"gpt-5.3-codex-spark","promptVersion":"study-guide-v1","generatedAt":"2026-08-09T18:00:00.000Z"}'::jsonb
  );
  if result ->> 'outcome' <> 'completed'
    or result #>> '{artifact,sourceSetRevision}' <> '3'
    or result #>> '{artifact,evidenceSnapshot,passages,0,text}'
      <> 'The source says the launch happened in April.'
  then
    raise exception 'REGRESSION: durable Free Study Guide completion failed: %', result;
  end if;
end;
$$;

-- Source Set changes never rewrite the current Artifact; the loader exposes
-- the newer revision so the application can mark Update available.
reset role;
update public.project_source_sets
set revision = 4
where project_id = 'a8100000-0000-4000-8000-000000000001';

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '81000000-0000-4000-8000-000000000001',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000001","app_metadata":{}}',
  true
);

do $$
declare
  loaded jsonb;
  direct_count integer;
  insert_denied boolean := false;
begin
  loaded := public.load_project_artifact(
    'a8100000-0000-4000-8000-000000000001', 'study_guide'
  );
  select count(*) into direct_count from public.project_artifacts;
  begin
    insert into public.project_artifacts (
      project_id, generation_attempt_id, artifact_kind, content,
      source_set_revision, source_manifest, source_coverage,
      evidence_snapshot, citation_diagnostics, generation_metadata
    ) values (
      'a8100000-0000-4000-8000-000000000001',
      current_setting('issue323.free_attempt_id')::uuid,
      'study_guide', 'forged', 4, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
      '[]'::jsonb, '{}'::jsonb
    );
  exception when insufficient_privilege then
    insert_denied := true;
  end;

  if loaded ->> 'outcome' <> 'ready'
    or loaded ->> 'currentSourceSetRevision' <> '4'
    or loaded #>> '{current,sourceSetRevision}' <> '3'
    or loaded #>> '{current,sourceManifest,sourceSetRevision}' <> '3'
    or loaded #>> '{current,evidenceSnapshot,sourceSetRevision}' <> '3'
    or loaded ->> 'generationsUsed' <> '1'
    or direct_count <> 1
    or not insert_denied
  then
    raise exception 'REGRESSION: stale/provenance/RLS contract drifted: %, %, %',
      loaded, direct_count, insert_denied;
  end if;
end;
$$;

-- Pro may explicitly regenerate. The new row becomes current while the old
-- immutable provenance row remains in audit history.
reset role;
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '82000000-0000-4000-8000-000000000002',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000002","app_metadata":{}}',
  true
);

do $$
declare
  result jsonb;
begin
  result := public.reserve_project_artifact_generation(
    'a8200000-0000-4000-8000-000000000002',
    'study_guide',
    '53000000-0000-4000-8000-000000000003'
  );
  if result ->> 'outcome' <> 'started'
    or result ->> 'tier' <> 'pro'
    or result -> 'generationsLimit' <> 'null'::jsonb
  then
    raise exception 'REGRESSION: Pro Artifact reservation failed: %', result;
  end if;
  perform pg_catalog.set_config(
    'issue323.pro_attempt_id', result ->> 'attemptId', true
  );
end;
$$;

reset role;
set local role service_role;

do $$
declare
  project_id uuid := 'a8200000-0000-4000-8000-000000000002';
  video_id uuid := '42000000-0000-4000-8000-000000000002';
  passage_id text := video_id::text || ':1:0:45';
  manifest jsonb;
  coverage jsonb := '{"totalVideos":1,"readyVideos":1,"evidenceVideos":1,"unavailableVideos":[],"passagesExamined":6,"evidencePassages":1}'::jsonb;
  snapshot jsonb;
  result jsonb;
begin
  manifest := jsonb_build_object(
    'projectId', project_id, 'sourceSetRevision', 3,
    'sources', jsonb_build_array(jsonb_build_object(
      'sourceId', 'S1', 'videoId', video_id,
      'youtubeVideoId', 'bbbbbbb0002', 'title', 'Pro source',
      'channelName', 'Research channel',
      'passages', jsonb_build_array(jsonb_build_object(
        'passageId', passage_id, 'startSeconds', 42, 'endSeconds', 58
      ))
    ))
  );
  snapshot := jsonb_build_object(
    'projectId', project_id, 'sourceSetRevision', 3,
    'passages', jsonb_build_array(jsonb_build_object(
      'passageId', passage_id, 'videoId', video_id,
      'youtubeVideoId', 'bbbbbbb0002', 'title', 'Pro source',
      'channelName', 'Research channel', 'text', 'The Pro source supports version one.',
      'segmentOrdinal', 1, 'excerptStartCharacter', 0,
      'excerptEndCharacter', 36, 'startSeconds', 42, 'endSeconds', 58,
      'language', 'en', 'truncatedStart', false, 'truncatedEnd', false
    ))
  );
  result := public.complete_project_artifact_generation(
    '82000000-0000-4000-8000-000000000002', project_id,
    current_setting('issue323.pro_attempt_id')::uuid,
    '53000000-0000-4000-8000-000000000003', 'study_guide',
    E'# Study Guide\n\n## Overview\n\nVersion one [S1 @ 00:42].\n\n## Key ideas\n\n- One [S1 @ 00:42].\n\n## Review questions\n\n1. What is one [S1 @ 00:42]?',
    3, manifest, coverage, snapshot, '[]'::jsonb,
    '{"model":"gpt-5.3-codex-spark","promptVersion":"study-guide-v1","generatedAt":"2026-08-09T18:00:00.000Z"}'::jsonb
  );
  if result ->> 'outcome' <> 'completed' then
    raise exception 'REGRESSION: first Pro Study Guide completion failed: %', result;
  end if;
end;
$$;

reset role;
update public.project_source_sets
set revision = 4
where project_id = 'a8200000-0000-4000-8000-000000000002';

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '82000000-0000-4000-8000-000000000002',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000002","app_metadata":{}}',
  true
);

do $$
declare
  result jsonb;
begin
  result := public.reserve_project_artifact_generation(
    'a8200000-0000-4000-8000-000000000002',
    'study_guide',
    '54000000-0000-4000-8000-000000000004'
  );
  if result ->> 'outcome' <> 'started' then
    raise exception 'REGRESSION: explicit Pro regeneration was blocked: %', result;
  end if;
  perform pg_catalog.set_config(
    'issue323.pro_regeneration_attempt_id', result ->> 'attemptId', true
  );
end;
$$;

reset role;
set local role service_role;

do $$
declare
  project_id uuid := 'a8200000-0000-4000-8000-000000000002';
  video_id uuid := '42000000-0000-4000-8000-000000000002';
  passage_id text := video_id::text || ':1:0:45';
  manifest jsonb;
  coverage jsonb := '{"totalVideos":1,"readyVideos":1,"evidenceVideos":1,"unavailableVideos":[],"passagesExamined":6,"evidencePassages":1}'::jsonb;
  snapshot jsonb;
  result jsonb;
begin
  manifest := jsonb_build_object(
    'projectId', project_id, 'sourceSetRevision', 4,
    'sources', jsonb_build_array(jsonb_build_object(
      'sourceId', 'S1', 'videoId', video_id,
      'youtubeVideoId', 'bbbbbbb0002', 'title', 'Pro source',
      'channelName', 'Research channel',
      'passages', jsonb_build_array(jsonb_build_object(
        'passageId', passage_id, 'startSeconds', 42, 'endSeconds', 58
      ))
    ))
  );
  snapshot := jsonb_build_object(
    'projectId', project_id, 'sourceSetRevision', 4,
    'passages', jsonb_build_array(jsonb_build_object(
      'passageId', passage_id, 'videoId', video_id,
      'youtubeVideoId', 'bbbbbbb0002', 'title', 'Pro source',
      'channelName', 'Research channel', 'text', 'The Pro source supports version two.',
      'segmentOrdinal', 1, 'excerptStartCharacter', 0,
      'excerptEndCharacter', 36, 'startSeconds', 42, 'endSeconds', 58,
      'language', 'en', 'truncatedStart', false, 'truncatedEnd', false
    ))
  );
  result := public.complete_project_artifact_generation(
    '82000000-0000-4000-8000-000000000002', project_id,
    current_setting('issue323.pro_regeneration_attempt_id')::uuid,
    '54000000-0000-4000-8000-000000000004', 'study_guide',
    E'# Study Guide\n\n## Overview\n\nVersion two [S1 @ 00:42].\n\n## Key ideas\n\n- Two [S1 @ 00:42].\n\n## Review questions\n\n1. What is two [S1 @ 00:42]?',
    4, manifest, coverage, snapshot, '[]'::jsonb,
    '{"model":"gpt-5.3-codex-spark","promptVersion":"study-guide-v1","generatedAt":"2026-08-09T18:05:00.000Z"}'::jsonb
  );
  if result ->> 'outcome' <> 'completed' then
    raise exception 'REGRESSION: Pro Study Guide regeneration failed: %', result;
  end if;
end;
$$;

reset role;
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '82000000-0000-4000-8000-000000000002',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000002","app_metadata":{}}',
  true
);

do $$
declare
  loaded jsonb;
  direct_count integer;
begin
  loaded := public.load_project_artifact(
    'a8200000-0000-4000-8000-000000000002', 'study_guide'
  );
  select count(*) into direct_count from public.project_artifacts;
  if loaded ->> 'outcome' <> 'ready'
    or loaded #>> '{current,sourceSetRevision}' <> '4'
    or jsonb_array_length(loaded -> 'history') <> 1
    or loaded #>> '{history,0,sourceSetRevision}' <> '3'
    or loaded #>> '{history,0,evidenceSnapshot,sourceSetRevision}' <> '3'
    or loaded -> 'generationsLimit' <> 'null'::jsonb
    or direct_count <> 2
  then
    raise exception 'REGRESSION: regeneration/audit/RLS contract drifted: %, %',
      loaded, direct_count;
  end if;

  if public.load_project_artifact(
    'a8100000-0000-4000-8000-000000000001', 'study_guide'
  ) <> '{"outcome":"missing"}'::jsonb then
    raise exception 'REGRESSION: cross-owner Artifact load succeeded';
  end if;
end;
$$;

-- The sibling Project Brief uses the same authenticated reservation, immutable
-- Evidence Snapshot, service-only completion, owner reload, and audit boundary.
do $$
declare
  result jsonb;
begin
  result := public.reserve_project_artifact_generation(
    'a8200000-0000-4000-8000-000000000002',
    'project_brief',
    '55000000-0000-4000-8000-000000000005'
  );
  if result ->> 'outcome' <> 'started'
    or result ->> 'tier' <> 'pro'
    or result -> 'generationsLimit' <> 'null'::jsonb
  then
    raise exception 'REGRESSION: Pro Project Brief reservation failed: %', result;
  end if;
  perform pg_catalog.set_config(
    'issue325.project_brief_attempt_id', result ->> 'attemptId', true
  );
end;
$$;

reset role;
set local role service_role;

do $$
declare
  project_id uuid := 'a8200000-0000-4000-8000-000000000002';
  video_id uuid := '42000000-0000-4000-8000-000000000002';
  passage_id text := video_id::text || ':1:0:45';
  manifest jsonb;
  coverage jsonb := '{"totalVideos":1,"readyVideos":1,"evidenceVideos":1,"unavailableVideos":[],"passagesExamined":6,"evidencePassages":1}'::jsonb;
  snapshot jsonb;
  result jsonb;
begin
  manifest := jsonb_build_object(
    'projectId', project_id, 'sourceSetRevision', 4,
    'sources', jsonb_build_array(jsonb_build_object(
      'sourceId', 'S1', 'videoId', video_id,
      'youtubeVideoId', 'bbbbbbb0002', 'title', 'Pro source',
      'channelName', 'Research channel',
      'passages', jsonb_build_array(jsonb_build_object(
        'passageId', passage_id, 'startSeconds', 42, 'endSeconds', 58
      ))
    ))
  );
  snapshot := jsonb_build_object(
    'projectId', project_id, 'sourceSetRevision', 4,
    'passages', jsonb_build_array(jsonb_build_object(
      'passageId', passage_id, 'videoId', video_id,
      'youtubeVideoId', 'bbbbbbb0002', 'title', 'Pro source',
      'channelName', 'Research channel',
      'text', 'The Pro source identifies one important unresolved question.',
      'segmentOrdinal', 1, 'excerptStartCharacter', 0,
      'excerptEndCharacter', 60, 'startSeconds', 42, 'endSeconds', 58,
      'language', 'en', 'truncatedStart', false, 'truncatedEnd', false
    ))
  );
  result := public.complete_project_artifact_generation(
    '82000000-0000-4000-8000-000000000002', project_id,
    current_setting('issue325.project_brief_attempt_id')::uuid,
    '55000000-0000-4000-8000-000000000005', 'project_brief',
    E'# Project Brief\n\n## Important findings\n\nOne finding [S1 @ 00:42].\n\n## Agreements\n\nNo cross-source agreement is supported [S1 @ 00:42].\n\n## Material disagreements\n\nNo cross-source disagreement is supported [S1 @ 00:42].\n\n## Open questions\n\n- What remains unresolved [S1 @ 00:42]?',
    4, manifest, coverage, snapshot, '[]'::jsonb,
    '{"model":"gpt-5.3-codex-spark","promptVersion":"project-brief-v1","generatedAt":"2026-08-09T18:10:00.000Z"}'::jsonb
  );
  if result ->> 'outcome' <> 'completed' then
    raise exception 'REGRESSION: Project Brief completion failed: %', result;
  end if;
end;
$$;

reset role;
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '82000000-0000-4000-8000-000000000002',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000002","app_metadata":{}}',
  true
);

do $$
declare
  loaded jsonb;
begin
  loaded := public.load_project_artifact(
    'a8200000-0000-4000-8000-000000000002', 'project_brief'
  );
  if loaded ->> 'outcome' <> 'ready'
    or loaded #>> '{current,kind}' <> 'project_brief'
    or loaded #>> '{current,sourceSetRevision}' <> '4'
    or loaded #>> '{current,sourceManifest,sourceSetRevision}' <> '4'
    or loaded #>> '{current,evidenceSnapshot,sourceSetRevision}' <> '4'
    or loaded #>> '{current,generation,promptVersion}' <> 'project-brief-v1'
    or jsonb_array_length(loaded -> 'history') <> 0
  then
    raise exception 'REGRESSION: owner Project Brief reload drifted: %', loaded;
  end if;

  if public.load_project_artifact(
    'a8100000-0000-4000-8000-000000000001', 'project_brief'
  ) <> '{"outcome":"missing"}'::jsonb then
    raise exception 'REGRESSION: cross-owner Project Brief load succeeded';
  end if;
end;
$$;

-- Even privileged deletion of generated content cannot restore the durable
-- Free allowance because completed usage lives independently of the Artifact.
reset role;
delete from public.project_artifacts
where project_id = 'a8100000-0000-4000-8000-000000000001';

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '81000000-0000-4000-8000-000000000001',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000001","app_metadata":{}}',
  true
);

do $$
declare
  result jsonb;
begin
  result := public.reserve_project_artifact_generation(
    'a8100000-0000-4000-8000-000000000001',
    'creator_brief',
    '55000000-0000-4000-8000-000000000005'
  );
  if result ->> 'outcome' <> 'limit_reached'
    or result ->> 'generationsUsed' <> '1'
  then
    raise exception 'REGRESSION: Artifact deletion restored Free allowance: %', result;
  end if;

  result := public.reserve_project_artifact_generation(
    'a8100000-0000-4000-8000-000000000001',
    'project_brief',
    '56000000-0000-4000-8000-000000000006'
  );
  if result ->> 'outcome' <> 'limit_reached'
    or result ->> 'generationsUsed' <> '1'
  then
    raise exception 'REGRESSION: Project Brief bypassed shared Free allowance: %', result;
  end if;
end;
$$;

rollback;
