-- Contract test for owned default Project Conversations, atomic Free message
-- accounting, opaque attempts, and service-only terminal Grounded Answers.
-- Run after both legacy and fresh migration replays.

begin;

insert into auth.users (id, is_anonymous)
values
  ('91000000-0000-4000-8000-000000000001', false),
  ('92000000-0000-4000-8000-000000000002', false),
  ('93000000-0000-4000-8000-000000000003', false);

insert into public.user_subscriptions (
  user_id,
  stripe_customer_id,
  tier,
  status
)
values (
  '92000000-0000-4000-8000-000000000002',
  'cus_project_grounded_answer_pro',
  'pro',
  'active'
);

insert into public.projects (id, workspace_id, name, goal)
select fixture.project_id, workspaces.id, fixture.name, fixture.goal
from public.workspaces
join (values
  (
    'a1000000-0000-4000-8000-000000000001'::uuid,
    '91000000-0000-4000-8000-000000000001'::uuid,
    'Free evidence Project',
    'Goal guidance is not evidence'
  ),
  (
    'a2000000-0000-4000-8000-000000000002'::uuid,
    '92000000-0000-4000-8000-000000000002'::uuid,
    'Pro evidence Project',
    null
  ),
  (
    'a3000000-0000-4000-8000-000000000003'::uuid,
    '93000000-0000-4000-8000-000000000003'::uuid,
    'Foreign evidence Project',
    null
  ),
  (
    'a5000000-0000-4000-8000-000000000005'::uuid,
    '92000000-0000-4000-8000-000000000002'::uuid,
    'Canonical identity fixture Project',
    null
  )
) as fixture(project_id, owner_id, name, goal)
  on fixture.owner_id = workspaces.owner_id;

insert into public.project_source_sets (project_id, revision)
values
  ('a1000000-0000-4000-8000-000000000001', 3),
  ('a2000000-0000-4000-8000-000000000002', 3),
  ('a3000000-0000-4000-8000-000000000003', 3),
  ('a5000000-0000-4000-8000-000000000005', 3)
on conflict (project_id) do update set revision = excluded.revision;

insert into public.videos (
  id, youtube_url, url_hash, title, channel_name, language
) values
  (
    '71000000-0000-4000-8000-000000000001',
    'https://www.youtube.com/watch?v=aaaaaaa0001',
    'aaaaaaa0001', 'Evidence title', 'Evidence channel', 'en'
  ),
  (
    '72000000-0000-4000-8000-000000000002',
    'https://www.youtube.com/watch?v=zzzzzzz0002',
    'zzzzzzz0002', 'Evidence missing', null, 'en'
  ),
  (
    '72000000-0000-4000-8000-000000000003',
    'https://www.youtube.com/watch?v=bbbbbbb0002',
    'bbbbbbb0002', 'Evidence unavailable', null, 'en'
  ),
  (
    '73000000-0000-4000-8000-000000000003',
    'https://www.youtube.com/watch?v=ccccccc0003',
    'ccccccc0003', 'Foreign title', 'Foreign channel', 'en'
  ),
  (
    '75000000-0000-4000-8000-000000000001',
    'https://www.youtube.com/shorts/shorts00001',
    pg_catalog.repeat('a', 64), 'Legacy Shorts', null, 'en'
  ),
  (
    '75000000-0000-4000-8000-000000000002',
    'https://m.youtube.com/embed/embed000001',
    pg_catalog.repeat('b', 64), 'Legacy Embed', null, 'en'
  ),
  (
    '75000000-0000-4000-8000-000000000003',
    'https://music.youtube.com/live/live0000001',
    pg_catalog.repeat('c', 64), 'Legacy Live', null, 'en'
  );

insert into public.video_transcripts (
  video_id, transcript_source, language, segments
) values
  (
    '71000000-0000-4000-8000-000000000001',
    'manual_captions', 'en',
    '[
      {"text":"The source says the launch happened in April.","start":42,"duration":16},
      {"text":"Null duration is not usable evidence.","start":70,"duration":null}
    ]'
  ),
  (
    '72000000-0000-4000-8000-000000000003',
    'manual_captions', 'en',
    '[{"text":"Negative timing is not searchable evidence.","start":-1,"duration":4}]'
  ),
  (
    '73000000-0000-4000-8000-000000000003',
    'manual_captions', 'en',
    '[{"text":"Foreign evidence must not cross the Project boundary.","start":9,"duration":4}]'
  ),
  (
    '75000000-0000-4000-8000-000000000001',
    'manual_captions', 'en',
    '[{"text":"Shorts evidence is canonical.","start":1,"duration":2}]'
  ),
  (
    '75000000-0000-4000-8000-000000000002',
    'manual_captions', 'en',
    '[{"text":"Embed evidence is canonical.","start":2,"duration":2}]'
  ),
  (
    '75000000-0000-4000-8000-000000000003',
    'manual_captions', 'en',
    '[{"text":"Live evidence is canonical.","start":3,"duration":2}]'
  );

insert into public.summaries (video_id, summary, transcript_source, output_language)
values
  (
    '71000000-0000-4000-8000-000000000001',
    'Ready evidence', 'manual_captions', null
  ),
  (
    '72000000-0000-4000-8000-000000000003',
    'Durable but negative-timed evidence', 'manual_captions', null
  ),
  (
    '73000000-0000-4000-8000-000000000003',
    'Foreign ready evidence', 'manual_captions', null
  ),
  (
    '75000000-0000-4000-8000-000000000001',
    'Canonical Shorts evidence', 'manual_captions', null
  ),
  (
    '75000000-0000-4000-8000-000000000002',
    'Canonical Embed evidence', 'manual_captions', null
  ),
  (
    '75000000-0000-4000-8000-000000000003',
    'Canonical Live evidence', 'manual_captions', null
  );

insert into public.project_videos (project_id, video_id, position, status)
values
  (
    'a1000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001', 1, 'ready'
  ),
  (
    'a1000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000002', 2, 'ready'
  ),
  (
    'a1000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000003', 3, 'ready'
  ),
  (
    'a3000000-0000-4000-8000-000000000003',
    '73000000-0000-4000-8000-000000000003', 1, 'ready'
  ),
  (
    'a5000000-0000-4000-8000-000000000005',
    '75000000-0000-4000-8000-000000000001', 1, 'ready'
  ),
  (
    'a5000000-0000-4000-8000-000000000005',
    '75000000-0000-4000-8000-000000000002', 2, 'ready'
  ),
  (
    'a5000000-0000-4000-8000-000000000005',
    '75000000-0000-4000-8000-000000000003', 3, 'ready'
  );

do $$
declare canonical_ids text[];
begin
  select pg_catalog.array_agg(distinct youtube_video_id order by youtube_video_id)
  into canonical_ids
  from project_private.project_grounded_live_source_projection_v2(
    'a5000000-0000-4000-8000-000000000005'
  );
  if canonical_ids is distinct from array[
    'embed000001','live0000001','shorts00001'
  ]::text[] then
    raise exception 'REGRESSION: Grounded projection re-derived legacy identity: %',
      canonical_ids;
  end if;
end;
$$;

