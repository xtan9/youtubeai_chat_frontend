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
  )
) as fixture(project_id, owner_id, name, goal)
  on fixture.owner_id = workspaces.owner_id;

insert into public.project_source_sets (project_id, revision)
values
  ('a1000000-0000-4000-8000-000000000001', 3),
  ('a2000000-0000-4000-8000-000000000002', 3),
  ('a3000000-0000-4000-8000-000000000003', 3)
on conflict (project_id) do update set revision = excluded.revision;

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
    'public.complete_project_grounded_answer(uuid,uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.complete_project_grounded_answer(uuid,uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'REGRESSION: Project Conversation RPC grants are not least privilege';
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
    where oid = 'public.complete_project_grounded_answer(uuid,uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,jsonb)'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=""']
  ) then
    raise exception 'REGRESSION: completion RPC is not hardened';
  end if;
end;
$$;

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
  missing_foreign jsonb;
  missing_unknown jsonb;
  index integer;
  direct_access_denied boolean := false;
  completion_denied boolean := false;
begin
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
    perform public.complete_project_grounded_answer(
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
      '{}'::jsonb,
      '[]'::jsonb
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
  index integer;
begin
  for index in 1..7 loop
    result := public.start_project_grounded_question(
      'a2000000-0000-4000-8000-000000000002',
      'Pro question ' || index::text
    );
    if result ->> 'outcome' <> 'started'
      or result ->> 'messagesLimit' is not null
      or result ->> 'tier' <> 'pro'
    then
      raise exception 'REGRESSION: Pro Project was capped at %: %', index, result;
    end if;
  end loop;
end;
$$;

reset role;
set local role service_role;

do $$
declare
  v_conversation_id uuid := current_setting('issue318.conversation_id')::uuid;
  v_user_message_id uuid := current_setting('issue318.user_message_id')::uuid;
  attempt_token uuid := current_setting('issue318.attempt_token')::uuid;
  project_id uuid := 'a1000000-0000-4000-8000-000000000001';
  owner_id uuid := '91000000-0000-4000-8000-000000000001';
  video_id uuid := '71000000-0000-4000-8000-000000000001';
  passage_id text := '71000000-0000-4000-8000-000000000001:1:0:45';
  manifest jsonb;
  coverage jsonb;
  snapshot jsonb;
  diagnostics jsonb := '[{
    "kind":"malformed",
    "raw":"[S1 at 00:42]"
  }]'::jsonb;
  result jsonb;
  completed_id uuid;
  direct_write_denied boolean := false;
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
    "totalVideos":1,
    "readyVideos":1,
    "usedVideos":1,
    "unavailableVideos":[],
    "passagesExamined":9,
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

  result := public.complete_project_grounded_answer(
    '93000000-0000-4000-8000-000000000003', project_id,
    v_conversation_id, v_user_message_id, attempt_token,
    'Cross-owner', 'supported', 3, manifest, coverage, snapshot, diagnostics
  );
  if result <> '{"outcome":"stale"}'::jsonb then
    raise exception 'REGRESSION: cross-owner completion was accepted: %', result;
  end if;

  result := public.complete_project_grounded_answer(
    owner_id, 'a3000000-0000-4000-8000-000000000003',
    v_conversation_id, v_user_message_id, attempt_token,
    'Cross-Project', 'supported', 3, manifest, coverage, snapshot, diagnostics
  );
  if result <> '{"outcome":"stale"}'::jsonb then
    raise exception 'REGRESSION: cross-Project completion was accepted: %', result;
  end if;

  result := public.complete_project_grounded_answer(
    owner_id, project_id, v_conversation_id, v_user_message_id,
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'Wrong attempt', 'supported', 3, manifest, coverage, snapshot, diagnostics
  );
  if result <> '{"outcome":"stale"}'::jsonb then
    raise exception 'REGRESSION: wrong attempt completion was accepted: %', result;
  end if;

  result := public.complete_project_grounded_answer(
    owner_id, project_id, v_conversation_id, v_user_message_id, attempt_token,
    'Stale revision', 'supported', 4,
    pg_catalog.jsonb_set(manifest, '{sourceSetRevision}', '4'::jsonb),
    coverage,
    pg_catalog.jsonb_set(snapshot, '{sourceSetRevision}', '4'::jsonb),
    diagnostics
  );
  if result <> '{"outcome":"stale"}'::jsonb then
    raise exception 'REGRESSION: stale revision completion was accepted: %', result;
  end if;

  result := public.complete_project_grounded_answer(
    owner_id, project_id, v_conversation_id, v_user_message_id, attempt_token,
    'Incoherent artifact', 'supported', 3, manifest,
    pg_catalog.jsonb_set(coverage, '{usedVideos}', '0'::jsonb),
    snapshot, diagnostics
  );
  if result <> '{"outcome":"invalid"}'::jsonb then
    raise exception 'REGRESSION: incoherent evidence artifact was accepted: %', result;
  end if;

  result := public.complete_project_grounded_answer(
    owner_id, project_id, v_conversation_id, v_user_message_id, attempt_token,
    'The launch happened in April [S1 at 00:42].',
    'supported', 3, manifest, coverage, snapshot, diagnostics
  );
  if result ->> 'outcome' <> 'completed'
    or result ->> 'assistantMessageId' is null
  then
    raise exception 'REGRESSION: valid terminal completion failed: %', result;
  end if;
  completed_id := (result ->> 'assistantMessageId')::uuid;

  result := public.complete_project_grounded_answer(
    owner_id, project_id, v_conversation_id, v_user_message_id, attempt_token,
    'Forged retry answer', 'abstained', 3, manifest, coverage, snapshot, '[]'::jsonb
  );
  if result ->> 'outcome' <> 'already_completed'
    or (result ->> 'assistantMessageId')::uuid <> completed_id
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

do $$
declare
  v_conversation_id uuid := current_setting('issue318.conversation_id')::uuid;
  v_user_message_id uuid := current_setting('issue318.user_message_id')::uuid;
  assistant_row public.project_conversation_messages%rowtype;
begin
  select * into assistant_row
  from public.project_conversation_messages
  where project_conversation_messages.conversation_id = v_conversation_id
    and in_reply_to_message_id = v_user_message_id
    and role = 'assistant';

  if assistant_row.id is null
    or assistant_row.content <> 'The launch happened in April [S1 at 00:42].'
    or assistant_row.answer_classification <> 'supported'
    or assistant_row.source_set_revision <> 3
    or assistant_row.source_manifest #>> '{sources,0,sourceId}' <> 'S1'
    or assistant_row.source_coverage #>> '{passagesExamined}' <> '9'
    or assistant_row.evidence_snapshot #>> '{passages,0,text}'
      <> 'The source says the launch happened in April.'
    or assistant_row.citation_diagnostics #>> '{0,kind}' <> 'malformed'
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
  then
    raise exception 'REGRESSION: terminal answer/artifacts were not atomically durable';
  end if;
end;
$$;

rollback;
