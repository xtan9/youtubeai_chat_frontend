-- Issue #319: durable named Project Conversations.
--
-- The original Project Conversation release created one row with kind=default.
-- Keep those rows (and their message identities) intact while allowing more
-- rows per Project. Conversation clearing only moves a visibility boundary;
-- messages remain durable so the Project-wide Free quota cannot be reset.

alter table public.project_conversations
  add column if not exists name text,
  add column if not exists cleared_at timestamptz;

update public.project_conversations
set name = 'Project Conversation'
where name is null;

alter table public.project_conversations
  alter column name set default 'Project Conversation',
  alter column name set not null;

alter table public.project_conversations
  drop constraint if exists project_conversations_project_id_kind_key;

-- Representative legacy schemas may have been replayed before the durable
-- cancellation state was added to the message check. Keep the cancellation
-- RPC usable on those databases as well as on fresh installs.
alter table public.project_conversation_messages
  drop constraint if exists project_conversation_messages_completion_state_check;
alter table public.project_conversation_messages
  add constraint project_conversation_messages_completion_state_check
  check (completion_state in ('reserved', 'completed', 'cancelled'));

-- Keep the original default row distinguishable from newly-created named
-- threads. The old release constrained kind to `default`; named rows now use
-- `named` while retaining the column for the existing completion/cancellation
-- ownership joins.
alter table public.project_conversations
  drop constraint if exists project_conversations_kind_check;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.project_conversations'::regclass
      and conname = 'project_conversations_kind_check'
  ) then
    alter table public.project_conversations
      add constraint project_conversations_kind_check
      check (kind in ('default', 'named'));
  end if;
end;
$$;

create unique index if not exists project_conversations_default_project_key
  on public.project_conversations (project_id)
  where kind = 'default';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.project_conversations'::regclass
      and conname = 'project_conversations_name_length_check'
  ) then
    alter table public.project_conversations
      add constraint project_conversations_name_length_check
      check (char_length(btrim(name)) between 1 and 120);
  end if;
end;
$$;

create index if not exists project_conversations_project_activity_idx
  on public.project_conversations (project_id, updated_at desc, id desc);

-- List summaries and the durable Project-wide message counter. This function
-- never returns message content and derives ownership through Workspace.
create or replace function public.list_project_conversations(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  researcher_id uuid := auth.uid();
  request_role text := current_setting('role', true);
  request_jwt jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  owner_tier text;
  unlimited boolean := false;
  messages_used integer := 0;
  conversation_rows jsonb := '[]'::jsonb;
begin
  if request_role <> 'authenticated' or researcher_id is null then
    return jsonb_build_object('outcome', 'missing');
  end if;

  if not exists (
    select 1
    from public.projects
    join public.workspaces on workspaces.id = projects.workspace_id
    where projects.id = p_project_id
      and workspaces.owner_id = researcher_id
  ) then
    return jsonb_build_object('outcome', 'missing');
  end if;

  select tier into owner_tier
  from public.user_subscriptions
  where user_id = researcher_id;

  unlimited := coalesce(owner_tier, 'free') = 'pro'
    or (
      request_jwt ->> 'sub' = researcher_id::text
      and request_jwt @> '{
        "app_metadata": {
          "is_smoke_account": true,
          "smoke_entitlement": "pro"
        }
      }'::jsonb
    );

  select count(*)::integer into messages_used
  from public.project_conversation_messages as messages
  join public.project_conversations as conversations
    on conversations.id = messages.conversation_id
  where conversations.project_id = p_project_id
    and messages.role = 'user';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', conversations.id,
        'name', conversations.name,
        'createdAt', conversations.created_at,
        'updatedAt', conversations.updated_at,
        'messageCount', (
          select count(*)::integer
          from public.project_conversation_messages as visible_messages
          where visible_messages.conversation_id = conversations.id
            and visible_messages.created_at > coalesce(
              conversations.cleared_at,
              '-infinity'::timestamptz
            )
        )
      )
      order by conversations.updated_at desc, conversations.id desc
    ),
    '[]'::jsonb
  ) into conversation_rows
  from public.project_conversations as conversations
  where conversations.project_id = p_project_id;

  return jsonb_build_object(
    'outcome', 'ready',
    'conversations', conversation_rows,
    'messagesUsed', messages_used,
    'messagesLimit', case when unlimited then null else 5 end,
    'tier', case when unlimited then 'pro' else 'free' end
  );
end;
$$;

