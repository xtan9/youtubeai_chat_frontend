-- Run after every forward #318 migration. The transaction proves the deployed
-- v1 app remains functional during DB-first rollout and conditionally exercises
-- each v2 seam as soon as it enters the catalog. Nothing survives the rollback.

begin;

insert into auth.users(id, is_anonymous)
values ('95000000-0000-4000-8000-000000000005', false);

insert into public.projects(id, workspace_id, name, goal)
select
  'a5000000-0000-4000-8000-000000000005',
  workspaces.id,
  'Rollout compatibility',
  'Current Goal guidance'
from public.workspaces
where owner_id = '95000000-0000-4000-8000-000000000005';

insert into public.project_conversations(id, project_id, kind, name)
values (
  'b5000000-0000-4000-8000-000000000005',
  'a5000000-0000-4000-8000-000000000005',
  'named',
  'Selected rollout thread'
);

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','95000000-0000-4000-8000-000000000005',true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"95000000-0000-4000-8000-000000000005","is_anonymous":false,"app_metadata":{"project_beta_access":"internal"}}',
  true
);

do $$
declare result jsonb;
begin
  result := public.start_project_grounded_question(
    'a5000000-0000-4000-8000-000000000005',
    'First compatibility question',
    'b5000000-0000-4000-8000-000000000005'
  );
  if result ->> 'outcome' <> 'started' then
    raise exception 'REGRESSION: deployed v1 start failed: %', result;
  end if;
  perform pg_catalog.set_config(
    'issue318_compat.conversation',result ->> 'conversationId',false
  );
  perform pg_catalog.set_config(
    'issue318_compat.question',result ->> 'userMessageId',false
  );
  perform pg_catalog.set_config(
    'issue318_compat.token',result ->> 'attemptToken',false
  );
end;
$$;

reset role;
set local role service_role;
do $$
declare result jsonb;
begin
  result := public.complete_project_grounded_answer(
    '95000000-0000-4000-8000-000000000005',
    'a5000000-0000-4000-8000-000000000005',
    current_setting('issue318_compat.conversation')::uuid,
    current_setting('issue318_compat.question')::uuid,
    current_setting('issue318_compat.token')::uuid,
    'Compatibility unsupported answer.',
    'unsupported',
    0,
    '{
      "projectId":"a5000000-0000-4000-8000-000000000005",
      "sourceSetRevision":0,
      "sources":[]
    }'::jsonb,
    '{
      "totalVideos":0,"readyVideos":0,"evidenceVideos":0,
      "unavailableVideos":[],"passagesExamined":0,"evidencePassages":0
    }'::jsonb,
    '{
      "projectId":"a5000000-0000-4000-8000-000000000005",
      "sourceSetRevision":0,"passages":[]
    }'::jsonb,
    '[]'::jsonb
  );
  if result ->> 'outcome' <> 'completed' then
    raise exception 'REGRESSION: deployed v1 completion failed: %', result;
  end if;
end;
$$;

reset role;
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','95000000-0000-4000-8000-000000000005',true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"95000000-0000-4000-8000-000000000005","is_anonymous":false,"app_metadata":{"project_beta_access":"internal"}}',
  true
);
do $$
declare result jsonb;
begin
  result := public.load_project_conversation(
    'a5000000-0000-4000-8000-000000000005',
    'b5000000-0000-4000-8000-000000000005'
  );
  if result ->> 'outcome' <> 'ready'
    or pg_catalog.jsonb_array_length(result -> 'messages') <> 2
    or not exists (
      select 1 from pg_catalog.jsonb_array_elements(result -> 'messages') h(m)
      where h.m ->> 'role' = 'assistant'
        and h.m ->> 'content' = 'Compatibility unsupported answer.'
    )
  then
    raise exception 'REGRESSION: deployed v1 loader failed: %', result;
  end if;

  result := public.start_project_grounded_question(
    'a5000000-0000-4000-8000-000000000005',
    'Second compatibility question',
    'b5000000-0000-4000-8000-000000000005'
  );
  if result ->> 'outcome' <> 'started'
    or (select count(*) from pg_catalog.jsonb_object_keys(result)) <> 8
    or result ? 'completionState'
    or result ? 'goal'
    or pg_catalog.jsonb_array_length(result -> 'history') <> 2
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(result -> 'history') h(m)
      where h.m ? 'completionState'
        or h.m ? 'mode'
    )
  then
    raise exception 'REGRESSION: v1 second-turn history is incompatible: %',result;
  end if;

  result := public.start_project_grounded_question(
    'a5000000-0000-4000-8000-000000000005',
    'Legacy default compatibility question'
  );
  if result ->> 'outcome' <> 'started' then
    raise exception 'REGRESSION: legacy two-argument start failed: %',result;
  end if;

  -- The additive rollout leaves both deployed start signatures byte-shape
  -- compatible. Once the independent cancel migration is present, prove
  -- completion wins as an idempotent no-op.
  if pg_catalog.pg_get_functiondef(
    'public.cancel_project_grounded_question(uuid,uuid)'::regprocedure
  ) !~* 'delete[[:space:]]+from[[:space:]]+public[.]project_conversation_messages'
  then
    result := public.cancel_project_grounded_question(
      'a5000000-0000-4000-8000-000000000005',
      current_setting('issue318_compat.question')::uuid
    );
    if result <> '{"outcome":"cancelled"}'::jsonb then
      raise exception 'REGRESSION: deployed v1 cancel envelope drifted: %',result;
    end if;
  end if;
end;
$$;

