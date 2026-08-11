-- Contract test for named Project Conversations, owner isolation, and the
-- Project-wide Free message counter. Run after migration replay.

begin;

insert into auth.users (id, is_anonymous)
values
  ('96000000-0000-4000-8000-000000000006', false),
  ('97000000-0000-4000-8000-000000000007', false);

insert into public.projects (id, workspace_id, name)
select fixture.project_id, workspaces.id, fixture.name
from public.workspaces
join (values
  (
    'a6000000-0000-4000-8000-000000000006'::uuid,
    '96000000-0000-4000-8000-000000000006'::uuid,
    'Multiple conversation fixture'
  ),
  (
    'a7000000-0000-4000-8000-000000000007'::uuid,
    '97000000-0000-4000-8000-000000000007'::uuid,
    'Foreign conversation fixture'
  )
) as fixture(project_id, owner_id, name)
  on fixture.owner_id = workspaces.owner_id;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '96000000-0000-4000-8000-000000000006',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"96000000-0000-4000-8000-000000000006","is_anonymous":false,"app_metadata":{"project_beta_access":"internal"}}',
  true
);

do $$
declare
  first_conversation jsonb;
  second_conversation jsonb;
  first_start jsonb;
  second_start jsonb;
  cancelled jsonb;
  named_only_load jsonb;
  legacy_start jsonb;
  listed jsonb;
  loaded jsonb;
begin
  first_conversation := public.create_project_conversation(
    'a6000000-0000-4000-8000-000000000006', 'Questions'
  );
  second_conversation := public.create_project_conversation(
    'a6000000-0000-4000-8000-000000000006', 'Comparison'
  );
  if first_conversation ->> 'outcome' <> 'created'
    or second_conversation ->> 'outcome' <> 'created'
  then
    raise exception 'REGRESSION: named conversation creation failed: %, %',
      first_conversation, second_conversation;
  end if;

  first_start := public.start_project_grounded_question(
    'a6000000-0000-4000-8000-000000000006',
    'First question',
    (first_conversation -> 'conversation' ->> 'id')::uuid
  );
  second_start := public.start_project_grounded_question(
    'a6000000-0000-4000-8000-000000000006',
    'Second question',
    (second_conversation -> 'conversation' ->> 'id')::uuid
  );
  if first_start ->> 'outcome' <> 'started'
    or second_start ->> 'outcome' <> 'started'
    or (second_start ->> 'messagesUsed')::integer <> 2
  then
    raise exception 'REGRESSION: selected-thread start did not aggregate quota: %, %',
      first_start, second_start;
  end if;

  -- A named-only Project must still resume its newest thread when the
  -- compatibility loader has no preserved default row yet.
  named_only_load := public.load_project_conversation(
    'a6000000-0000-4000-8000-000000000006',
    null
  );
  if named_only_load ->> 'outcome' <> 'ready'
    or (named_only_load ->> 'conversationId')::uuid not in (
      (first_conversation -> 'conversation' ->> 'id')::uuid,
      (second_conversation -> 'conversation' ->> 'id')::uuid
    )
  then
    raise exception 'REGRESSION: named-only compatibility load did not resume a named thread: %', named_only_load;
  end if;

  cancelled := public.cancel_project_grounded_question(
    'a6000000-0000-4000-8000-000000000006',
    (first_start ->> 'userMessageId')::uuid
  );
  if cancelled ->> 'outcome' <> 'cancelled' then
    raise exception 'REGRESSION: named conversation cancellation failed: %', cancelled;
  end if;

  -- The legacy two-argument seam must remain on the preserved default row,
  -- even when newer named threads exist.
  legacy_start := public.start_project_grounded_question(
    'a6000000-0000-4000-8000-000000000006',
    'Legacy question'
  );
  if legacy_start ->> 'outcome' <> 'started'
    or (legacy_start ->> 'conversationId')::uuid in (
      (first_conversation -> 'conversation' ->> 'id')::uuid,
      (second_conversation -> 'conversation' ->> 'id')::uuid
    )
  then
    raise exception 'REGRESSION: legacy default seam selected a named thread: %', legacy_start;
  end if;
end;
$$;

reset role;

