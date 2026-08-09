-- Issue #322 contract fixture. Run after all Project Conversation migrations
-- on both a legacy replay and a fresh schema. This intentionally exercises
-- the authenticated owner -> service completion -> authenticated reload path
-- instead of only inspecting migration source text.

begin;

insert into auth.users (id, is_anonymous)
values
  ('a3221000-0000-4000-8000-000000000001', false),
  ('a3221000-0000-4000-8000-000000000002', false)
on conflict (id) do update set is_anonymous = excluded.is_anonymous;

insert into public.projects (id, workspace_id, name)
select fixture.project_id, workspaces.id, fixture.project_name
from public.workspaces
join (values
  (
    'a3220000-0000-4000-8000-000000000001'::uuid,
    'a3221000-0000-4000-8000-000000000001'::uuid,
    'Assessment owner Project'
  ),
  (
    'a3220000-0000-4000-8000-000000000002'::uuid,
    'a3221000-0000-4000-8000-000000000002'::uuid,
    'Assessment foreign Project'
  )
) as fixture(project_id, owner_id, project_name)
  on fixture.owner_id = workspaces.owner_id;

insert into public.project_source_sets (project_id, revision)
values
  ('a3220000-0000-4000-8000-000000000001', 7),
  ('a3220000-0000-4000-8000-000000000002', 7)
on conflict (project_id) do update set revision = excluded.revision;

-- Two ready sources make the balanced assessment RPC observable: the lexical
-- result can rank one source first, while the wrapper must add a query-relevant
-- segment from the other source to preserve competing positions in the bounded
-- snapshot. Three additional memberships exercise the base search readiness
-- predicates and must never leak into the Evidence Snapshot.
insert into public.videos (
  id, youtube_url, url_hash, title, channel_name, language
)
values
  (
    'a3222000-0000-4000-8000-000000000001',
    'https://www.youtube.com/watch?v=aaaaaaa2201',
    'aaaaaaa2201',
    'April position',
    'Assessment Lab',
    'en'
  ),
  (
    'a3222000-0000-4000-8000-000000000002',
    'https://youtu.be/bbbbbbb2202',
    'bbbbbbb2202',
    '五月观点',
    '研究频道',
    'zh'
  ),
  (
    'a3222000-0000-4000-8000-000000000003',
    'https://example.com/not-a-youtube-video',
    'identity-invalid-a322',
    'Identity unavailable',
    'Assessment Lab',
    'en'
  ),
  (
    'a3222000-0000-4000-8000-000000000004',
    'https://www.youtube.com/watch?v=ccccccc2203',
    'ccccccc2203',
    'Evidence unavailable',
    'Assessment Lab',
    'en'
  ),
  (
    'a3222000-0000-4000-8000-000000000005',
    'https://www.youtube.com/watch?v=ddddddd2204',
    'ddddddd2204',
    'Negative timing',
    'Assessment Lab',
    'en'
  )
on conflict (id) do update set
  youtube_url = excluded.youtube_url,
  url_hash = excluded.url_hash,
  title = excluded.title,
  channel_name = excluded.channel_name,
  language = excluded.language;