do $$
begin
  if not has_function_privilege(
    'authenticated',
    'public.start_project_grounded_question(uuid,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.load_default_project_conversation(uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.cancel_project_grounded_question(uuid,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.start_project_grounded_question_v2(uuid,uuid,text,uuid,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.load_project_conversation_page_v2(uuid,uuid,timestamptz,uuid,integer)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.load_project_grounded_attempt_v2(uuid,uuid,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.load_project_source_set_event_page_v2(uuid,timestamptz,uuid,integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.load_project_source_set_event_page_v2(uuid,timestamptz,uuid,integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'public.load_project_source_set_event_page_v2(uuid,timestamptz,uuid,integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.start_project_grounded_question(uuid,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'public.start_project_grounded_question(uuid,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.complete_project_grounded_answer_v2(uuid,uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.complete_project_grounded_answer_v2(uuid,uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.cancel_project_grounded_question_v2(uuid,uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.cancel_project_grounded_question_v2(uuid,uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'project_private.project_grounded_citation_analysis_v2(text,jsonb)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'project_private.project_grounded_citation_analysis_v2(text,jsonb)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'project_private.touch_video_evidence_version_v2()',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'project_private.touch_video_evidence_version_v2()',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.begin_project_grounded_answer_persistence_v2(uuid,uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.begin_project_grounded_answer_persistence_v2(uuid,uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,text)',
    'EXECUTE'
  ) then
    raise exception 'REGRESSION: Project Conversation RPC grants are not least privilege';
  end if;

  if pg_catalog.to_regprocedure(
      'public.complete_project_grounded_answer(uuid,uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,jsonb)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.cancel_project_grounded_question(uuid,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.load_default_project_conversation(uuid)'
    ) is null
  then
    raise exception 'REGRESSION: deployed Project Conversation signature was removed';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_trigger
    where not tgisinternal
      and tgname in (
        'video_transcripts_evidence_version',
        'summaries_video_evidence_version',
        'videos_evidence_version'
      )
  ) <> 3 then
    raise exception 'REGRESSION: canonical evidence-version triggers are incomplete';
  end if;

  if pg_catalog.to_regclass(
      'public.project_conversation_messages_reserved_lease_idx'
    ) is null
    or pg_catalog.strpos(
      pg_catalog.pg_get_indexdef(
        'public.project_conversation_messages_reserved_lease_idx'::regclass
      ),
      '(conversation_id, lease_expires_at, created_at, id)'
    ) = 0
    or not exists (
      select 1
      from pg_catalog.pg_index as indexes
      where indexes.indexrelid =
          'public.project_conversation_messages_reserved_lease_idx'::regclass
        and pg_catalog.pg_get_expr(
          indexes.indpred,
          indexes.indrelid
        ) = '((role = ''user''::text) AND (completion_state = ''reserved''::text))'
    )
    or has_function_privilege(
      'authenticated',
      'project_private.reap_expired_project_grounded_attempts_v2(uuid)',
      'EXECUTE'
    )
    or has_function_privilege(
      'service_role',
      'project_private.reap_expired_project_grounded_attempts_v2(uuid)',
      'EXECUTE'
    )
    or pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        'public.load_project_conversation_page_v2(uuid,uuid,timestamptz,uuid,integer)'::regprocedure
      ),
      'reap_expired_project_grounded_attempts_v2'
    ) = 0
    or pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        'public.load_project_grounded_attempt_v2(uuid,uuid,uuid)'::regprocedure
      ),
      'reap_expired_project_grounded_attempts_v2'
    ) = 0
  then
    raise exception 'REGRESSION: indexed shared stale-attempt reaper drifted';
  end if;

  if has_table_privilege('authenticated', 'public.project_conversations', 'SELECT')
    or has_table_privilege('authenticated', 'public.project_conversations', 'INSERT')
    or has_table_privilege('authenticated', 'public.project_conversation_messages', 'SELECT')
    or has_table_privilege('authenticated', 'public.project_conversation_messages', 'INSERT')
    or has_table_privilege('service_role', 'public.project_conversations', 'SELECT')
    or has_table_privilege('service_role', 'public.project_conversation_messages', 'INSERT')
  then
    raise exception 'REGRESSION: direct Project Conversation table access is exposed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class
    where oid = 'public.project_conversations'::regclass
      and relrowsecurity
  ) or not exists (
    select 1
    from pg_catalog.pg_class
    where oid = 'public.project_conversation_messages'::regclass
      and relrowsecurity
  ) then
    raise exception 'REGRESSION: Project Conversation RLS is disabled';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc
    where oid = 'public.complete_project_grounded_answer_v2(uuid,uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,text)'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=""']
  ) then
    raise exception 'REGRESSION: completion RPC is not hardened';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc
    where oid = 'public.cancel_project_grounded_question_v2(uuid,uuid,uuid,uuid,uuid)'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=""']
  ) then
    raise exception 'REGRESSION: cancellation RPC is not hardened';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc
    where oid = 'public.begin_project_grounded_answer_persistence_v2(uuid,uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,text)'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=""']
  ) then
    raise exception 'REGRESSION: begin-persistence RPC is not hardened';
  end if;
end;
$$;

do $$
declare
  coverage jsonb;
begin
  select source_coverage
  into coverage
  from public.project_conversation_messages
  where id = 'e4000000-0000-4000-8000-000000000004';
  if coverage is null
    or not coverage ? 'evidenceVideos'
    or not coverage ? 'evidencePassages'
    or coverage ? 'usedVideos'
    or coverage ? 'passagesUsed'
  then
    raise exception 'REGRESSION: deployed answer coverage was rewritten in place: %',
      coverage;
  end if;
end;
$$;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '94000000-0000-4000-8000-000000000004',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"94000000-0000-4000-8000-000000000004","app_metadata":{}}',
  true
);

do $$
declare
  deployed_loaded jsonb;
  loaded jsonb;
begin
  deployed_loaded := public.load_default_project_conversation(
    'a4000000-0000-4000-8000-000000000004'
  );
  if deployed_loaded ->> 'outcome' <> 'ready'
    or pg_catalog.jsonb_array_length(deployed_loaded -> 'messages') <> 2
    or deployed_loaded #>> '{messages,1,sourceCoverage,evidenceVideos}' <> '0'
  then
    raise exception 'REGRESSION: deployed loader no longer reads old rows: %',
      deployed_loaded;
  end if;

  loaded := public.load_project_conversation_page_v2(
    'a4000000-0000-4000-8000-000000000004', null, null, null, 25
  );
  if loaded ->> 'outcome' <> 'ready'
    or pg_catalog.jsonb_array_length(loaded -> 'messages') <> 2
    or loaded #>> '{messages,1,content}'
      <> 'Legacy unsupported answer; malformed [S9 at 00:10] stays plain.'
    or loaded #>> '{messages,1,citationDiagnostics,0,raw}'
      <> '[S9 at 00:10]'
    or loaded #>> '{messages,1,sourceCoverage,usedVideos}' <> '0'
  then
    raise exception 'REGRESSION: normalized deployed answer did not reload: %',
      loaded;
  end if;
end;
$$;

reset role;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000001',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000001","app_metadata":{}}',
  true
);

do $$
declare
  result jsonb;
  first_result jsonb;
  second_result jsonb;
  third_result jsonb;
  fourth_result jsonb;
  search_result jsonb;
  missing_foreign jsonb;
  missing_unknown jsonb;
  index integer;
  direct_access_denied boolean := false;
  completion_denied boolean := false;
