-- Contract test for Creator Brief persistence through the shared Project
-- Artifact lifecycle. Run after representative legacy and fresh migrations.

begin;

insert into auth.users (id, is_anonymous)
values
  ('84000000-0000-4000-8000-000000000004', false),
  ('85000000-0000-4000-8000-000000000005', false),
  ('86000000-0000-4000-8000-000000000006', false);

insert into public.user_subscriptions (user_id, stripe_customer_id, tier, status)
values (
  '85000000-0000-4000-8000-000000000005',
  'cus_project_creator_brief_pro',
  'pro',
  'active'
);

insert into public.projects (id, workspace_id, name, goal)
select fixture.project_id, workspaces.id, fixture.name, fixture.goal
from public.workspaces
join (values
  (
    'a8400000-0000-4000-8000-000000000004'::uuid,
    '84000000-0000-4000-8000-000000000004'::uuid,
    'Free Creator Brief Project',
    'Create an original launch Video'
  ),
  (
    'a8500000-0000-4000-8000-000000000005'::uuid,
    '85000000-0000-4000-8000-000000000005'::uuid,
    'Pro Creator Brief Project',
    'Explore a trustworthy launch angle'
  )
) as fixture(project_id, owner_id, name, goal)
  on fixture.owner_id = workspaces.owner_id;

insert into public.project_source_sets (project_id, revision)
values
  ('a8400000-0000-4000-8000-000000000004', 1),
  ('a8500000-0000-4000-8000-000000000005', 1);

-- Free chooses Creator Brief for its one shared Artifact generation.
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '84000000-0000-4000-8000-000000000004',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"84000000-0000-4000-8000-000000000004","app_metadata":{}}',
  true
);

do $$
declare
  result jsonb;
begin
  result := public.reserve_project_artifact_generation(
    'a8400000-0000-4000-8000-000000000004',
    'creator_brief',
    '58000000-0000-4000-8000-000000000008'
  );
  if result ->> 'outcome' <> 'started'
    or result ->> 'kind' <> 'creator_brief'
    or result ->> 'tier' <> 'free'
  then
    raise exception 'REGRESSION: Free Creator Brief reservation failed: %', result;
  end if;
  perform pg_catalog.set_config(
    'issue324.free_attempt_id', result ->> 'attemptId', true
  );
end;
$$;

reset role;
set local role service_role;

do $$
declare
  project_id uuid := 'a8400000-0000-4000-8000-000000000004';
  video_id uuid := '44000000-0000-4000-8000-000000000004';
  passage_id text := video_id::text || ':1:0:68';
  manifest jsonb;
  snapshot jsonb;
  result jsonb;
begin
  manifest := jsonb_build_object(
    'projectId', project_id, 'sourceSetRevision', 1,
    'sources', jsonb_build_array(jsonb_build_object(
      'sourceId', 'S1', 'videoId', video_id,
      'youtubeVideoId', 'ddddddd0004', 'title', 'Reliability launch',
      'channelName', 'Research channel',
      'passages', jsonb_build_array(jsonb_build_object(
        'passageId', passage_id, 'startSeconds', 42, 'endSeconds', 58
      ))
    ))
  );
  snapshot := jsonb_build_object(
    'projectId', project_id, 'sourceSetRevision', 1,
    'passages', jsonb_build_array(jsonb_build_object(
      'passageId', passage_id, 'videoId', video_id,
      'youtubeVideoId', 'ddddddd0004', 'title', 'Reliability launch',
      'channelName', 'Research channel',
      'text', 'Testing evidence informed the launch decision.',
      'segmentOrdinal', 1, 'excerptStartCharacter', 0,
      'excerptEndCharacter', 46, 'startSeconds', 42, 'endSeconds', 58,
      'language', 'en', 'truncatedStart', false, 'truncatedEnd', false
    ))
  );
  result := public.complete_project_artifact_generation(
    '84000000-0000-4000-8000-000000000004', project_id,
    current_setting('issue324.free_attempt_id')::uuid,
    '58000000-0000-4000-8000-000000000008', 'creator_brief',
    E'# Creator Brief\n\n## Source claims\n\n- Inspiration: Reliability evidence informed launch timing [S1 @ 00:42].\n\n## Proposed ideas\n\n- Gap: Explore unfinished tests [S1 @ 00:42].\n- Combination: Pair timing and a checklist [S1 @ 00:42].\n- Counterargument: Question excessive delay [S1 @ 00:42].\n- Original angle: Make decisions visible [S1 @ 00:42].\n\n## Video direction\n\n- Proposed beat: Build a new decision framework [S1 @ 00:42].',
    1,
    manifest,
    '{"totalVideos":1,"readyVideos":1,"evidenceVideos":1,"unavailableVideos":[],"passagesExamined":4,"evidencePassages":1}'::jsonb,
    snapshot,
    '[]'::jsonb,
    '{"model":"gpt-5.3-codex-spark","promptVersion":"creator-brief-v1","generatedAt":"2026-08-09T19:00:00.000Z"}'::jsonb
  );
  if result ->> 'outcome' <> 'completed'
    or result #>> '{artifact,kind}' <> 'creator_brief'
  then
    raise exception 'REGRESSION: Free Creator Brief completion failed: %', result;
  end if;