reset role;
do $$
begin
  if pg_catalog.pg_get_functiondef(
    'public.cancel_project_grounded_question(uuid,uuid)'::regprocedure
  ) !~* 'delete[[:space:]]+from[[:space:]]+public[.]project_conversation_messages'
    and not exists (
      select 1 from public.project_conversation_messages
      where role = 'assistant'
        and in_reply_to_message_id =
          current_setting('issue318_compat.question')::uuid
    )
  then
    raise exception 'REGRESSION: completion-wins v1 cancel deleted assistant';
  end if;
end;
$$;

-- Exercise additive v2 seams only after their individual migration exists.
create temporary table issue318_compat_v2_attempt (
  conversation_id uuid not null,
  attempt_token uuid not null
) on commit drop;
grant insert on issue318_compat_v2_attempt to authenticated;
grant select on issue318_compat_v2_attempt to service_role;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub','95000000-0000-4000-8000-000000000005',true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"95000000-0000-4000-8000-000000000005","is_anonymous":false,"app_metadata":{"project_beta_access":"internal"}}',
  true
);
do $$
declare result jsonb;
begin
  if to_regprocedure(
    'public.start_project_grounded_question_v2(uuid,uuid,text,uuid,text)'
  ) is not null then
    result := public.start_project_grounded_question_v2(
      'a5000000-0000-4000-8000-000000000005',
      'c5000000-0000-4000-8000-000000000005',
      'V2 compatibility question',
      'b5000000-0000-4000-8000-000000000005',
      'question'
    );
    if result ->> 'outcome' <> 'started'
      or result ->> 'completionState' <> 'reserved'
      or result ->> 'created' <> 'true'
      or result ->> 'mode' <> 'question'
      or result ->> 'goal' <> 'Current Goal guidance'
      or pg_catalog.jsonb_array_length(result -> 'history') <> 2
      or not exists (
        select 1
        from pg_catalog.jsonb_array_elements(result -> 'history') h(message)
        where h.message ->> 'role' = 'assistant'
          and h.message -> 'sourceCoverage' ? 'usedVideos'
          and h.message -> 'sourceCoverage' ? 'passagesUsed'
          and not (h.message -> 'sourceCoverage' ? 'evidenceVideos')
      )
    then raise exception 'REGRESSION: v2 start failed: %',result; end if;
    insert into issue318_compat_v2_attempt(conversation_id, attempt_token)
    values (
      (result ->> 'conversationId')::uuid,
      (result ->> 'attemptToken')::uuid
    );
  end if;
  if to_regprocedure(
    'public.load_project_conversation_page_v2(uuid,uuid,timestamptz,uuid,integer)'
  ) is not null then
    result := public.load_project_conversation_page_v2(
      'a5000000-0000-4000-8000-000000000005',
      'b5000000-0000-4000-8000-000000000005',null,null,25
    );
    if result ->> 'outcome' <> 'ready' then
      raise exception 'REGRESSION: v2 page load failed: %',result;
    end if;
  end if;
  if to_regprocedure(
    'public.load_project_grounded_attempt_v2(uuid,uuid,uuid)'
  ) is not null then
    result := public.load_project_grounded_attempt_v2(
      'a5000000-0000-4000-8000-000000000005',
      'c5000000-0000-4000-8000-000000000005',
      'b5000000-0000-4000-8000-000000000005'
    );
    if result ->> 'state' <> 'reserved' or result ? 'attemptToken' then
      raise exception 'REGRESSION: exact v2 attempt load failed: %',result;
    end if;
  end if;
  if to_regprocedure(
    'public.load_project_source_set_event_page_v2(uuid,timestamptz,uuid,integer)'
  ) is not null then
    result := public.load_project_source_set_event_page_v2(
      'a5000000-0000-4000-8000-000000000005',null,null,100
    );
    if result ->> 'outcome' <> 'ready'
      or pg_catalog.jsonb_typeof(result -> 'events') <> 'array'
    then
      raise exception 'REGRESSION: v2 event page failed: %',result;
    end if;
  end if;
end;
$$;

reset role;
set local role service_role;
do $$
declare
  result jsonb;
  v_conversation_id uuid;
  v_attempt_token uuid;
begin
  if to_regprocedure(
    'public.complete_project_grounded_answer_v2(uuid,uuid,uuid,uuid,uuid,text,text,bigint,jsonb,jsonb,jsonb,text)'
  ) is not null then
    select conversation_id, attempt_token
    into v_conversation_id, v_attempt_token
    from issue318_compat_v2_attempt;
    result := public.complete_project_grounded_answer_v2(
      '95000000-0000-4000-8000-000000000005',
      'a5000000-0000-4000-8000-000000000005',
      v_conversation_id,
      'c5000000-0000-4000-8000-000000000005',
      v_attempt_token,
      'V2 compatibility unsupported answer.',
      'unsupported',0,
      '{
        "projectId":"a5000000-0000-4000-8000-000000000005",
        "sourceSetRevision":0,"sources":[]
      }'::jsonb,
      '{
        "totalVideos":0,"readyVideos":0,"usedVideos":0,
        "unavailableVideos":[],"passagesExamined":0,"passagesUsed":0
      }'::jsonb,
      '{
        "projectId":"a5000000-0000-4000-8000-000000000005",
        "sourceSetRevision":0,"passages":[]
      }'::jsonb,
      'question'
    );
    if result ->> 'outcome' <> 'completed' then
      raise exception 'REGRESSION: v2 completion failed: %',result;
    end if;
  end if;
end;
$$;

rollback;