begin
  search_result := public.search_project_transcript_passages(
    'a1000000-0000-4000-8000-000000000001',
    'launch',
    8
  );
  if search_result ->> 'outcome' <> 'ready'
    or search_result -> 'coverage' is distinct from '{
      "totalVideos":3,
      "readyVideos":2,
      "unavailableVideos":[
        {
          "videoId":"72000000-0000-4000-8000-000000000002",
          "youtubeVideoId":"zzzzzzz0002",
          "title":"Evidence missing",
          "channelName":null,
          "status":"unavailable",
          "failureCode":"evidence_unavailable"
        }
      ],
      "passagesExamined":1
    }'::jsonb
  then
    raise exception 'REGRESSION: completion readiness diverged from #317: %',
      search_result;
  end if;

  for index in 1..5 loop
    result := public.start_project_grounded_question(
      'a1000000-0000-4000-8000-000000000001',
      'Question ' || index::text
    );
    if result ->> 'outcome' <> 'started'
      or (result ->> 'messagesUsed')::integer <> index
      or (result ->> 'messagesLimit')::integer <> 5
      or result ->> 'tier' <> 'free'
      or result ->> 'attemptToken' is null
    then
      raise exception 'REGRESSION: Free start result drifted at %: %', index, result;
    end if;
    if index = 1 then
      first_result := result;
    elsif index = 2 then
      second_result := result;
    elsif index = 3 then
      third_result := result;
    elsif index = 4 then
      fourth_result := result;
    end if;
  end loop;

  result := public.start_project_grounded_question(
    'a1000000-0000-4000-8000-000000000001',
    'Sixth question'
  );
  if result <> '{
    "outcome":"limit_reached",
    "messagesUsed":5,
    "messagesLimit":5,
    "tier":"free"
  }'::jsonb then
    raise exception 'REGRESSION: sixth Free question was not rejected: %', result;
  end if;

  result := public.load_default_project_conversation(
    'a1000000-0000-4000-8000-000000000001'
  );
  if result ->> 'outcome' <> 'ready'
    or (result ->> 'messagesUsed')::integer <> 5
    or pg_catalog.jsonb_array_length(result -> 'messages') <> 5
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(result -> 'messages') as loaded(message)
      where loaded.message ? 'attemptToken'
        or loaded.message ? 'evidenceSnapshot'
    )
  then
    raise exception 'REGRESSION: bounded owner load leaked hidden artifacts: %', result;
  end if;

  missing_foreign := public.load_default_project_conversation(
    'a3000000-0000-4000-8000-000000000003'
  );
  missing_unknown := public.load_default_project_conversation(
    'afffffff-ffff-4fff-8fff-ffffffffffff'
  );
  if missing_foreign <> '{"outcome":"missing"}'::jsonb
    or missing_unknown is distinct from missing_foreign
    or public.start_project_grounded_question(
      'a3000000-0000-4000-8000-000000000003',
      'Foreign question'
    ) is distinct from missing_foreign
  then
    raise exception 'REGRESSION: foreign/nonexistent Conversation outcomes differ';
  end if;

  begin
    perform count(*) from public.project_conversation_messages;
  exception
    when insufficient_privilege then
      direct_access_denied := true;
  end;
  if not direct_access_denied then
    raise exception 'REGRESSION: authenticated direct message read succeeded';
  end if;

  begin
    perform public.complete_project_grounded_answer_v2(
      '91000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',
      (first_result ->> 'conversationId')::uuid,
      (first_result ->> 'userMessageId')::uuid,
      (first_result ->> 'attemptToken')::uuid,
      'Forged answer',
      'supported',
      3,
      '{}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb
    );
  exception
    when insufficient_privilege then
      completion_denied := true;
  end;
  if not completion_denied then
    raise exception 'REGRESSION: authenticated completion call was executable';
  end if;

  perform pg_catalog.set_config(
    'issue318.conversation_id', first_result ->> 'conversationId', false
  );
  perform pg_catalog.set_config(
    'issue318.user_message_id', first_result ->> 'userMessageId', false
  );
  perform pg_catalog.set_config(
    'issue318.attempt_token', first_result ->> 'attemptToken', false
  );
  perform pg_catalog.set_config(
    'issue318.cancelled_user_message_id',
    second_result ->> 'userMessageId',
    false
  );
  perform pg_catalog.set_config(
    'issue318.cancelled_attempt_token',
    second_result ->> 'attemptToken',
    false
  );
  perform pg_catalog.set_config(
    'issue318.unicode_user_message_id', third_result ->> 'userMessageId', false
  );
  perform pg_catalog.set_config(
    'issue318.unicode_attempt_token', third_result ->> 'attemptToken', false
  );
  perform pg_catalog.set_config(
    'issue318.overlong_user_message_id', fourth_result ->> 'userMessageId', false
  );
  perform pg_catalog.set_config(
    'issue318.overlong_attempt_token', fourth_result ->> 'attemptToken', false
  );
end;
$$;

reset role;
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '92000000-0000-4000-8000-000000000002',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-4000-8000-000000000002","app_metadata":{}}',
  true
);

do $$
declare
  result jsonb;
  retry_result jsonb;
  index integer;
begin
  for index in 1..51 loop
    result := public.start_project_grounded_question_v2(
      'a2000000-0000-4000-8000-000000000002',
      pg_catalog.md5('Pro question ' || index::text)::uuid,
      'Pro question ' || index::text,
      null
    );
    if result ->> 'outcome' <> 'started'
      or result ->> 'created' <> 'true'
      or result ->> 'messagesLimit' is not null
      or result ->> 'tier' <> 'pro'
    then
      raise exception 'REGRESSION: Pro Project was capped at %: %', index, result;
    end if;
    if index = 1 then
      retry_result := public.start_project_grounded_question_v2(
        'a2000000-0000-4000-8000-000000000002',
        pg_catalog.md5('Pro question 1')::uuid,
        'Pro question 1',
        null
      );
      if retry_result ->> 'userMessageId' <> result ->> 'userMessageId'
        or retry_result ->> 'attemptToken' <> result ->> 'attemptToken'
        or retry_result ->> 'messagesUsed' <> result ->> 'messagesUsed'
        or retry_result ->> 'created' <> 'false'
        or retry_result ->> 'completionState' <> 'reserved'
      then
        raise exception 'REGRESSION: v2 same-ID retry was not idempotent: %',
          retry_result;
      end if;
    end if;
  end loop;
end;
$$;

reset role;

insert into public.project_conversation_messages (
  conversation_id,
  in_reply_to_message_id,
  role,
  content,
  answer_classification,
  source_set_revision,
  source_manifest,
  source_coverage,
  evidence_snapshot,
  citation_diagnostics,
  completed_at
)
select
  questions.conversation_id,
  questions.id,
  'assistant',
  'Durable Pro answer for ' || questions.content,
  'unsupported',
  3,
  pg_catalog.jsonb_build_object(
    'projectId', 'a2000000-0000-4000-8000-000000000002',
    'sourceSetRevision', 3,
    'sources', '[]'::jsonb
  ),
  '{
    "totalVideos":0,"readyVideos":0,"usedVideos":0,
    "unavailableVideos":[],"passagesExamined":0,"passagesUsed":0
  }'::jsonb,
  pg_catalog.jsonb_build_object(
    'projectId', 'a2000000-0000-4000-8000-000000000002',
    'sourceSetRevision', 3,
    'passages', '[]'::jsonb
  ),
  '[]'::jsonb,
  pg_catalog.now()
from public.project_conversation_messages as questions
join public.project_conversations as conversations
  on conversations.id = questions.conversation_id
where conversations.project_id = 'a2000000-0000-4000-8000-000000000002'
  and questions.role = 'user'
  and questions.content <> 'Pro question 51';

update public.project_conversation_messages as questions
set completion_state = 'completed'
where questions.role = 'user'
  and exists (
    select 1
    from public.project_conversation_messages as answers
    where answers.in_reply_to_message_id = questions.id
      and answers.role = 'assistant'
  );