end;
$$;

-- Deleting the generated Creator Brief cannot restore the shared allowance
-- for Study Guide or any other Artifact type.
reset role;
delete from public.project_artifacts
where project_id = 'a8400000-0000-4000-8000-000000000004'
  and artifact_kind = 'creator_brief';

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '84000000-0000-4000-8000-000000000004',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"84000000-0000-4000-8000-000000000004","app_metadata":{}}',
  true
);

do $$
declare
  result jsonb;
begin
  result := public.reserve_project_artifact_generation(
    'a8400000-0000-4000-8000-000000000004',
    'study_guide',
    '59000000-0000-4000-8000-000000000009'
  );
  if result ->> 'outcome' <> 'limit_reached'
    or result ->> 'generationsUsed' <> '1'
  then
    raise exception 'REGRESSION: deleting Creator Brief restored shared Free quota: %', result;
  end if;
end;
$$;

-- Pro explicitly regenerates Creator Brief. One current record and immutable
-- earlier provenance must remain scoped to the Creator Brief kind.
reset role;
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '85000000-0000-4000-8000-000000000005',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"85000000-0000-4000-8000-000000000005","app_metadata":{}}',
  true
);

do $$
declare
  result jsonb;
begin
  result := public.reserve_project_artifact_generation(
    'a8500000-0000-4000-8000-000000000005',
    'creator_brief',
    '5a000000-0000-4000-8000-00000000000a'
  );
  if result ->> 'outcome' <> 'started' or result ->> 'tier' <> 'pro' then
    raise exception 'REGRESSION: Pro Creator Brief reservation failed: %', result;
  end if;
  perform pg_catalog.set_config(
    'issue324.pro_attempt_id', result ->> 'attemptId', true
  );
end;
$$;

reset role;
set local role service_role;

do $$
declare
  project_id uuid := 'a8500000-0000-4000-8000-000000000005';
  video_id uuid := '45000000-0000-4000-8000-000000000005';
  passage_id text := video_id::text || ':1:0:68';
  manifest jsonb;
  snapshot jsonb;
  result jsonb;
begin
  manifest := jsonb_build_object(
    'projectId', project_id, 'sourceSetRevision', 1,
    'sources', jsonb_build_array(jsonb_build_object(
      'sourceId', 'S1', 'videoId', video_id,
      'youtubeVideoId', 'eeeeeee0005', 'title', 'Pro launch source',
      'channelName', 'Research channel',
      'passages', jsonb_build_array(jsonb_build_object(
        'passageId', passage_id, 'startSeconds', 60, 'endSeconds', 75
      ))
    ))
  );
  snapshot := jsonb_build_object(
    'projectId', project_id, 'sourceSetRevision', 1,
    'passages', jsonb_build_array(jsonb_build_object(
      'passageId', passage_id, 'videoId', video_id,
      'youtubeVideoId', 'eeeeeee0005', 'title', 'Pro launch source',
      'channelName', 'Research channel', 'text', 'Version one source evidence.',
      'segmentOrdinal', 1, 'excerptStartCharacter', 0,
      'excerptEndCharacter', 28, 'startSeconds', 60, 'endSeconds', 75,
      'language', 'en', 'truncatedStart', false, 'truncatedEnd', false
    ))
  );
  result := public.complete_project_artifact_generation(
    '85000000-0000-4000-8000-000000000005', project_id,
    current_setting('issue324.pro_attempt_id')::uuid,
    '5a000000-0000-4000-8000-00000000000a', 'creator_brief',
    E'# Creator Brief\n\n## Source claims\n\n- Inspiration: Version one [S1 @ 01:00].\n\n## Proposed ideas\n\n- Gap: One [S1 @ 01:00].\n- Combination: One [S1 @ 01:00].\n- Counterargument: One [S1 @ 01:00].\n- Original angle: One [S1 @ 01:00].\n\n## Video direction\n\n- Proposed beat: One [S1 @ 01:00].',
    1, manifest,
    '{"totalVideos":1,"readyVideos":1,"evidenceVideos":1,"unavailableVideos":[],"passagesExamined":4,"evidencePassages":1}'::jsonb,
    snapshot, '[]'::jsonb,
    '{"model":"gpt-5.3-codex-spark","promptVersion":"creator-brief-v1","generatedAt":"2026-08-09T19:05:00.000Z"}'::jsonb
  );
  if result ->> 'outcome' <> 'completed' then
    raise exception 'REGRESSION: first Pro Creator Brief completion failed: %', result;
  end if;
end;
$$;

reset role;
update public.project_source_sets
set revision = 2
where project_id = 'a8500000-0000-4000-8000-000000000005';

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '85000000-0000-4000-8000-000000000005',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"85000000-0000-4000-8000-000000000005","app_metadata":{}}',
  true
);

do $$
declare
  result jsonb;
