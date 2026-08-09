-- Add an idempotent, client-correlated reservation seam. The shared advisory
-- lock preserves the deployed per-Project Free cap across v1 and v2 callers.

create function public.start_project_grounded_question_v2(
  p_project_id uuid,
  p_question_id uuid,
  p_question text,
  p_conversation_id uuid,
  p_mode text default 'question'
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
  normalized_mode text := coalesce(nullif(btrim(p_mode), ''), 'question');
  v_conversation_id uuid := p_conversation_id;
  attempt_token uuid;
  attempt_state text;
  history jsonb := '[]'::jsonb;
  messages_used integer;
  owner_tier text;
  unlimited boolean := false;
  project_goal text;
  cleared_at timestamptz;
  attempt_found boolean := false;
  attempt_mode text;
begin
  if request_role <> 'authenticated' or researcher_id is null then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if p_question_id is null
    or char_length(normalized_question) not between 2 and 200
    or normalized_mode not in (
      'question',
      'compare_viewpoints',
      'common_themes',
      'find_gaps',
      'project_assessment'
    )
  then return jsonb_build_object('outcome', 'invalid'); end if;

  select projects.goal into project_goal
  from public.projects
  join public.workspaces on workspaces.id = projects.workspace_id
  where projects.id = p_project_id and workspaces.owner_id = researcher_id;
  if not found then return jsonb_build_object('outcome', 'missing'); end if;

  perform pg_advisory_xact_lock(
    hashtextextended('project-grounded-question:' || p_project_id::text, 0)
  );

  if v_conversation_id is null then
    select conversations.id, conversations.cleared_at
    into v_conversation_id, cleared_at
    from public.project_conversations as conversations
    where conversations.project_id = p_project_id
      and conversations.kind = 'default'
    limit 1;
  else
    select conversations.cleared_at into cleared_at
    from public.project_conversations as conversations
    where conversations.id = v_conversation_id
      and conversations.project_id = p_project_id;
    if not found then return jsonb_build_object('outcome','missing'); end if;
  end if;

  select
    messages.completion_attempt_token,
    messages.completion_state,
    messages.analysis_mode
  into attempt_token, attempt_state, attempt_mode
  from public.project_conversation_messages as messages
  join public.project_conversations as conversations
    on conversations.id = messages.conversation_id
  where messages.id = p_question_id
    and messages.role = 'user'
    and conversations.project_id = p_project_id
    and conversations.id = v_conversation_id
    and messages.content = normalized_question
    and messages.analysis_mode = normalized_mode;
  attempt_found := found;
  if not attempt_found and exists (
    select 1 from public.project_conversation_messages where id = p_question_id
  ) then return jsonb_build_object('outcome', 'invalid'); end if;

  select tier into owner_tier
  from public.user_subscriptions where user_id = researcher_id;
  unlimited := coalesce(owner_tier, 'free') = 'pro' or (
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
  where conversations.project_id = p_project_id and messages.role = 'user';

  if not attempt_found then
    if not unlimited and messages_used >= 5 then
      return jsonb_build_object(
        'outcome','limit_reached','messagesUsed',5,
        'messagesLimit',5,'tier','free'
      );
    end if;
    if v_conversation_id is null then
      insert into public.project_conversations(project_id, kind, name)
      values (p_project_id, 'default', 'Project Conversation')
      returning id into v_conversation_id;
      cleared_at := null;
    end if;
    attempt_token := gen_random_uuid();
    attempt_state := 'reserved';
    insert into public.project_conversation_messages(
      id, conversation_id, role, content,
      completion_attempt_token, completion_state, analysis_mode,
      lease_expires_at
    ) values (
      p_question_id, v_conversation_id, 'user', normalized_question,
      attempt_token, attempt_state, normalized_mode,
      pg_catalog.now() + interval '135 seconds'
    );
    messages_used := messages_used + 1;
    update public.projects set last_active_at = now() where id = p_project_id;
    update public.project_conversations
    set updated_at = now()
    where id = v_conversation_id;
  end if;

  with selected_users as materialized (
    select user_message.id, user_message.created_at
    from public.project_conversation_messages as user_message
    where user_message.conversation_id = v_conversation_id
      and user_message.role = 'user'
      and user_message.id <> p_question_id
      and user_message.created_at > coalesce(
        cleared_at, '-infinity'::timestamptz
      )
      and user_message.completion_state = 'completed'
      and exists (
        select 1
        from public.project_conversation_messages as answer
        where answer.conversation_id = v_conversation_id
          and answer.role = 'assistant'
          and answer.in_reply_to_message_id = user_message.id
      )
    order by user_message.created_at desc, user_message.id desc
    limit 8
  ), page_messages as (
    select
      jsonb_build_object(
        'id', message.id,
        'inReplyToMessageId', message.in_reply_to_message_id,
        'role', message.role,
        'content', message.content,
        'answerClassification', message.answer_classification,
        'completionState', case when message.role = 'user'
          then to_jsonb(message.completion_state) else 'null'::jsonb end,
        'sourceSetRevision', message.source_set_revision,
        'sourceManifest', message.source_manifest,
        'sourceCoverage', case when message.role = 'assistant'
          then project_private.project_grounded_normalize_coverage_v2(
            message.source_coverage
          ) else null end,
        'citationDiagnostics', message.citation_diagnostics,
        'mode', message.analysis_mode,
        'createdAt', message.created_at
      ) || case
        when message.role = 'assistant'
          and message.evidence_snapshot is not null
        then jsonb_build_object(
          'evidenceSnapshot', message.evidence_snapshot
        )
        else '{}'::jsonb
      end as value,
      selected_user.created_at as turn_created_at,
      selected_user.id as turn_id,
      case when message.role = 'user' then 0 else 1 end as role_order,
      message.id
    from selected_users as selected_user
    join public.project_conversation_messages as message
      on message.id = selected_user.id
      or (
        message.role = 'assistant'
        and message.in_reply_to_message_id = selected_user.id
      )
  )
  select coalesce(jsonb_agg(
    value order by turn_created_at, turn_id, role_order, id
  ), '[]'::jsonb)
  into history from page_messages;

  return jsonb_build_object(
    'outcome','started',
    'created',not attempt_found,
    'conversationId',v_conversation_id,
    'userMessageId',p_question_id,
    'attemptToken',attempt_token,
    'completionState',attempt_state,
    'messagesUsed',messages_used,
    'messagesLimit',case when unlimited then null else 5 end,
    'tier',case when unlimited then 'pro' else 'free' end,
    'mode',normalized_mode,
    'history',history,
    'goal',project_goal
  );
end;
$$;

revoke all on function
  public.start_project_grounded_question_v2(uuid, uuid, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.start_project_grounded_question_v2(uuid, uuid, text, uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