-- Keep the dangling reservation on the newest page while expiring its lease.
update public.project_conversation_messages
set created_at = pg_catalog.now() + interval '1 second',
    lease_expires_at = pg_catalog.now() - interval '1 second'
where id = pg_catalog.md5('Pro question 51')::uuid;

insert into public.project_source_set_events (
  id, project_id, revision, event_kind, video_id, video_title,
  from_position, to_position, from_status, to_status, created_at
) values (
  'a2500000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000002',
  1,
  'added',
  '71000000-0000-4000-8000-000000000001',
  'Evidence title',
  null,
  1,
  null,
  'ready',
  '2026-08-09T16:00:00Z'
);

insert into public.project_source_set_events (
  id, project_id, revision, event_kind, video_id, video_title,
  from_position, to_position, from_status, to_status, created_at
)
select
  pg_catalog.md5('project-source-event-' || series.revision::text)::uuid,
  'a2000000-0000-4000-8000-000000000002',
  series.revision,
  'reordered',
  '71000000-0000-4000-8000-000000000001',
  'Evidence title',
  1,
  1,
  'ready',
  'ready',
  '2026-08-09T16:00:00Z'::timestamptz
    + (series.revision::text || ' seconds')::interval
from pg_catalog.generate_series(2, 502) as series(revision);

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '92000000-0000-4000-8000-000000000002',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-4000-8000-000000000002","app_metadata":{}}',
  true
);

do $$
declare
  page jsonb;
  exact_attempt jsonb;
  terminal_retry jsonb;
  event_page jsonb;
  cursor_value jsonb := null;
  event_cursor jsonb := null;
  event_ids uuid[] := '{}'::uuid[];
  page_number integer;
  loaded_users integer := 0;
  loaded_events integer := 0;
begin
  page := public.load_project_conversation_page_v2(
    'a2000000-0000-4000-8000-000000000002', null, null, null, 25
  );
  if not exists (
    select 1
    from pg_catalog.jsonb_array_elements(page -> 'messages') as item(message)
    where item.message ->> 'id' = pg_catalog.md5('Pro question 51')::uuid::text
      and item.message ->> 'completionState' = 'cancelled'
  ) then
    raise exception 'REGRESSION: normal page load did not reap stale attempt: %',
      page;
  end if;

  exact_attempt := public.load_project_grounded_attempt_v2(
    'a2000000-0000-4000-8000-000000000002',
    pg_catalog.md5('Pro question 1')::uuid,
    null
  );
  if exact_attempt ->> 'outcome' <> 'ready'
    or exact_attempt ->> 'userMessageId'
      <> pg_catalog.md5('Pro question 1')::uuid::text
    or exact_attempt ->> 'state' <> 'completed'
    or exact_attempt #>> '{assistant,content}'
      <> 'Durable Pro answer for Pro question 1'
    or exact_attempt ? 'attemptToken'
    or exact_attempt -> 'assistant' ? 'evidenceSnapshot'
  then
    raise exception 'REGRESSION: exact attempt was lost behind 50 newer turns: %',
      exact_attempt;
  end if;

  terminal_retry := public.start_project_grounded_question_v2(
    'a2000000-0000-4000-8000-000000000002',
    pg_catalog.md5('Pro question 1')::uuid,
    'Pro question 1',
    null
  );
  if terminal_retry ->> 'created' <> 'false'
    or terminal_retry ->> 'completionState' <> 'completed'
  then
    raise exception 'REGRESSION: completed same-ID retry regenerated: %',
      terminal_retry;
  end if;

  exact_attempt := public.load_project_grounded_attempt_v2(
    'a2000000-0000-4000-8000-000000000002',
    pg_catalog.md5('Pro question 51')::uuid,
    null
  );
  if exact_attempt ->> 'state' <> 'cancelled'
    or exact_attempt -> 'assistant' <> 'null'::jsonb
  then
    raise exception 'REGRESSION: stale reservation was not reaped: %',
      exact_attempt;
  end if;
  terminal_retry := public.start_project_grounded_question_v2(
    'a2000000-0000-4000-8000-000000000002',
    pg_catalog.md5('Pro question 51')::uuid,
    'Pro question 51',
    null
  );
  if terminal_retry ->> 'created' <> 'false'
    or terminal_retry ->> 'completionState' <> 'cancelled'
  then
    raise exception 'REGRESSION: cancelled same-ID retry regenerated: %',
      terminal_retry;
  end if;

  for page_number in 1..3 loop
    page := public.load_project_conversation_page_v2(
      'a2000000-0000-4000-8000-000000000002',
      null,
      (cursor_value ->> 'createdAt')::timestamptz,
      (cursor_value ->> 'userMessageId')::uuid,
      25
    );
    if page ->> 'outcome' <> 'ready'
      or (page ->> 'messagesUsed')::integer <> 51
      or pg_catalog.jsonb_array_length(page -> 'messages') > 50
      or page -> 'sourceSetEvents' <> '[]'::jsonb
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(page -> 'messages') as item(message)
        where item.message ->> 'role' = 'assistant'
          and not exists (
            select 1
            from pg_catalog.jsonb_array_elements(page -> 'messages') as owner(item)
            where owner.item ->> 'role' = 'user'
              and owner.item ->> 'id' = item.message ->> 'inReplyToMessageId'
          )
      )
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(page -> 'messages')
          with ordinality as assistant(message, position)
        where assistant.message ->> 'role' = 'assistant'
          and not exists (
            select 1
            from pg_catalog.jsonb_array_elements(page -> 'messages')
              with ordinality as question(message, position)
            where question.message ->> 'role' = 'user'
              and question.message ->> 'id' =
                assistant.message ->> 'inReplyToMessageId'
              and question.position < assistant.position
          )
      )
    then
      raise exception 'REGRESSION: complete-turn page % drifted: %', page_number, page;
    end if;
    loaded_users := loaded_users + (
      select count(*)
      from pg_catalog.jsonb_array_elements(page -> 'messages') as item(message)
      where item.message ->> 'role' = 'user'
    );
    cursor_value := nullif(page -> 'nextCursor', 'null'::jsonb);
    exit when cursor_value is null;
  end loop;

  if loaded_users <> 51 or cursor_value is not null then
    raise exception 'REGRESSION: complete-turn cursor pagination was incomplete: %, %',
      loaded_users, cursor_value;
  end if;

  for page_number in 1..6 loop
    event_page := public.load_project_source_set_event_page_v2(
      'a2000000-0000-4000-8000-000000000002',
      (event_cursor ->> 'createdAt')::timestamptz,
      (event_cursor ->> 'eventId')::uuid,
      100
    );
    if event_page ->> 'outcome' <> 'ready'
      or (page_number = 1 and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(event_page -> 'events') e(event)
        where e.event ->> 'revision' = '502'
      ))
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(event_page -> 'events') e(event)
        where (e.event ->> 'eventId')::uuid = any(event_ids)
      )
    then
      raise exception 'REGRESSION: Source Set event page % drifted: %',
        page_number, event_page;
    end if;
    select event_ids || coalesce(pg_catalog.array_agg(
      (event ->> 'eventId')::uuid order by event ->> 'createdAt'
    ), '{}'::uuid[])
    into event_ids
    from pg_catalog.jsonb_array_elements(event_page -> 'events') as e(event);
    loaded_events := pg_catalog.cardinality(event_ids);
    event_cursor := nullif(event_page -> 'nextCursor', 'null'::jsonb);
    exit when event_cursor is null;
  end loop;
  if loaded_events <> 502 or event_cursor is not null then
    raise exception 'REGRESSION: Source Set event ledger incomplete: %, %',
      loaded_events, event_cursor;
  end if;