insert into public.video_transcripts (
  video_id, transcript_source, language, segments
)
values
  (
    'a3222000-0000-4000-8000-000000000001',
    'manual_captions',
    'en',
    jsonb_build_array(
      jsonb_build_object(
        'text', 'The April AI launch is supported by direct evidence.',
        'start', 42,
        'duration', 5
      ),
      jsonb_build_object(
        'text', 'Another AI launch position from April remains prominent.',
        'start', 50,
        'duration', 5
      ),
      jsonb_build_object(
        'text', 'A third AI launch angle favors April adoption.',
        'start', 60,
        'duration', 5
      )
    )
  ),
  (
    'a3222000-0000-4000-8000-000000000002',
    'manual_captions',
    'zh',
    jsonb_build_array(jsonb_build_object(
      'text', 'AI 发布应优先考虑本地证据，这代表相反的立场。',
      'start', 84,
      'duration', 6
    ))
  ),
  (
    'a3222000-0000-4000-8000-000000000003',
    'manual_captions',
    'en',
    jsonb_build_array(jsonb_build_object(
      'text', 'The AI launch has no canonical identity.',
      'start', 12,
      'duration', 3
    ))
  ),
  (
    'a3222000-0000-4000-8000-000000000004',
    'manual_captions',
    'en',
    jsonb_build_array(jsonb_build_object(
      'text', 'The AI launch lacks durable evidence.',
      'start', 20,
      'duration', 3
    ))
  ),
  (
    'a3222000-0000-4000-8000-000000000005',
    'manual_captions',
    'en',
    jsonb_build_array(jsonb_build_object(
      'text', 'The AI launch timing is negative and invalid.',
      'start', -5,
      'duration', 3
    ))
  )
on conflict (video_id) do update set
  transcript_source = excluded.transcript_source,
  language = excluded.language,
  segments = excluded.segments;

insert into public.summaries (
  video_id, summary, transcript_source, output_language
)
values
  (
    'a3222000-0000-4000-8000-000000000001',
    'April AI launch evidence summary',
    'manual_captions',
    null
  ),
  (
    'a3222000-0000-4000-8000-000000000002',
    '五月观点摘要',
    'manual_captions',
    null
  ),
  (
    'a3222000-0000-4000-8000-000000000003',
    'Identity-invalid launch summary',
    'manual_captions',
    null
  ),
  (
    'a3222000-0000-4000-8000-000000000005',
    'Negative timing launch summary',
    'manual_captions',
    null
  )
on conflict (video_id, output_language) do update set
  summary = excluded.summary,
  transcript_source = excluded.transcript_source;

insert into public.project_videos (
  project_id, video_id, position, status, failure_code, processing_attempt_id
)
values
  (
    'a3220000-0000-4000-8000-000000000001',
    'a3222000-0000-4000-8000-000000000001',
    1, 'ready', null, null
  ),
  (
    'a3220000-0000-4000-8000-000000000001',
    'a3222000-0000-4000-8000-000000000002',
    2, 'ready', null, null
  ),
  (
    'a3220000-0000-4000-8000-000000000001',
    'a3222000-0000-4000-8000-000000000003',
    3, 'ready', null, null
  ),
  (
    'a3220000-0000-4000-8000-000000000001',
    'a3222000-0000-4000-8000-000000000004',
    4, 'ready', null, null
  ),
  (
    'a3220000-0000-4000-8000-000000000001',
    'a3222000-0000-4000-8000-000000000005',
    5, 'ready', null, null
  )
on conflict (project_id, video_id) do update set
  position = excluded.position,
  status = excluded.status,
  failure_code = excluded.failure_code,
  processing_attempt_id = excluded.processing_attempt_id;

do $$
declare
  constraint_definition text;
  start_definition text;
  complete_definition text;
begin
  if to_regclass('public.project_conversation_messages') is null
    or to_regprocedure('public.start_project_grounded_question(uuid,text,uuid,text)') is null
    or to_regprocedure('public.complete_project_grounded_answer(uuid,uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,jsonb,text)') is null
    or to_regprocedure('public.search_project_transcript_passages_balanced(uuid,text,integer)') is null
  then
    raise exception 'REGRESSION: Project Assessment RPC seams are missing';
  end if;

  select pg_get_constraintdef(oid)
  into constraint_definition
  from pg_constraint
  where conrelid = 'public.project_conversation_messages'::regclass
    and conname = 'project_conversation_messages_analysis_mode_check';

  if constraint_definition is null
    or constraint_definition not like '%find_gaps%'
    or constraint_definition not like '%project_assessment%'
  then
    raise exception 'REGRESSION: Project Assessment analysis-mode constraint drifted: %', constraint_definition;
  end if;

  select pg_get_functiondef(to_regprocedure('public.start_project_grounded_question(uuid,text,uuid,text)'))
  into start_definition;
  select pg_get_functiondef(to_regprocedure('public.complete_project_grounded_answer(uuid,uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,jsonb,text)'))
  into complete_definition;

  if start_definition not like '%project_assessment%'
    or complete_definition not like '%project_assessment%'
    or start_definition not like '%raise exception%'
  then
    raise exception 'REGRESSION: Project Assessment mode or atomic reservation contract drifted';
  end if;