begin
  result := public.reserve_project_artifact_generation(
    'a8500000-0000-4000-8000-000000000005',
    'creator_brief',
    '5b000000-0000-4000-8000-00000000000b'
  );
  if result ->> 'outcome' <> 'started' then
    raise exception 'REGRESSION: Pro Creator Brief regeneration blocked: %', result;
  end if;
  perform pg_catalog.set_config(
    'issue324.pro_regeneration_attempt_id', result ->> 'attemptId', true
  );
end;
$$;

reset role;
set local role service_role;

do $$
declare
  project_id uuid := 'a8500000-0000-4000-8000-000000000005';
  video_id uuid := '45000000-0000-4000-8000-000000000005';
  passage_id text := video_id::text || ':1:0:68';
  manifest jsonb;
  snapshot jsonb;
  result jsonb;
begin
  manifest := jsonb_build_object(
    'projectId', project_id, 'sourceSetRevision', 2,
    'sources', jsonb_build_array(jsonb_build_object(
      'sourceId', 'S1', 'videoId', video_id,
      'youtubeVideoId', 'eeeeeee0005', 'title', 'Pro launch source',
      'channelName', 'Research channel',
      'passages', jsonb_build_array(jsonb_build_object(
        'passageId', passage_id, 'startSeconds', 60, 'endSeconds', 75
      ))
    ))
  );
  snapshot := jsonb_build_object(
    'projectId', project_id, 'sourceSetRevision', 2,
    'passages', jsonb_build_array(jsonb_build_object(
      'passageId', passage_id, 'videoId', video_id,
      'youtubeVideoId', 'eeeeeee0005', 'title', 'Pro launch source',
      'channelName', 'Research channel', 'text', 'Version two source evidence.',
      'segmentOrdinal', 1, 'excerptStartCharacter', 0,
      'excerptEndCharacter', 28, 'startSeconds', 60, 'endSeconds', 75,
      'language', 'en', 'truncatedStart', false, 'truncatedEnd', false
    ))
  );
  result := public.complete_project_artifact_generation(
    '85000000-0000-4000-8000-000000000005', project_id,
    current_setting('issue324.pro_regeneration_attempt_id')::uuid,
    '5b000000-0000-4000-8000-00000000000b', 'creator_brief',
    E'# Creator Brief\n\n## Source claims\n\n- Inspiration: Version two [S1 @ 01:00].\n\n## Proposed ideas\n\n- Gap: Two [S1 @ 01:00].\n- Combination: Two [S1 @ 01:00].\n- Counterargument: Two [S1 @ 01:00].\n- Original angle: Two [S1 @ 01:00].\n\n## Video direction\n\n- Proposed beat: Two [S1 @ 01:00].',
    2, manifest,
    '{"totalVideos":1,"readyVideos":1,"evidenceVideos":1,"unavailableVideos":[],"passagesExamined":4,"evidencePassages":1}'::jsonb,
    snapshot, '[]'::jsonb,
    '{"model":"gpt-5.3-codex-spark","promptVersion":"creator-brief-v1","generatedAt":"2026-08-09T19:10:00.000Z"}'::jsonb
  );
  if result ->> 'outcome' <> 'completed' then
    raise exception 'REGRESSION: Pro Creator Brief regeneration failed: %', result;
  end if;
end;
$$;

reset role;
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '85000000-0000-4000-8000-000000000005',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"85000000-0000-4000-8000-000000000005","app_metadata":{}}',
  true
);

do $$
declare
  loaded jsonb;
  study_guide jsonb;
  direct_count integer;
begin
  loaded := public.load_project_artifact(
    'a8500000-0000-4000-8000-000000000005', 'creator_brief'
  );
  study_guide := public.load_project_artifact(
    'a8500000-0000-4000-8000-000000000005', 'study_guide'
  );
  select count(*) into direct_count from public.project_artifacts;
  if loaded ->> 'outcome' <> 'ready'
    or loaded ->> 'currentSourceSetRevision' <> '2'
    or loaded #>> '{current,kind}' <> 'creator_brief'
    or loaded #>> '{current,sourceSetRevision}' <> '2'
    or loaded #>> '{current,evidenceSnapshot,sourceSetRevision}' <> '2'
    or jsonb_array_length(loaded -> 'history') <> 1
    or loaded #>> '{history,0,sourceSetRevision}' <> '1'
    or loaded #>> '{history,0,evidenceSnapshot,sourceSetRevision}' <> '1'
    or study_guide #> '{current}' <> 'null'::jsonb
    or jsonb_array_length(study_guide -> 'history') <> 0
    or direct_count <> 2
  then
    raise exception 'REGRESSION: Creator Brief current/history/RLS/kind isolation drifted: %, %, %',
      loaded, study_guide, direct_count;
  end if;
end;
$$;

reset role;
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '86000000-0000-4000-8000-000000000006',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"86000000-0000-4000-8000-000000000006","app_metadata":{}}',
  true
);

do $$
declare
  direct_count integer;
begin
  select count(*) into direct_count from public.project_artifacts;
  if public.load_project_artifact(
    'a8500000-0000-4000-8000-000000000005', 'creator_brief'
  ) <> '{"outcome":"missing"}'::jsonb
    or direct_count <> 0
  then
    raise exception 'REGRESSION: cross-owner Creator Brief load succeeded';
  end if;
end;
$$;

rollback;