end;
$$;

reset role;

do $$
declare
  citation_case text;
  analysis jsonb;
  astral_character text := pg_catalog.convert_from(
    pg_catalog.decode('f09fa7aa', 'hex'),
    'UTF8'
  );
  astral_candidate text;
  analyzer_manifest jsonb := '{
    "sources":[{
      "sourceId":"S1",
      "passages":[{"startSeconds":42,"endSeconds":58}]
    }]
  }'::jsonb;
begin
  foreach citation_case in array array[
    '[[S1 @ 00:42]]',
    '[[S1 @ 00:42]',
    '[ [S1 @ 00:42] ]',
    '[prefix [S1 @ 00:42]]',
    '[prefix [S1 @ 00:42]'
  ] loop
    analysis := project_private.project_grounded_citation_analysis_v2(
      citation_case,
      analyzer_manifest
    );
    if analysis is distinct from pg_catalog.jsonb_build_object(
      'validCitationCount', 0,
      'validSourceIds', '[]'::jsonb,
      'allClaimsCited', false,
      'diagnostics', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind', 'malformed',
          'raw', citation_case
        )
      )
    ) then
      raise exception 'REGRESSION: SQL citation parser drifted: % => %',
        citation_case, analysis;
    end if;
  end loop;

  astral_candidate := '[' || pg_catalog.repeat(astral_character, 90)
    || ' S9 at 00:10]';
  analysis := project_private.project_grounded_citation_analysis_v2(
    'Valid [S1 @ 00:42]. ' || astral_candidate,
    analyzer_manifest
  );
  if analysis ->> 'validCitationCount' <> '1'
    or pg_catalog.jsonb_array_length(analysis -> 'diagnostics') <> 1
    or pg_catalog.char_length(
      analysis #>> '{diagnostics,0,raw}'
    ) <> 80
  then
    raise exception 'REGRESSION: Unicode citation diagnostics drifted: %',
      analysis;
  end if;

  analysis := project_private.project_grounded_citation_analysis_v2(
    'Source-supported observations' || E'\n'
      || 'Climate adaptation is supported [S1 @ 00:42].' || E'\n\n'
      || 'Proposed questions and creative opportunities' || E'\n'
      || 'What local evidence would challenge this finding [S1 @ 00:42]?',
    analyzer_manifest
  );
  if analysis ->> 'allClaimsCited' <> 'true'
    or analysis -> 'validSourceIds' is distinct from '["S1"]'::jsonb
  then
    raise exception 'REGRESSION: Find Gaps heading parity drifted: %', analysis;
  end if;

  analysis := project_private.project_grounded_citation_analysis_v2(
    'Project Assessment' || E'\n'
      || 'Competing positions' || E'\n'
      || 'April is supported [S1 @ 00:42].' || E'\n'
      || 'Criteria' || E'\n'
      || 'Directness favors April [S1 @ 00:42].' || E'\n'
      || 'Confidence: medium',
    analyzer_manifest
  );
  if analysis ->> 'allClaimsCited' <> 'true'
    or analysis -> 'validSourceIds' is distinct from '["S1"]'::jsonb
  then
    raise exception 'REGRESSION: Assessment heading parity drifted: %', analysis;
  end if;
end;
$$;

set local statement_timeout = '2000ms';
do $$
declare
  analysis jsonb;
begin
  analysis := project_private.project_grounded_citation_analysis_v2(
    pg_catalog.repeat('[]', 9990) || '[S1 @ 00:42]',
    '{"sources":[{"sourceId":"S1","passages":[
      {"startSeconds":42,"endSeconds":58}
    ]}]}'::jsonb
  );
  if analysis ->> 'validCitationCount' <> '1'
    or pg_catalog.jsonb_array_length(analysis -> 'diagnostics') <> 0
  then
    raise exception 'REGRESSION: bracket-heavy analyzer result drifted: %',
      analysis;
  end if;
  analysis := project_private.project_grounded_citation_analysis_v2(
    pg_catalog.repeat('Claim [S1 @ 00:42]. ', 800),
    '{"sources":[{"sourceId":"S1","passages":[
      {"startSeconds":42,"endSeconds":58}
    ]}]}'::jsonb
  );
  if analysis ->> 'validCitationCount' <> '800'
    or analysis ->> 'allClaimsCited' <> 'true'
  then
    raise exception 'REGRESSION: many-citation analyzer result drifted: %',
      analysis;
  end if;
end;
$$;
set local statement_timeout = '0';

insert into public.project_conversation_messages (
  id,
  conversation_id,
  role,
  content,
  completion_attempt_token,
  completion_state,
  analysis_mode,
  created_at,
  lease_expires_at
) values (
  '4f000000-0000-4000-8000-000000000001',
  current_setting('issue318.conversation_id')::uuid,
  'user',
  'Atomic persistence question',
  '5f000000-0000-4000-8000-000000000001',
  'reserved',
  'question',
  pg_catalog.now() - interval '200 seconds',
  pg_catalog.now() - interval '1 second'
);

set local role service_role;

do $$
declare
  v_conversation_id uuid := current_setting('issue318.conversation_id')::uuid;
  v_user_message_id uuid := current_setting('issue318.user_message_id')::uuid;
  attempt_token uuid := current_setting('issue318.attempt_token')::uuid;
  cancelled_user_message_id uuid :=
    current_setting('issue318.cancelled_user_message_id')::uuid;
  cancelled_attempt_token uuid :=
    current_setting('issue318.cancelled_attempt_token')::uuid;
  unicode_user_message_id uuid :=
    current_setting('issue318.unicode_user_message_id')::uuid;
  unicode_attempt_token uuid :=
    current_setting('issue318.unicode_attempt_token')::uuid;
  overlong_user_message_id uuid :=
    current_setting('issue318.overlong_user_message_id')::uuid;
  overlong_attempt_token uuid :=
    current_setting('issue318.overlong_attempt_token')::uuid;
  phase_user_message_id uuid := '4f000000-0000-4000-8000-000000000001';
  phase_attempt_token uuid := '5f000000-0000-4000-8000-000000000001';
  project_id uuid := 'a1000000-0000-4000-8000-000000000001';
  owner_id uuid := '91000000-0000-4000-8000-000000000001';
  video_id uuid := '71000000-0000-4000-8000-000000000001';
  passage_id text := '71000000-0000-4000-8000-000000000001:1:0:45';
  manifest jsonb;
  coverage jsonb;
  snapshot jsonb;
  null_timing_manifest jsonb;
  null_timing_snapshot jsonb;
  duplicate_manifest jsonb;
  duplicate_snapshot jsonb;
  foreign_manifest jsonb;
  foreign_snapshot jsonb;
  fabricated_manifest jsonb;
  fabricated_snapshot jsonb;
  result jsonb;
  completed_id uuid;
  direct_write_denied boolean := false;
  obsolete_signature_denied boolean := false;
  citation_case text;
  astral_character text := pg_catalog.convert_from(
    pg_catalog.decode('f09fa7aa', 'hex'), 'UTF8'
  );
  unicode_answer text;
