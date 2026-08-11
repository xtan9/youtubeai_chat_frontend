-- Issue #321 contract fixture. Run after the Project Conversation migrations
-- on both a legacy replay and a fresh schema.

begin;

do $$
declare
  mode_default text;
begin
  if to_regclass('public.project_conversation_messages') is null
    or to_regprocedure('public.start_project_grounded_question(uuid,text,uuid,text)') is null
    or to_regprocedure('public.complete_project_grounded_answer(uuid,uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,jsonb,text)') is null
  then
    raise exception 'REGRESSION: guided Project Conversation RPC seams are missing';
  end if;

  select column_default
  into mode_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'project_conversation_messages'
    and column_name = 'analysis_mode';

  if mode_default <> '''question''::text' then
    raise exception 'REGRESSION: guided mode default drifted: %', mode_default;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.project_conversation_messages'::regclass
      and conname = 'project_conversation_messages_analysis_mode_check'
  ) then
    raise exception 'REGRESSION: guided mode constraint is missing';
  end if;
end;
$$;

insert into auth.users (id, is_anonymous)
values ('97000000-0000-4000-8000-000000000007', false);

insert into public.projects (id, workspace_id, name)
select 'a7000000-0000-4000-8000-000000000007', id, 'Guided synthesis evidence'
from public.workspaces
where owner_id = '97000000-0000-4000-8000-000000000007';

insert into public.project_source_sets (project_id, revision)
values ('a7000000-0000-4000-8000-000000000007', 2);

insert into public.videos (
  id, youtube_url, url_hash, title, channel_name, language
) values
  (
    '77000000-0000-4000-8000-000000000001',
    'https://www.youtube.com/watch?v=ggggggg0001',
    'guided-source-1', 'April viewpoint', 'Channel one', 'en'
  ),
  (
    '77000000-0000-4000-8000-000000000002',
    'https://www.youtube.com/watch?v=ggggggg0002',
    'guided-source-2', 'May viewpoint', 'Channel two', 'zh'
  );

insert into public.video_transcripts (
  video_id, transcript_source, language, segments
) values
  (
    '77000000-0000-4000-8000-000000000001', 'manual_captions', 'en',
    '[{"text":"Source one favors an April launch.","start":5,"duration":3}]'
  ),
  (
    '77000000-0000-4000-8000-000000000002', 'manual_captions', 'zh',
    '[{"text":"第二个来源更喜欢五月发布。","start":9,"duration":4}]'
  );

insert into public.summaries (
  video_id, summary, transcript_source, output_language
) values
  (
    '77000000-0000-4000-8000-000000000001',
    'April viewpoint ready', 'manual_captions', null
  ),
  (
    '77000000-0000-4000-8000-000000000002',
    'May viewpoint ready', 'manual_captions', null
  );

insert into public.project_videos (project_id, video_id, position, status)
values
  (
    'a7000000-0000-4000-8000-000000000007',
    '77000000-0000-4000-8000-000000000001', 1, 'ready'
  ),
  (
    'a7000000-0000-4000-8000-000000000007',
    '77000000-0000-4000-8000-000000000002', 2, 'ready'
  );

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','97000000-0000-4000-8000-000000000007',true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000007","is_anonymous":false,"app_metadata":{"project_beta_access":"internal"}}',
  true
);
do $$
declare
  result jsonb;
begin
  result := public.start_project_grounded_question_v2(
    'a7000000-0000-4000-8000-000000000007',
    'c7000000-0000-4000-8000-000000000001',
    'Compare the multilingual viewpoints.', null, 'compare_viewpoints'
  );
  perform pg_catalog.set_config(
    'issue318_guided.conversation', result ->> 'conversationId', false
  );
  perform pg_catalog.set_config(
    'issue318_guided.compare_token', result ->> 'attemptToken', false
  );
  result := public.start_project_grounded_question_v2(
    'a7000000-0000-4000-8000-000000000007',
    'c7000000-0000-4000-8000-000000000002',
    'Find common themes without inventing consensus.',
    current_setting('issue318_guided.conversation')::uuid,
    'common_themes'
  );
  perform pg_catalog.set_config(
    'issue318_guided.themes_token', result ->> 'attemptToken', false
  );
  result := public.start_project_grounded_question_v2(
    'a7000000-0000-4000-8000-000000000007',
    'c7000000-0000-4000-8000-000000000003',
    'Find a source-supported gap.',
    current_setting('issue318_guided.conversation')::uuid,
    'find_gaps'
  );
  perform pg_catalog.set_config(
    'issue318_guided.gaps_token', result ->> 'attemptToken', false
  );
  result := public.start_project_grounded_question_v2(
    'a7000000-0000-4000-8000-000000000007',
    'c7000000-0000-4000-8000-000000000004',
    'Assess which position has stronger support.',
    current_setting('issue318_guided.conversation')::uuid,
    'project_assessment'
  );
  perform pg_catalog.set_config(
    'issue318_guided.assessment_token', result ->> 'attemptToken', false
  );
end;
$$;
reset role;

set local role service_role;
do $$
declare
  conversation_id uuid := current_setting('issue318_guided.conversation')::uuid;
  manifest_one jsonb := '{
    "projectId":"a7000000-0000-4000-8000-000000000007",
    "sourceSetRevision":2,
    "sources":[{
      "sourceId":"S1",
      "videoId":"77000000-0000-4000-8000-000000000001",
      "youtubeVideoId":"ggggggg0001",
      "title":"April viewpoint","channelName":"Channel one",
      "passages":[{
        "passageId":"77000000-0000-4000-8000-000000000001:1:0:34",
        "startSeconds":5,"endSeconds":8
      }]
    }]
  }'::jsonb;
  snapshot_one jsonb := '{
    "projectId":"a7000000-0000-4000-8000-000000000007",
    "sourceSetRevision":2,
    "passages":[{
      "passageId":"77000000-0000-4000-8000-000000000001:1:0:34",
      "videoId":"77000000-0000-4000-8000-000000000001",
      "youtubeVideoId":"ggggggg0001",
      "title":"April viewpoint","channelName":"Channel one",
      "text":"Source one favors an April launch.",
      "segmentOrdinal":1,"excerptStartCharacter":0,"excerptEndCharacter":34,
      "startSeconds":5,"endSeconds":8,"language":"en",
      "truncatedStart":false,"truncatedEnd":false
    }]
  }'::jsonb;
  manifest_two jsonb;
  snapshot_two jsonb;
  coverage_one jsonb := '{
    "totalVideos":2,"readyVideos":2,"usedVideos":1,
    "unavailableVideos":[],"passagesExamined":2,"passagesUsed":1
  }'::jsonb;
  coverage_two jsonb := '{
    "totalVideos":2,"readyVideos":2,"usedVideos":2,
    "unavailableVideos":[],"passagesExamined":2,"passagesUsed":2
  }'::jsonb;
  result jsonb;
  guided_mode text;
  question_id uuid;
  attempt_token uuid;
  guided_modes text[] := array[
    'compare_viewpoints',
    'common_themes',
    'find_gaps',
    'project_assessment'
  ];
  question_ids uuid[] := array[
    'c7000000-0000-4000-8000-000000000001'::uuid,
    'c7000000-0000-4000-8000-000000000002'::uuid,
    'c7000000-0000-4000-8000-000000000003'::uuid,
    'c7000000-0000-4000-8000-000000000004'::uuid
  ];
  attempt_tokens uuid[];
  mode_index integer;
begin
  manifest_two := pg_catalog.jsonb_set(
    manifest_one,
    '{sources}',
    manifest_one -> 'sources' || '{
      "sourceId":"S2",
      "videoId":"77000000-0000-4000-8000-000000000002",
      "youtubeVideoId":"ggggggg0002",
      "title":"May viewpoint","channelName":"Channel two",
      "passages":[{
        "passageId":"77000000-0000-4000-8000-000000000002:1:0:13",
        "startSeconds":9,"endSeconds":13
      }]
    }'::jsonb
  );
  snapshot_two := pg_catalog.jsonb_set(
    snapshot_one,
    '{passages}',
    snapshot_one -> 'passages' || '{
      "passageId":"77000000-0000-4000-8000-000000000002:1:0:13",
      "videoId":"77000000-0000-4000-8000-000000000002",
      "youtubeVideoId":"ggggggg0002",
      "title":"May viewpoint","channelName":"Channel two",
      "text":"第二个来源更喜欢五月发布。",
      "segmentOrdinal":1,"excerptStartCharacter":0,"excerptEndCharacter":13,
      "startSeconds":9,"endSeconds":13,"language":"zh",
      "truncatedStart":false,"truncatedEnd":false
    }'::jsonb
  );

  attempt_tokens := array[
    current_setting('issue318_guided.compare_token')::uuid,
    current_setting('issue318_guided.themes_token')::uuid,
    current_setting('issue318_guided.gaps_token')::uuid,
    current_setting('issue318_guided.assessment_token')::uuid
  ];
  for mode_index in 1..4 loop
    guided_mode := guided_modes[mode_index];
    question_id := question_ids[mode_index];
    attempt_token := attempt_tokens[mode_index];
    result := public.complete_project_grounded_answer_v2(
      '97000000-0000-4000-8000-000000000007',
      'a7000000-0000-4000-8000-000000000007',
      conversation_id, question_id, attempt_token,
      'One-source claim [S1 @ 00:05].', 'supported', 2,
      manifest_one, coverage_one, snapshot_one, guided_mode
    );
    if guided_mode = 'find_gaps' then
      if result ->> 'outcome' <> 'completed'
        or result ->> 'answerClassification' <> 'supported'
      then
        raise exception 'REGRESSION: one-source gap completion failed: %', result;
      end if;
      continue;
    elsif result <> '{"outcome":"invalid"}'::jsonb then
      raise exception 'REGRESSION: one-source guided completion succeeded: %, %',
        guided_mode, result;
    end if;

    result := public.complete_project_grounded_answer_v2(
      '97000000-0000-4000-8000-000000000007',
      'a7000000-0000-4000-8000-000000000007',
      conversation_id, question_id, attempt_token,
      'April and mayo differ [S1 @ 00:05] [S2 @ 00:09].',
      'supported', 2, manifest_two, coverage_two, snapshot_two, guided_mode
    );
    if result ->> 'outcome' <> 'completed'
      or result ->> 'answerClassification' <> 'supported'
    then
      raise exception 'REGRESSION: two-source guided completion failed: %, %',
        guided_mode, result;
    end if;
  end loop;
end;
$$;

rollback;