end;
$$;

do $$
begin
  if not has_function_privilege(
    'authenticated',
    'public.start_project_grounded_question(uuid,text,uuid,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.search_project_transcript_passages_balanced(uuid,text,integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.start_project_grounded_question(uuid,text,uuid,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'public.start_project_grounded_question(uuid,text,uuid,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.complete_project_grounded_answer(uuid,uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,jsonb,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.complete_project_grounded_answer(uuid,uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,jsonb,text)',
    'EXECUTE'
  ) then
    raise exception 'REGRESSION: Project Assessment RPC grants are not least privilege';
  end if;
end;
$$;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  'a3221000-0000-4000-8000-000000000001',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"a3221000-0000-4000-8000-000000000001","app_metadata":{}}',
  true
);

do $$
declare
  assessment_conversation jsonb;
  gaps_conversation jsonb;
  assessment_start jsonb;
  gaps_start jsonb;
  cancelled_start jsonb;
  invalid_result jsonb;
  loaded_named_only jsonb;
  legacy_start jsonb;
  balanced_result jsonb;
  before_invalid integer;
  after_invalid integer;
begin
  before_invalid := (
    public.list_project_conversations(
      'a3220000-0000-4000-8000-000000000001'
    ) ->> 'messagesUsed'
  )::integer;

  invalid_result := public.start_project_grounded_question(
    'a3220000-0000-4000-8000-000000000001',
    'Unsupported mode',
    null::uuid,
    'external_truth'
  );
  after_invalid := (
    public.list_project_conversations(
      'a3220000-0000-4000-8000-000000000001'
    ) ->> 'messagesUsed'
  )::integer;
  if invalid_result <> '{"outcome":"invalid"}'::jsonb
    or before_invalid <> after_invalid
  then
    raise exception 'REGRESSION: invalid mode reserved a message: %', invalid_result;
  end if;

  assessment_conversation := public.create_project_conversation(
    'a3220000-0000-4000-8000-000000000001', 'Assessment'
  );
  gaps_conversation := public.create_project_conversation(
    'a3220000-0000-4000-8000-000000000001', 'Gaps'
  );
  if assessment_conversation ->> 'outcome' <> 'created'
    or gaps_conversation ->> 'outcome' <> 'created'
  then
    raise exception 'REGRESSION: guided conversation creation failed';
  end if;

  loaded_named_only := public.load_project_conversation(
    'a3220000-0000-4000-8000-000000000001', null::uuid
  );
  if loaded_named_only ->> 'outcome' <> 'ready'
    or (loaded_named_only ->> 'conversationId')::uuid not in (
      (assessment_conversation -> 'conversation' ->> 'id')::uuid,
      (gaps_conversation -> 'conversation' ->> 'id')::uuid
    )
  then
    raise exception 'REGRESSION: named-only compatibility reload lost the active thread: %', loaded_named_only;
  end if;

  assessment_start := public.start_project_grounded_question(
    'a3220000-0000-4000-8000-000000000001',
    'Which launch position is better supported?',
    (assessment_conversation -> 'conversation' ->> 'id')::uuid,
    'project_assessment'
  );
  gaps_start := public.start_project_grounded_question(
    'a3220000-0000-4000-8000-000000000001',
    'Find missing perspectives and unexplored angles.',
    (gaps_conversation -> 'conversation' ->> 'id')::uuid,
    'find_gaps'
  );
  if assessment_start ->> 'outcome' <> 'started'
    or assessment_start ->> 'mode' <> 'project_assessment'
    or gaps_start ->> 'outcome' <> 'started'
    or gaps_start ->> 'mode' <> 'find_gaps'
    or (gaps_start ->> 'messagesUsed')::integer <> 2
  then
    raise exception 'REGRESSION: owner guided starts did not share quota/mode metadata: %, %', assessment_start, gaps_start;
  end if;

  -- Cross-Project and cross-thread ownership are rejected before reservation.
  if public.start_project_grounded_question(
    'a3220000-0000-4000-8000-000000000002',
    'Foreign question',
    (assessment_conversation -> 'conversation' ->> 'id')::uuid,
    'find_gaps'
  ) ->> 'outcome' <> 'missing'
  then
    raise exception 'REGRESSION: cross-owner guided start was accepted';
  end if;

  balanced_result := public.search_project_transcript_passages_balanced(
    'a3220000-0000-4000-8000-000000000001', 'AI', 2
  );
  if balanced_result ->> 'outcome' <> 'ready'
    or jsonb_array_length(balanced_result -> 'passages') <> 2
    or not exists (
      select 1
      from jsonb_array_elements(balanced_result -> 'passages') as item(value)
      where item.value ->> 'text' = 'The April AI launch is supported by direct evidence.'
    )
    or not exists (
      select 1
      from jsonb_array_elements(balanced_result -> 'passages') as item(value)
      where item.value ->> 'text' = 'AI 发布应优先考虑本地证据，这代表相反的立场。'
    )
    or exists (
      select 1
      from jsonb_array_elements(balanced_result -> 'passages') as item(value)
      where item.value ->> 'videoId' in (
        'a3222000-0000-4000-8000-000000000003',
        'a3222000-0000-4000-8000-000000000004',
        'a3222000-0000-4000-8000-000000000005'
      )
    )
    or not exists (
      select 1
      from jsonb_array_elements(balanced_result #> '{coverage,unavailableVideos}') as item(value)
      where item.value ->> 'videoId' = 'a3222000-0000-4000-8000-000000000003'
        and item.value ->> 'failureCode' = 'identity_unavailable'
    )
    or not exists (
      select 1
      from jsonb_array_elements(balanced_result #> '{coverage,unavailableVideos}') as item(value)
      where item.value ->> 'videoId' = 'a3222000-0000-4000-8000-000000000004'
        and item.value ->> 'failureCode' = 'evidence_unavailable'
    )
    or not exists (
      select 1
      from jsonb_array_elements(balanced_result #> '{coverage,unavailableVideos}') as item(value)
      where item.value ->> 'videoId' = 'a3222000-0000-4000-8000-000000000005'
        and item.value ->> 'failureCode' = 'evidence_unavailable'
    )
  then
    raise exception 'REGRESSION: balanced assessment retrieval dropped a competing source: %', balanced_result;
  end if;

  cancelled_start := public.start_project_grounded_question(
    'a3220000-0000-4000-8000-000000000001',
    'Cancel this guided attempt',
    (gaps_conversation -> 'conversation' ->> 'id')::uuid,
    'find_gaps'
  );
  if public.cancel_project_grounded_question(
    'a3220000-0000-4000-8000-000000000001',
    (cancelled_start ->> 'userMessageId')::uuid
  ) ->> 'outcome' <> 'cancelled'
  then
    raise exception 'REGRESSION: guided cancellation failed';
  end if;

  -- The legacy two-argument seam must create/select the distinguishable
  -- default row, not one of the named threads.
  legacy_start := public.start_project_grounded_question(
    'a3220000-0000-4000-8000-000000000001',
    'Legacy compatibility question'
  );
  if legacy_start ->> 'outcome' <> 'started'
    or (legacy_start ->> 'conversationId')::uuid in (
      (assessment_conversation -> 'conversation' ->> 'id')::uuid,
      (gaps_conversation -> 'conversation' ->> 'id')::uuid
    )
  then
    raise exception 'REGRESSION: legacy default seam selected a named thread: %', legacy_start;
  end if;

  perform pg_catalog.set_config(
    'issue322.assessment_conversation_id',
    assessment_conversation -> 'conversation' ->> 'id',
    false
  );
  perform pg_catalog.set_config(
    'issue322.assessment_user_message_id',
    assessment_start ->> 'userMessageId',
    false
  );
  perform pg_catalog.set_config(
    'issue322.assessment_attempt_token',
    assessment_start ->> 'attemptToken',
    false
  );
  perform pg_catalog.set_config(
    'issue322.gaps_conversation_id',
    gaps_conversation -> 'conversation' ->> 'id',
    false
  );
  perform pg_catalog.set_config(
    'issue322.gaps_user_message_id',
    gaps_start ->> 'userMessageId',
    false
  );
  perform pg_catalog.set_config(
    'issue322.gaps_attempt_token',
    gaps_start ->> 'attemptToken',
    false
  );
end;
$$;

reset role;
set local role service_role;

do $$
declare
  owner_id uuid := 'a3221000-0000-4000-8000-000000000001';
  project_id uuid := 'a3220000-0000-4000-8000-000000000001';
  assessment_result jsonb;
  gaps_result jsonb;
  cross_owner_result jsonb;
  stale_revision_result jsonb;
  manifest jsonb := jsonb_build_object(
    'projectId', project_id,
    'sourceSetRevision', 7,
    'sources', '[]'::jsonb
  );
  coverage jsonb := jsonb_build_object(
    'totalVideos', 0,
    'readyVideos', 0,
    'evidenceVideos', 0,
    'unavailableVideos', '[]'::jsonb,
    'passagesExamined', 0,
    'evidencePassages', 0
  );
  snapshot jsonb := jsonb_build_object(
    'projectId', project_id,
    'sourceSetRevision', 7,
    'passages', '[]'::jsonb
  );
begin
  stale_revision_result := public.complete_project_grounded_answer(
    owner_id,
    project_id,
    current_setting('issue322.assessment_conversation_id')::uuid,
    current_setting('issue322.assessment_user_message_id')::uuid,
    current_setting('issue322.assessment_attempt_token')::uuid,
    'Stale revision assessment',
    'unsupported',
    8,
    jsonb_set(manifest, '{sourceSetRevision}', '8'::jsonb),
    coverage,
    jsonb_set(snapshot, '{sourceSetRevision}', '8'::jsonb),
    '[]'::jsonb,
    'project_assessment'
  );
  if stale_revision_result <> '{"outcome":"stale"}'::jsonb then
    raise exception 'REGRESSION: stale Source Set revision was accepted: %', stale_revision_result;
  end if;

  cross_owner_result := public.complete_project_grounded_answer(
    'a3221000-0000-4000-8000-000000000002',
    project_id,
    current_setting('issue322.assessment_conversation_id')::uuid,
    current_setting('issue322.assessment_user_message_id')::uuid,
    current_setting('issue322.assessment_attempt_token')::uuid,
    'Cross-owner assessment',
    'unsupported',
    7,
    manifest,
    coverage,
    snapshot,
    '[]'::jsonb,
    'project_assessment'
  );
  if cross_owner_result <> '{"outcome":"stale"}'::jsonb then
    raise exception 'REGRESSION: cross-owner completion was accepted: %', cross_owner_result;
  end if;

  assessment_result := public.complete_project_grounded_answer(
    owner_id,
    project_id,
    current_setting('issue322.assessment_conversation_id')::uuid,
    current_setting('issue322.assessment_user_message_id')::uuid,
    current_setting('issue322.assessment_attempt_token')::uuid,
    'Project Assessment\n\nCompeting positions\nBoth positions remain represented.\n\nCriteria\nDirectness and corroboration.\n\nConfidence: low',
    'unsupported',
    7,
    manifest,
    coverage,
    snapshot,
    '[]'::jsonb,
    'project_assessment'
  );
  gaps_result := public.complete_project_grounded_answer(
    owner_id,
    project_id,
    current_setting('issue322.gaps_conversation_id')::uuid,
    current_setting('issue322.gaps_user_message_id')::uuid,
    current_setting('issue322.gaps_attempt_token')::uuid,
    'Source-supported observations\n\nNo supported gap is established.\n\nProposed questions and creative opportunities\nWhat evidence would test this?',
    'unsupported',
    7,
    manifest,
    coverage,
    snapshot,
    '[]'::jsonb,
    'find_gaps'
  );
  if assessment_result ->> 'outcome' <> 'completed'
    or gaps_result ->> 'outcome' <> 'completed'
  then
    raise exception 'REGRESSION: service completion failed for both modes: %, %', assessment_result, gaps_result;
  end if;
end;
$$;

reset role;
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  'a3221000-0000-4000-8000-000000000001',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"a3221000-0000-4000-8000-000000000001","app_metadata":{}}',
  true
);

do $$
declare
  assessment_loaded jsonb;
  gaps_loaded jsonb;
  listed jsonb;
  cleared jsonb;
begin
  assessment_loaded := public.load_project_conversation(
    'a3220000-0000-4000-8000-000000000001',
    current_setting('issue322.assessment_conversation_id')::uuid
  );
  gaps_loaded := public.load_project_conversation(
    'a3220000-0000-4000-8000-000000000001',
    current_setting('issue322.gaps_conversation_id')::uuid
  );
  if assessment_loaded ->> 'outcome' <> 'ready'
    or gaps_loaded ->> 'outcome' <> 'ready'
    or not exists (
      select 1
      from jsonb_array_elements(assessment_loaded -> 'messages') as item(value)
      where item.value ->> 'mode' = 'project_assessment'
        and item.value ->> 'role' = 'assistant'
        and item.value ? 'evidenceSnapshot'
    )
    or not exists (
      select 1
      from jsonb_array_elements(gaps_loaded -> 'messages') as item(value)
      where item.value ->> 'mode' = 'find_gaps'
        and item.value ->> 'role' = 'assistant'
        and item.value ? 'evidenceSnapshot'
    )
  then
    raise exception 'REGRESSION: owner reload lost mode or Evidence Snapshot metadata: %, %', assessment_loaded, gaps_loaded;
  end if;

  listed := public.list_project_conversations(
    'a3220000-0000-4000-8000-000000000001'
  );
  if listed ->> 'outcome' <> 'ready'
    or (listed ->> 'messagesUsed')::integer <> 4
    or jsonb_array_length(listed -> 'conversations') <> 3
  then
    raise exception 'REGRESSION: list did not preserve shared quota across modes/default: %', listed;
  end if;

  cleared := public.clear_project_conversation(
    'a3220000-0000-4000-8000-000000000001',
    current_setting('issue322.gaps_conversation_id')::uuid
  );
  gaps_loaded := public.load_project_conversation(
    'a3220000-0000-4000-8000-000000000001',
    current_setting('issue322.gaps_conversation_id')::uuid
  );
  listed := public.list_project_conversations(
    'a3220000-0000-4000-8000-000000000001'
  );
  if cleared ->> 'outcome' <> 'cleared'
    or jsonb_array_length(gaps_loaded -> 'messages') <> 0
    or (listed ->> 'messagesUsed')::integer <> 4
  then
    raise exception 'REGRESSION: clear reset durable quota or visible boundary: %, %, %', cleared, gaps_loaded, listed;
  end if;

  if public.load_project_conversation(
    'a3220000-0000-4000-8000-000000000002',
    current_setting('issue322.assessment_conversation_id')::uuid
  ) ->> 'outcome' <> 'missing'
  then
    raise exception 'REGRESSION: cross-owner reload was visible';
  end if;
end;
$$;

rollback;