begin
  manifest := pg_catalog.jsonb_build_object(
    'projectId', project_id,
    'sourceSetRevision', 3,
    'sources', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'sourceId', 'S1',
      'videoId', video_id,
      'youtubeVideoId', 'aaaaaaa0001',
      'title', 'Evidence title',
      'channelName', 'Evidence channel',
      'passages', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'passageId', passage_id,
        'startSeconds', 42,
        'endSeconds', 58
      ))
    ))
  );
  coverage := '{
    "totalVideos":3,
    "readyVideos":2,
    "usedVideos":1,
    "unavailableVideos":[
      {
        "videoId":"72000000-0000-4000-8000-000000000002",
        "youtubeVideoId":"zzzzzzz0002",
        "title":"Evidence missing",
        "channelName":null,
        "status":"unavailable",
        "failureCode":"evidence_unavailable"
      }
    ],
    "passagesExamined":1,
    "passagesUsed":1
  }'::jsonb;
  snapshot := pg_catalog.jsonb_build_object(
    'projectId', project_id,
    'sourceSetRevision', 3,
    'passages', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'passageId', passage_id,
      'videoId', video_id,
      'youtubeVideoId', 'aaaaaaa0001',
      'title', 'Evidence title',
      'channelName', 'Evidence channel',
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

  result := public.begin_project_grounded_answer_persistence_v2(
    owner_id,
    project_id,
    v_conversation_id,
    phase_user_message_id,
    phase_attempt_token,
    'Atomic persistence answer [S1 @ 00:42].',
    'supported',
    3,
    manifest,
    coverage,
    snapshot,
    'question'
  );
  if result ->> 'outcome' <> 'completed'
    or result ->> 'answerClassification' <> 'supported'
    or result ->> 'assistantMessageId' is null
  then
    raise exception 'REGRESSION: atomic persistence phase failed: %', result;
  end if;

  result := public.cancel_project_grounded_question_v2(
    owner_id,
    project_id,
    v_conversation_id,
    phase_user_message_id,
    phase_attempt_token
  );
  if result ->> 'outcome' <> 'completed'
    or result ->> 'assistantMessageId' is null
  then
    raise exception 'REGRESSION: cancel deleted a phase-completed answer: %', result;
  end if;

  null_timing_manifest := pg_catalog.jsonb_build_object(
    'projectId', project_id,
    'sourceSetRevision', 3,
    'sources', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'sourceId', 'S1',
      'videoId', video_id,
      'youtubeVideoId', 'aaaaaaa0001',
      'title', 'Evidence title',
      'channelName', 'Evidence channel',
      'passages', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'passageId',
          '71000000-0000-4000-8000-000000000001:2:0:37',
        'startSeconds', 70,
        'endSeconds', null
      ))
    ))
  );
  null_timing_snapshot := pg_catalog.jsonb_build_object(
    'projectId', project_id,
    'sourceSetRevision', 3,
    'passages', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'passageId', '71000000-0000-4000-8000-000000000001:2:0:37',
      'videoId', video_id,
      'youtubeVideoId', 'aaaaaaa0001',
      'title', 'Evidence title',
      'channelName', 'Evidence channel',
      'text', 'Null duration is not usable evidence.',
      'segmentOrdinal', 2,
      'excerptStartCharacter', 0,
      'excerptEndCharacter', 37,
      'startSeconds', 70,
      'endSeconds', null,
      'language', 'en',
      'truncatedStart', false,
      'truncatedEnd', false
    ))
  );
  result := public.complete_project_grounded_answer_v2(
    owner_id, project_id, v_conversation_id, v_user_message_id, attempt_token,
    'Forged NULL-duration evidence [S1 @ 01:10].',
    'supported', 3, null_timing_manifest, coverage, null_timing_snapshot
  );
  if result <> '{"outcome":"invalid"}'::jsonb then
    raise exception 'REGRESSION: NULL-duration passage was accepted: %', result;
  end if;

  unicode_answer := pg_catalog.repeat(
    astral_character,
    20000 - pg_catalog.char_length('Evidence [S1 @ 00:42].')
  ) || 'Evidence [S1 @ 00:42].';
  result := public.complete_project_grounded_answer_v2(
    owner_id, project_id, v_conversation_id, unicode_user_message_id,
    unicode_attempt_token, unicode_answer, 'supported', 3,
    manifest, coverage, snapshot
  );
  if result ->> 'outcome' <> 'completed' then
    raise exception 'REGRESSION: 20,000-code-point answer was rejected: %', result;
  end if;

  result := public.complete_project_grounded_answer_v2(
    owner_id, project_id, v_conversation_id, overlong_user_message_id,
    overlong_attempt_token, astral_character || unicode_answer,
    'supported', 3, manifest, coverage, snapshot
  );
  if result <> '{"outcome":"invalid"}'::jsonb then
    raise exception 'REGRESSION: 20,001-code-point answer was accepted: %', result;
  end if;

  result := public.cancel_project_grounded_question_v2(
    owner_id,
    project_id,
    v_conversation_id,
    cancelled_user_message_id,
    cancelled_attempt_token
  );
  if result <> '{"outcome":"cancelled"}'::jsonb
    or public.cancel_project_grounded_question_v2(
      owner_id,
      project_id,
      v_conversation_id,
      cancelled_user_message_id,
      cancelled_attempt_token
    ) is distinct from result
  then
    raise exception 'REGRESSION: token-fenced cancellation is not idempotent: %',
      result;
  end if;

  result := public.complete_project_grounded_answer_v2(
    owner_id, project_id, v_conversation_id, cancelled_user_message_id,
    cancelled_attempt_token,
    'Cancelled answer [S1 @ 00:42].', 'supported', 3,
    manifest, coverage, snapshot
  );
  if result <> '{"outcome":"stale"}'::jsonb then
    raise exception 'REGRESSION: cancelled attempt accepted completion: %', result;
  end if;

  result := public.complete_project_grounded_answer_v2(
    '93000000-0000-4000-8000-000000000003', project_id,
    v_conversation_id, v_user_message_id, attempt_token,
    'Cross-owner [S1 @ 00:42].', 'supported', 3, manifest, coverage, snapshot
  );
  if result <> '{"outcome":"stale"}'::jsonb then
    raise exception 'REGRESSION: cross-owner completion was accepted: %', result;
  end if;

  result := public.complete_project_grounded_answer_v2(
    owner_id, 'a3000000-0000-4000-8000-000000000003',
    v_conversation_id, v_user_message_id, attempt_token,
    'Cross-Project [S1 @ 00:42].', 'supported', 3, manifest, coverage, snapshot
  );
  if result <> '{"outcome":"stale"}'::jsonb then
    raise exception 'REGRESSION: cross-Project completion was accepted: %', result;
  end if;

  result := public.complete_project_grounded_answer_v2(
    owner_id, project_id, v_conversation_id, v_user_message_id,
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'Wrong attempt [S1 @ 00:42].', 'supported', 3, manifest, coverage, snapshot
  );
  if result <> '{"outcome":"stale"}'::jsonb then
    raise exception 'REGRESSION: wrong attempt completion was accepted: %', result;
  end if;

  result := public.complete_project_grounded_answer_v2(
    owner_id, project_id, v_conversation_id, v_user_message_id, attempt_token,
    'Stale revision [S1 @ 00:42].', 'supported', 4,
    pg_catalog.jsonb_set(manifest, '{sourceSetRevision}', '4'::jsonb),
    coverage,
    pg_catalog.jsonb_set(snapshot, '{sourceSetRevision}', '4'::jsonb)
  );
  if result <> '{"outcome":"stale"}'::jsonb then
    raise exception 'REGRESSION: stale revision completion was accepted: %', result;
  end if;

  result := public.complete_project_grounded_answer_v2(
    owner_id, project_id, v_conversation_id, v_user_message_id, attempt_token,
    'Incoherent artifact', 'supported', 3, manifest,
    pg_catalog.jsonb_set(coverage, '{usedVideos}', '0'::jsonb),
    snapshot
  );
  if result <> '{"outcome":"invalid"}'::jsonb then
    raise exception 'REGRESSION: incoherent evidence artifact was accepted: %', result;
  end if;

  result := public.complete_project_grounded_answer_v2(
    owner_id, project_id, v_conversation_id, v_user_message_id, attempt_token,
    'Empty artifacts', 'unsupported', 3,
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  );
  if result <> '{"outcome":"invalid"}'::jsonb then
    raise exception 'REGRESSION: empty artifact objects were accepted: %', result;
  end if;

  result := public.complete_project_grounded_answer_v2(
    owner_id, project_id, v_conversation_id, v_user_message_id, attempt_token,
    'Duplicate unavailable coverage', 'unsupported', 3, manifest,
    pg_catalog.jsonb_set(
      coverage,
      '{unavailableVideos}',
      pg_catalog.jsonb_build_array(
        coverage #> '{unavailableVideos,0}',
        coverage #> '{unavailableVideos,0}'
      )
    ),
    snapshot
  );
  if result <> '{"outcome":"invalid"}'::jsonb then
    raise exception 'REGRESSION: duplicate unavailable Video was accepted: %',
      result;
  end if;

  result := public.complete_project_grounded_answer_v2(
    owner_id, project_id, v_conversation_id, v_user_message_id, attempt_token,
    'Changed unavailable derivation', 'unsupported', 3, manifest,
    pg_catalog.jsonb_set(
      coverage,
      '{unavailableVideos,0,failureCode}',
      '"identity_unavailable"'::jsonb
    ),
    snapshot
  );
  if result <> '{"outcome":"invalid"}'::jsonb then
    raise exception 'REGRESSION: noncanonical unavailable derivation was accepted: %',
      result;
  end if;

  result := public.complete_project_grounded_answer_v2(
    owner_id, project_id, v_conversation_id, v_user_message_id, attempt_token,
    'Changed Transcript passage', 'supported', 3, manifest, coverage,
    pg_catalog.jsonb_set(
      snapshot,
      '{passages,0,text}',
      '"Fabricated text replacing the canonical Transcript."'::jsonb
    )
  );
  if result <> '{"outcome":"invalid"}'::jsonb then
    raise exception 'REGRESSION: changed canonical passage text was accepted: %', result;
  end if;

  fabricated_manifest := pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        manifest,
        '{sources,0,videoId}',
        '"74000000-0000-4000-8000-000000000004"'::jsonb
      ),
      '{sources,0,youtubeVideoId}',
      '"ddddddd0004"'::jsonb
    ),
    '{sources,0,passages,0,passageId}',
    '"74000000-0000-4000-8000-000000000004:1:0:45"'::jsonb
  );
  fabricated_snapshot := pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        snapshot,
        '{passages,0,videoId}',
        '"74000000-0000-4000-8000-000000000004"'::jsonb
      ),
      '{passages,0,youtubeVideoId}',
      '"ddddddd0004"'::jsonb
    ),
    '{passages,0,passageId}',
    '"74000000-0000-4000-8000-000000000004:1:0:45"'::jsonb
  );
  result := public.complete_project_grounded_answer_v2(
    owner_id, project_id, v_conversation_id, v_user_message_id, attempt_token,
    'Fabricated evidence identity', 'supported', 3,
    fabricated_manifest, coverage, fabricated_snapshot
  );
  if result <> '{"outcome":"invalid"}'::jsonb then
    raise exception 'REGRESSION: fabricated evidence identity was accepted: %', result;
  end if;

  foreign_manifest := pg_catalog.jsonb_build_object(
    'projectId', project_id,
    'sourceSetRevision', 3,
    'sources', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'sourceId', 'S1',
      'videoId', '73000000-0000-4000-8000-000000000003',
      'youtubeVideoId', 'ccccccc0003',
      'title', 'Foreign title',
      'channelName', 'Foreign channel',
      'passages', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'passageId', '73000000-0000-4000-8000-000000000003:1:0:53',
        'startSeconds', 9,
        'endSeconds', 13
      ))
    ))
  );
  foreign_snapshot := pg_catalog.jsonb_build_object(
    'projectId', project_id,
    'sourceSetRevision', 3,
    'passages', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'passageId', '73000000-0000-4000-8000-000000000003:1:0:53',
      'videoId', '73000000-0000-4000-8000-000000000003',
      'youtubeVideoId', 'ccccccc0003',
      'title', 'Foreign title',
      'channelName', 'Foreign channel',
      'text', 'Foreign evidence must not cross the Project boundary.',
      'segmentOrdinal', 1,
      'excerptStartCharacter', 0,
      'excerptEndCharacter', 53,
      'startSeconds', 9,
      'endSeconds', 13,
      'language', 'en',
      'truncatedStart', false,
      'truncatedEnd', false
    ))
  );
  result := public.complete_project_grounded_answer_v2(
    owner_id, project_id, v_conversation_id, v_user_message_id, attempt_token,
    'Foreign evidence', 'supported', 3,
    foreign_manifest, coverage, foreign_snapshot
  );
  if result <> '{"outcome":"invalid"}'::jsonb then
    raise exception 'REGRESSION: foreign Project evidence was accepted: %', result;
  end if;

  duplicate_manifest := pg_catalog.jsonb_set(
    manifest,
    '{sources,0,passages}',
    (manifest #> '{sources,0,passages}') || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'passageId', '71000000-0000-4000-8000-000000000001:2:46:90',
        'startSeconds', 60,
        'endSeconds', 75
      )
    )
  );
  duplicate_snapshot := pg_catalog.jsonb_set(
    snapshot,
    '{passages}',
    pg_catalog.jsonb_build_array(
      snapshot #> '{passages,0}',
      snapshot #> '{passages,0}'
    )
  );
  result := public.complete_project_grounded_answer_v2(
    owner_id, project_id, v_conversation_id, v_user_message_id, attempt_token,
    'Duplicate snapshot identity', 'supported', 3, duplicate_manifest,
    pg_catalog.jsonb_set(coverage, '{passagesUsed}', '2'::jsonb),
    duplicate_snapshot
  );
  if result <> '{"outcome":"invalid"}'::jsonb then
    raise exception 'REGRESSION: duplicate snapshot identity was accepted: %', result;
  end if;

  result := public.complete_project_grounded_answer_v2(
    owner_id, project_id, v_conversation_id, v_user_message_id, attempt_token,
    'The launch happened in April without a citation.',
    'supported', 3, manifest, coverage, snapshot
  );
  if result <> '{"outcome":"invalid"}'::jsonb then
    raise exception 'REGRESSION: uncited supported content was accepted: %', result;
  end if;

  result := public.complete_project_grounded_answer_v2(
    owner_id, project_id, v_conversation_id, v_user_message_id, attempt_token,
    'Invalid [S9 @ 00:10], [S1 @ 00:43], and [S1 at 00:42].',
    'supported', 3, manifest, coverage, snapshot
  );
  if result <> '{"outcome":"invalid"}'::jsonb then
    raise exception 'REGRESSION: all-invalid supported citations were accepted: %',
      result;
  end if;

  foreach citation_case in array array[
    '[[S1 @ 00:42]]',
    '[[S1 @ 00:42]',
    '[ [S1 @ 00:42] ]',
    '[prefix [S1 @ 00:42]]',
    '[prefix [S1 @ 00:42]'
  ] loop
    result := public.complete_project_grounded_answer_v2(
      owner_id, project_id, v_conversation_id, v_user_message_id, attempt_token,
      citation_case, 'supported', 3, manifest, coverage, snapshot
    );
    if result <> '{"outcome":"invalid"}'::jsonb then
      raise exception 'REGRESSION: malformed citation was accepted: % => %',
        citation_case, result;
    end if;
  end loop;

  begin
    execute pg_catalog.format(
      'select public.complete_project_grounded_answer_v2('
        || '%L,%L,%L,%L,%L,%L,%L,%s,%L::jsonb,%L::jsonb,%L::jsonb,%L::jsonb)',
      owner_id,
      project_id,
      v_conversation_id,
      v_user_message_id,
      attempt_token,
      'Fabricated caller diagnostics',
      'unsupported',
      3,
      manifest::text,
      coverage::text,
      snapshot::text,
      '[{"kind":"malformed","raw":"fabricated"}]'
    ) into result;
  exception
    when undefined_function then
      obsolete_signature_denied := true;
  end;
  if not obsolete_signature_denied then
    raise exception 'REGRESSION: caller-supplied citation diagnostics were accepted';
  end if;

  result := public.complete_project_grounded_answer_v2(
    owner_id, project_id, v_conversation_id, v_user_message_id, attempt_token,
    'The launch happened in April [S1 @ 00:42]. [S9 @ 00:10]. '
      || '[prefix [S1 @ 00:42]].',
    'supported', 3, manifest, coverage, snapshot
  );
  if result ->> 'outcome' <> 'completed'
    or result ->> 'assistantMessageId' is null
    or result ->> 'answerClassification' <> 'supported'
    or result -> 'citationDiagnostics' is distinct from '[
      {
        "kind":"unknown_source",
        "raw":"[S9 @ 00:10]",
        "sourceId":"S9"
      },
      {
        "kind":"malformed",
        "raw":"[prefix [S1 @ 00:42]]"
      }
    ]'::jsonb
  then
    raise exception 'REGRESSION: valid terminal completion failed: %', result;
  end if;
  completed_id := (result ->> 'assistantMessageId')::uuid;

  result := public.complete_project_grounded_answer_v2(
    owner_id, project_id, v_conversation_id, v_user_message_id, attempt_token,
    'Forged retry answer', 'abstained', 3, manifest, coverage, snapshot
  );
  if result ->> 'outcome' <> 'already_completed'
    or (result ->> 'assistantMessageId')::uuid <> completed_id
    or result ->> 'answerClassification' <> 'supported'
    or pg_catalog.jsonb_array_length(result -> 'citationDiagnostics') <> 2
  then
    raise exception 'REGRESSION: idempotent completion fencing drifted: %', result;
  end if;

  begin
    insert into public.project_conversation_messages (
      conversation_id, role, content, completion_attempt_token, completion_state
    ) values (
      v_conversation_id, 'user', 'Forged service row', gen_random_uuid(), 'reserved'
    );
  exception
    when insufficient_privilege then
      direct_write_denied := true;
  end;
  if not direct_write_denied then
    raise exception 'REGRESSION: service role direct message write succeeded';
  end if;