revoke all on function public.list_project_conversations(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_project_conversations(uuid)
  to authenticated;

-- Create a named thread. Conversation creation is deliberately unmetered;
-- only the atomic Project-wide message reservation consumes Free quota.
create or replace function public.create_project_conversation(
  p_project_id uuid,
  p_name text default 'New conversation'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  researcher_id uuid := auth.uid();
  request_role text := current_setting('role', true);
  normalized_name text := btrim(coalesce(p_name, 'New conversation'));
  conversation_id uuid;
  created_at timestamptz;
begin
  if request_role <> 'authenticated' or researcher_id is null then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if char_length(normalized_name) not between 1 and 120 then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if not exists (
    select 1
    from public.projects
    join public.workspaces on workspaces.id = projects.workspace_id
    where projects.id = p_project_id
      and workspaces.owner_id = researcher_id
  ) then
    return jsonb_build_object('outcome', 'missing');
  end if;

  insert into public.project_conversations (project_id, kind, name)
  values (p_project_id, 'named', normalized_name)
  returning id, project_conversations.created_at
  into conversation_id, created_at;

  update public.projects set last_active_at = now()
  where id = p_project_id;

  return jsonb_build_object(
    'outcome', 'created',
    'conversation', jsonb_build_object(
      'id', conversation_id,
      'name', normalized_name,
      'createdAt', created_at,
      'updatedAt', created_at,
      'messageCount', 0
    )
  );
exception
  when check_violation or not_null_violation then
    return jsonb_build_object('outcome', 'invalid');
end;
$$;

revoke all on function public.create_project_conversation(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_project_conversation(uuid, text)
  to authenticated;

create or replace function public.rename_project_conversation(
  p_project_id uuid,
  p_conversation_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  researcher_id uuid := auth.uid();
  request_role text := current_setting('role', true);
  normalized_name text := btrim(coalesce(p_name, ''));
  renamed_id uuid;
begin
  if request_role <> 'authenticated' or researcher_id is null then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if char_length(normalized_name) not between 1 and 120 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  update public.project_conversations as conversations
  set name = normalized_name, updated_at = now()
  from public.projects
  join public.workspaces on workspaces.id = projects.workspace_id
  where conversations.id = p_conversation_id
    and conversations.project_id = p_project_id
    and projects.id = p_project_id
    and workspaces.owner_id = researcher_id
  returning conversations.id into renamed_id;

  if renamed_id is null then
    return jsonb_build_object('outcome', 'missing');
  end if;
  update public.projects set last_active_at = now()
  where id = p_project_id;
  return jsonb_build_object('outcome', 'renamed');
end;
$$;

revoke all on function public.rename_project_conversation(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.rename_project_conversation(uuid, uuid, text)
  to authenticated;

-- Clear is a visibility boundary, not a destructive delete. All user rows
-- remain in the Project-wide count, so this operation cannot restore Free
-- allowance or hide usage from a concurrent reservation.
create or replace function public.clear_project_conversation(
  p_project_id uuid,
  p_conversation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  researcher_id uuid := auth.uid();
  request_role text := current_setting('role', true);
  cleared_id uuid;
begin
  if request_role <> 'authenticated' or researcher_id is null then
    return jsonb_build_object('outcome', 'missing');
  end if;

  update public.project_conversations as conversations
  set cleared_at = now(), updated_at = now()
  from public.projects
  join public.workspaces on workspaces.id = projects.workspace_id
  where conversations.id = p_conversation_id
    and conversations.project_id = p_project_id
    and projects.id = p_project_id
    and workspaces.owner_id = researcher_id
  returning conversations.id into cleared_id;

  if cleared_id is null then
    return jsonb_build_object('outcome', 'missing');
  end if;
  update public.projects set last_active_at = now()
  where id = p_project_id;
  return jsonb_build_object('outcome', 'cleared');
end;
$$;

revoke all on function public.clear_project_conversation(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.clear_project_conversation(uuid, uuid)
  to authenticated;

-- Generic owner-scoped loader used when switching threads. The legacy default
-- loader remains below for existing clients and fixtures.
create or replace function public.load_project_conversation(
  p_project_id uuid,
  p_conversation_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  researcher_id uuid := auth.uid();
  request_role text := current_setting('role', true);
  request_jwt jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_conversation_id uuid;
  cleared_at timestamptz;
  messages jsonb := '[]'::jsonb;
  messages_used integer := 0;
  owner_tier text;
  unlimited boolean := false;
begin
  if request_role <> 'authenticated' or researcher_id is null then
    return jsonb_build_object('outcome', 'missing');
  end if;

  if not exists (
    select 1
    from public.projects
    join public.workspaces on workspaces.id = projects.workspace_id
    where projects.id = p_project_id
      and workspaces.owner_id = researcher_id
  ) then
    return jsonb_build_object('outcome', 'missing');
  end if;

  if p_conversation_id is null then
    select conversations.id, conversations.cleared_at
    into v_conversation_id, cleared_at
    from public.project_conversations as conversations
    where conversations.project_id = p_project_id
      and conversations.kind = 'default'
    limit 1;
    if v_conversation_id is null then
      select conversations.id, conversations.cleared_at
      into v_conversation_id, cleared_at
      from public.project_conversations as conversations
      where conversations.project_id = p_project_id
      order by conversations.updated_at desc, conversations.id desc
      limit 1;
    end if;
  else
    select conversations.id, conversations.cleared_at
    into v_conversation_id, cleared_at
    from public.project_conversations as conversations
    where conversations.id = p_conversation_id
      and conversations.project_id = p_project_id;
    if v_conversation_id is null then
      return jsonb_build_object('outcome', 'missing');
    end if;
  end if;

  select tier into owner_tier
  from public.user_subscriptions where user_id = researcher_id;
  unlimited := coalesce(owner_tier, 'free') = 'pro'
    or (
      request_jwt ->> 'sub' = researcher_id::text
      and request_jwt @> '{
        "app_metadata": {
          "is_smoke_account": true,
          "smoke_entitlement": "pro"
        }
      }'::jsonb
    );

  select count(*)::integer into messages_used
  from public.project_conversation_messages as messages_row
  join public.project_conversations as conversations
    on conversations.id = messages_row.conversation_id
  where conversations.project_id = p_project_id
    and messages_row.role = 'user';

  if v_conversation_id is not null then
    select coalesce(jsonb_agg(message order by created_at, id), '[]'::jsonb)
    into messages
    from (
      select
        jsonb_build_object(
          'id', messages_row.id,
          'inReplyToMessageId', messages_row.in_reply_to_message_id,
          'role', messages_row.role,
          'content', messages_row.content,
          'answerClassification', messages_row.answer_classification,
          'sourceSetRevision', messages_row.source_set_revision,
          'sourceManifest', messages_row.source_manifest,
          'sourceCoverage', messages_row.source_coverage,
          'citationDiagnostics', messages_row.citation_diagnostics,
          'createdAt', messages_row.created_at
        ) as message,
        messages_row.created_at,
        messages_row.id
      from public.project_conversation_messages as messages_row
      where messages_row.conversation_id = v_conversation_id
        and messages_row.created_at > coalesce(
          cleared_at,
          '-infinity'::timestamptz
        )
      order by messages_row.created_at desc, messages_row.id desc
      limit 100
    ) as recent;
  end if;

  return jsonb_build_object(
    'outcome', 'ready',
    'conversationId', v_conversation_id,
    'messages', messages,
    'messagesUsed', messages_used,
    'messagesLimit', case when unlimited then null else 5 end,
    'tier', case when unlimited then 'pro' else 'free' end
  );
end;
$$;

revoke all on function public.load_project_conversation(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.load_project_conversation(uuid, uuid)
  to authenticated;

-- Keep the #318 function name as a compatibility seam while routing it through
-- the new owner-scoped loader.
create or replace function public.load_default_project_conversation(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.load_project_conversation(p_project_id, null::uuid)
$$;

revoke all on function public.load_default_project_conversation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.load_default_project_conversation(uuid)
  to authenticated;

-- Selected-thread question reservation. This overload preserves the existing
-- two-argument RPC while allowing a caller to name the owning conversation.
create or replace function public.start_project_grounded_question(
  p_project_id uuid,
  p_question text,
  p_conversation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  researcher_id uuid := auth.uid();
  request_role text := current_setting('role', true);
  request_jwt jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  normalized_question text := btrim(coalesce(p_question, ''));
  v_conversation_id uuid := p_conversation_id;
  v_user_message_id uuid;
  attempt_token uuid := gen_random_uuid();
  history jsonb;
  messages_used integer;
  owner_tier text;
  smoke_pro_entitled boolean := false;
  unlimited boolean := false;
  cleared_at timestamptz;
begin
  if request_role <> 'authenticated' or researcher_id is null then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if char_length(normalized_question) not between 2 and 200 then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if not exists (
    select 1 from public.projects
    join public.workspaces on workspaces.id = projects.workspace_id
    where projects.id = p_project_id and workspaces.owner_id = researcher_id
  ) then
    return jsonb_build_object('outcome', 'missing');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('project-grounded-question:' || p_project_id::text, 0)
  );

  smoke_pro_entitled := request_jwt ->> 'sub' = researcher_id::text
    and request_jwt @> '{
      "app_metadata": {"is_smoke_account": true, "smoke_entitlement": "pro"}
    }'::jsonb;
  select tier into owner_tier from public.user_subscriptions
  where user_id = researcher_id;
  unlimited := smoke_pro_entitled or coalesce(owner_tier, 'free') = 'pro';

  select count(*)::integer into messages_used
  from public.project_conversation_messages as messages
  join public.project_conversations as conversations
    on conversations.id = messages.conversation_id
  where conversations.project_id = p_project_id and messages.role = 'user';

  if not unlimited and messages_used >= 5 then
    return jsonb_build_object(
      'outcome', 'limit_reached', 'messagesUsed', 5,
      'messagesLimit', 5, 'tier', 'free'
    );
  end if;

  if v_conversation_id is null then
    select conversations.id into v_conversation_id
    from public.project_conversations as conversations
    where conversations.project_id = p_project_id
      and conversations.kind = 'default'
    limit 1;
    if v_conversation_id is null then
      insert into public.project_conversations (project_id, kind, name)
      values (p_project_id, 'default', 'Project Conversation')
      returning id into v_conversation_id;
    end if;
  else
    select conversations.cleared_at into cleared_at
    from public.project_conversations as conversations
    where conversations.id = v_conversation_id
      and conversations.project_id = p_project_id;
    if not found then
      return jsonb_build_object('outcome', 'missing');
    end if;
  end if;

  select conversations.cleared_at into cleared_at
  from public.project_conversations as conversations
  where conversations.id = v_conversation_id;

  insert into public.project_conversation_messages (
    conversation_id, role, content, completion_attempt_token, completion_state
  ) values (
    v_conversation_id, 'user', normalized_question, attempt_token, 'reserved'
  ) returning id into v_user_message_id;

  update public.projects set last_active_at = now() where id = p_project_id;

  select coalesce(jsonb_agg(message order by created_at, id), '[]'::jsonb)
  into history
  from (
    select jsonb_build_object(
      'id', messages_row.id,
      'inReplyToMessageId', messages_row.in_reply_to_message_id,
      'role', messages_row.role,
      'content', messages_row.content,
      'answerClassification', messages_row.answer_classification,
      'sourceSetRevision', messages_row.source_set_revision,
      'sourceManifest', messages_row.source_manifest,
      'sourceCoverage', messages_row.source_coverage,
      'citationDiagnostics', messages_row.citation_diagnostics,
      'createdAt', messages_row.created_at
    ) as message, messages_row.created_at, messages_row.id
    from public.project_conversation_messages as messages_row
    where messages_row.conversation_id = v_conversation_id
      and messages_row.id <> v_user_message_id
      and messages_row.created_at > coalesce(
        cleared_at, '-infinity'::timestamptz
      )
    order by messages_row.created_at desc, messages_row.id desc
    limit 16
  ) as recent;

  return jsonb_build_object(
    'outcome', 'started', 'conversationId', v_conversation_id,
    'userMessageId', v_user_message_id, 'attemptToken', attempt_token,
    'messagesUsed', messages_used + 1,
    'messagesLimit', case when unlimited then null else 5 end,
    'tier', case when unlimited then 'pro' else 'free' end,
    'history', history
  );
end;
$$;

revoke all on function public.start_project_grounded_question(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.start_project_grounded_question(uuid, text, uuid)
  to authenticated;

-- Replace the original ON CONFLICT implementation. Once a Project can own
-- multiple conversations there is intentionally no unique (project_id,kind)
-- constraint; the selected-thread overload serializes default creation under
-- the same Project advisory lock and therefore keeps legacy callers at one
-- default row.
create or replace function public.start_project_grounded_question(
  p_project_id uuid,
  p_question text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.start_project_grounded_question(
    p_project_id,
    p_question,
    null::uuid
  )
$$;

revoke all on function public.start_project_grounded_question(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.start_project_grounded_question(uuid, text)
  to authenticated;

-- #318 completion/cancellation functions predate named threads and filtered
-- on kind='default'. Replace those predicates so every owner-scoped thread
-- can persist a terminal answer or cancel a reserved question. Ownership is
-- still proved through Project -> Workspace and the opaque attempt token.
create or replace function public.complete_project_grounded_answer(
  p_owner_id uuid,
  p_project_id uuid,
  p_conversation_id uuid,
  p_user_message_id uuid,
  p_attempt_token uuid,
  p_assistant_content text,
  p_answer_classification text,
  p_source_set_revision bigint,
  p_source_manifest jsonb,
  p_source_coverage jsonb,
  p_evidence_snapshot jsonb,
  p_citation_diagnostics jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_role text := current_setting('role', true);
  attempt_state text;
  assistant_message_id uuid;
  current_source_set_revision bigint;
begin
  if request_role <> 'service_role' then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  perform 1
  from public.projects
  join public.workspaces
    on workspaces.id = projects.workspace_id
  where projects.id = p_project_id
    and workspaces.owner_id = p_owner_id
  for update of projects;

  if not found then
    return jsonb_build_object('outcome', 'stale');
  end if;

  select messages.completion_state
  into attempt_state
  from public.project_conversation_messages as messages
  join public.project_conversations as conversations
    on conversations.id = messages.conversation_id
  where messages.id = p_user_message_id
    and messages.conversation_id = p_conversation_id
    and messages.role = 'user'
    and messages.completion_attempt_token = p_attempt_token
    and conversations.project_id = p_project_id
  for update of messages;

  if attempt_state is null then
    return jsonb_build_object('outcome', 'stale');
  end if;

  if attempt_state = 'completed' then
    select id
    into assistant_message_id
    from public.project_conversation_messages
    where conversation_id = p_conversation_id
      and in_reply_to_message_id = p_user_message_id
      and role = 'assistant';
    return jsonb_build_object(
      'outcome', 'already_completed',
      'assistantMessageId', assistant_message_id
    );
  end if;

  if attempt_state = 'cancelled' then
    return jsonb_build_object('outcome', 'stale');
  end if;

  select revision
  into current_source_set_revision
  from public.project_source_sets
  where project_id = p_project_id
  for share;

  if not found then
    current_source_set_revision := 0;
  end if;

  if current_source_set_revision <> p_source_set_revision then
    return jsonb_build_object('outcome', 'stale');
  end if;

  if char_length(coalesce(p_assistant_content, '')) not between 1 and 20000
    or not project_private.project_grounded_artifact_is_coherent(
      p_project_id,
      p_source_set_revision,
      p_answer_classification,
      p_source_manifest,
      p_source_coverage,
      p_evidence_snapshot,
      p_citation_diagnostics
    )
  then
    return jsonb_build_object('outcome', 'invalid');
  end if;

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
  ) values (
    p_conversation_id,
    p_user_message_id,
    'assistant',
    p_assistant_content,
    p_answer_classification,
    p_source_set_revision,
    p_source_manifest,
    p_source_coverage,
    p_evidence_snapshot,
    p_citation_diagnostics,
    now()
  )
  returning id into assistant_message_id;

  update public.project_conversation_messages
  set completion_state = 'completed'
  where id = p_user_message_id
    and completion_attempt_token = p_attempt_token
    and completion_state = 'reserved';

  update public.project_conversations
  set updated_at = now()
  where id = p_conversation_id;

  return jsonb_build_object(
    'outcome', 'completed',
    'assistantMessageId', assistant_message_id
  );
end;
$$;

revoke all on function public.complete_project_grounded_answer(
  uuid, uuid, uuid, uuid, uuid, text, text, bigint, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.complete_project_grounded_answer(
  uuid, uuid, uuid, uuid, uuid, text, text, bigint, jsonb, jsonb, jsonb, jsonb
) to service_role;

create or replace function public.cancel_project_grounded_question(
  p_project_id uuid,
  p_user_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  researcher_id uuid := auth.uid();
  request_role text := current_setting('role', true);
  attempt_state text;
  v_conversation_id uuid;
begin
  if request_role <> 'authenticated' or researcher_id is null then
    return jsonb_build_object('outcome', 'missing');
  end if;

  select messages.completion_state, conversations.id
  into attempt_state, v_conversation_id
  from public.project_conversation_messages as messages
  join public.project_conversations as conversations
    on conversations.id = messages.conversation_id
  join public.projects
    on projects.id = conversations.project_id
  join public.workspaces
    on workspaces.id = projects.workspace_id
  where messages.id = p_user_message_id
    and messages.role = 'user'
    and conversations.project_id = p_project_id
    and workspaces.owner_id = researcher_id
  for update of messages;

  if attempt_state is null then
    return jsonb_build_object('outcome', 'missing');
  end if;

  delete from public.project_conversation_messages
  where conversation_id = v_conversation_id
    and in_reply_to_message_id = p_user_message_id
    and role = 'assistant';

  update public.project_conversation_messages
  set completion_state = 'cancelled'
  where id = p_user_message_id
    and role = 'user';

  return jsonb_build_object('outcome', 'cancelled');
end;
$$;

revoke all on function public.cancel_project_grounded_question(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_project_grounded_question(uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';