do $$
begin
  if (select kind from public.project_conversations
      where project_id = 'a6000000-0000-4000-8000-000000000006'
        and name = 'Questions') <> 'named'
    or (select kind from public.project_conversations
        where project_id = 'a6000000-0000-4000-8000-000000000006'
          and name = 'Comparison') <> 'named'
    or (select kind from public.project_conversations
        where project_id = 'a6000000-0000-4000-8000-000000000006'
          and name = 'Project Conversation') <> 'default'
  then
    raise exception 'REGRESSION: conversation kind compatibility drifted';
  end if;
end;
$$;

select pg_catalog.set_config(
  'issue319.comparison_id',
  (select id::text from public.project_conversations
   where project_id = 'a6000000-0000-4000-8000-000000000006'
     and name = 'Comparison'),
  true
);
select pg_catalog.set_config(
  'issue319.comparison_user_message_id',
  (select messages.id::text
   from public.project_conversation_messages as messages
   join public.project_conversations as conversations
     on conversations.id = messages.conversation_id
   where conversations.project_id = 'a6000000-0000-4000-8000-000000000006'
     and conversations.name = 'Comparison'
     and messages.role = 'user'
     and messages.content = 'Second question'),
  true
);
select pg_catalog.set_config(
  'issue319.comparison_attempt_token',
  (select messages.completion_attempt_token::text
   from public.project_conversation_messages as messages
   join public.project_conversations as conversations
     on conversations.id = messages.conversation_id
   where conversations.project_id = 'a6000000-0000-4000-8000-000000000006'
     and conversations.name = 'Comparison'
     and messages.role = 'user'
     and messages.content = 'Second question'),
  true
);
select pg_catalog.set_config(
  'issue319.questions_id',
  (select id::text from public.project_conversations
   where project_id = 'a6000000-0000-4000-8000-000000000006'
     and name = 'Questions'),
  true
);

set local role service_role;

do $$
declare
  completed jsonb;
begin
  completed := public.complete_project_grounded_answer(
    '96000000-0000-4000-8000-000000000006',
    'a6000000-0000-4000-8000-000000000006',
    current_setting('issue319.comparison_id')::uuid,
    current_setting('issue319.comparison_user_message_id')::uuid,
    current_setting('issue319.comparison_attempt_token')::uuid,
    'No evidence was available.',
    'unsupported',
    0,
    jsonb_build_object(
      'projectId', 'a6000000-0000-4000-8000-000000000006',
      'sourceSetRevision', 0,
      'sources', '[]'::jsonb
    ),
    jsonb_build_object(
      'totalVideos', 0,
      'readyVideos', 0,
      'evidenceVideos', 0,
      'unavailableVideos', '[]'::jsonb,
      'passagesExamined', 0,
      'evidencePassages', 0
    ),
    jsonb_build_object(
      'projectId', 'a6000000-0000-4000-8000-000000000006',
      'sourceSetRevision', 0,
      'passages', '[]'::jsonb
    ),
    '[]'::jsonb
  );
  if completed ->> 'outcome' <> 'completed' then
    raise exception 'REGRESSION: named conversation completion failed: %', completed;
  end if;
end;
$$;

set local role authenticated;

do $$
declare
  listed jsonb;
  loaded jsonb;
begin

  listed := public.list_project_conversations(
    'a6000000-0000-4000-8000-000000000006'
  );
  if listed ->> 'outcome' <> 'ready'
    or jsonb_array_length(listed -> 'conversations') <> 3
    or (listed ->> 'messagesUsed')::integer <> 3
  then
    raise exception 'REGRESSION: list did not preserve threads and shared quota: %', listed;
  end if;

  if public.clear_project_conversation(
    'a6000000-0000-4000-8000-000000000006',
    current_setting('issue319.questions_id')::uuid
  ) <> '{"outcome":"cleared"}'::jsonb
  then
    raise exception 'REGRESSION: conversation clear failed';
  end if;

  loaded := public.load_project_conversation(
    'a6000000-0000-4000-8000-000000000006',
    current_setting('issue319.questions_id')::uuid
  );
  if jsonb_array_length(loaded -> 'messages') <> 0
    or (loaded ->> 'messagesUsed')::integer <> 3
  then
    raise exception 'REGRESSION: clear reset visible history or quota: %', loaded;
  end if;

  if public.list_project_conversations(
    'a7000000-0000-4000-8000-000000000007'
  ) ->> 'outcome' <> 'missing'
  then
    raise exception 'REGRESSION: foreign Project conversation list was visible';
  end if;
end;
$$;

rollback;