end;
$$;

reset role;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000001',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000001","app_metadata":{}}',
  true
);

do $$
declare
  loaded jsonb;
begin
  loaded := public.load_project_grounded_attempt_v2(
    'a1000000-0000-4000-8000-000000000001',
    '4f000000-0000-4000-8000-000000000001',
    current_setting('issue318.conversation_id')::uuid
  );
  if loaded ->> 'outcome' <> 'ready'
    or loaded ->> 'state' <> 'completed'
    or loaded #>> '{assistant,content}'
      <> 'Atomic persistence answer [S1 @ 00:42].'
  then
    raise exception 'REGRESSION: phase-completed answer did not reload: %', loaded;
  end if;
end;
$$;

reset role;

do $$
declare
  v_conversation_id uuid := current_setting('issue318.conversation_id')::uuid;
  v_user_message_id uuid := current_setting('issue318.user_message_id')::uuid;
  cancelled_user_message_id uuid :=
    current_setting('issue318.cancelled_user_message_id')::uuid;
  unicode_user_message_id uuid :=
    current_setting('issue318.unicode_user_message_id')::uuid;
  overlong_user_message_id uuid :=
    current_setting('issue318.overlong_user_message_id')::uuid;
  phase_user_message_id uuid := '4f000000-0000-4000-8000-000000000001';
  assistant_row public.project_conversation_messages%rowtype;
begin
  select * into assistant_row
  from public.project_conversation_messages
  where project_conversation_messages.conversation_id = v_conversation_id
    and in_reply_to_message_id = v_user_message_id
    and role = 'assistant';

  if assistant_row.id is null
    or assistant_row.content <> 'The launch happened in April [S1 @ 00:42]. '
      || '[S9 @ 00:10]. [prefix [S1 @ 00:42]].'
    or assistant_row.answer_classification <> 'supported'
    or assistant_row.source_set_revision <> 3
    or assistant_row.source_manifest #>> '{sources,0,sourceId}' <> 'S1'
    or assistant_row.source_coverage #>> '{passagesExamined}' <> '1'
    or assistant_row.evidence_snapshot #>> '{passages,0,text}'
      <> 'The source says the launch happened in April.'
    or assistant_row.citation_diagnostics is distinct from '[
      {
        "kind":"unknown_source",
        "raw":"[S9 @ 00:10]",
        "sourceId":"S9"
      },
      {
        "kind":"malformed",
        "raw":"[prefix [S1 @ 00:42]]"
      }
    ]'::jsonb
    or (
      select completion_state
      from public.project_conversation_messages
      where id = v_user_message_id
    ) <> 'completed'
    or (
      select count(*)
      from public.project_conversation_messages
      where project_conversation_messages.conversation_id = v_conversation_id
        and in_reply_to_message_id = v_user_message_id
        and role = 'assistant'
    ) <> 1
    or (
      select completion_state
      from public.project_conversation_messages
      where id = cancelled_user_message_id
    ) <> 'cancelled'
    or exists (
      select 1
      from public.project_conversation_messages
      where conversation_id = v_conversation_id
        and in_reply_to_message_id = cancelled_user_message_id
        and role = 'assistant'
    )
    or (
      select pg_catalog.char_length(content)
      from public.project_conversation_messages
      where conversation_id = v_conversation_id
        and in_reply_to_message_id = unicode_user_message_id
        and role = 'assistant'
    ) <> 20000
    or exists (
      select 1
      from public.project_conversation_messages
      where conversation_id = v_conversation_id
        and in_reply_to_message_id = overlong_user_message_id
        and role = 'assistant'
    )
    or (
      select completion_state
      from public.project_conversation_messages
      where id = phase_user_message_id
    ) <> 'completed'
    or (
      select lease_expires_at
      from public.project_conversation_messages
      where id = phase_user_message_id
    ) is not null
    or (
      select count(*)
      from public.project_conversation_messages
      where conversation_id = v_conversation_id
        and in_reply_to_message_id = phase_user_message_id
        and role = 'assistant'
        and content = 'Atomic persistence answer [S1 @ 00:42].'
    ) <> 1
  then
    raise exception 'REGRESSION: terminal answer/artifacts were not atomically durable';
  end if;
end;
$$;

rollback;
