-- Atomically create/reuse the default Conversation, enforce the Free
-- per-Project user-message cap, and durably reserve one completion attempt.

create function public.start_project_grounded_question(
  p_project_id uuid,
  p_question text
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
  v_conversation_id uuid;
  v_user_message_id uuid;
  attempt_token uuid := gen_random_uuid();
  history jsonb;
  messages_used integer;
  owner_tier text;
  smoke_pro_entitled boolean := false;
  unlimited boolean := false;
begin
  if request_role <> 'authenticated' or researcher_id is null then
    return jsonb_build_object('outcome', 'missing');
  end if;

  if char_length(normalized_question) not between 2 and 200 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  if not exists (
    select 1
    from public.projects
    join public.workspaces
      on workspaces.id = projects.workspace_id
    where projects.id = p_project_id
      and workspaces.owner_id = researcher_id
  ) then
    return jsonb_build_object('outcome', 'missing');
  end if;

  -- Serialize only starts for this Project. The count and user-row insert are
  -- one transaction, so six concurrent Free requests cannot all pass at four.
  perform pg_advisory_xact_lock(
    hashtextextended('project-grounded-question:' || p_project_id::text, 0)
  );

  smoke_pro_entitled :=
    request_jwt ->> 'sub' = researcher_id::text
    and request_jwt @> '{
      "app_metadata": {
        "is_smoke_account": true,
        "smoke_entitlement": "pro"
      }
    }'::jsonb;

  select tier
  into owner_tier
  from public.user_subscriptions
  where user_id = researcher_id;

  unlimited := smoke_pro_entitled or coalesce(owner_tier, 'free') = 'pro';

  select count(*)::integer
  into messages_used
  from public.project_conversation_messages
  join public.project_conversations
    on project_conversations.id = project_conversation_messages.conversation_id
  where project_conversations.project_id = p_project_id
    and project_conversation_messages.role = 'user';

  if not unlimited and messages_used >= 5 then
    return jsonb_build_object(
      'outcome', 'limit_reached',
      'messagesUsed', 5,
      'messagesLimit', 5,
      'tier', 'free'
    );
  end if;

  insert into public.project_conversations (project_id, kind)
  values (p_project_id, 'default')
  on conflict (project_id, kind)
  do update set updated_at = now()
  returning id into v_conversation_id;

  insert into public.project_conversation_messages (
    conversation_id,
    role,
    content,
    completion_attempt_token,
    completion_state
  ) values (
    v_conversation_id,
    'user',
    normalized_question,
    attempt_token,
    'reserved'
  )
  returning id into v_user_message_id;

  update public.projects
  set last_active_at = now()
  where id = p_project_id;

  select coalesce(jsonb_agg(message order by created_at, id), '[]'::jsonb)
  into history
  from (
    select
      jsonb_build_object(
        'id', project_conversation_messages.id,
        'inReplyToMessageId', project_conversation_messages.in_reply_to_message_id,
        'role', project_conversation_messages.role,
        'content', project_conversation_messages.content,
        'answerClassification', project_conversation_messages.answer_classification,
        'sourceSetRevision', project_conversation_messages.source_set_revision,
        'sourceManifest', project_conversation_messages.source_manifest,
        'sourceCoverage', project_conversation_messages.source_coverage,
        'citationDiagnostics', project_conversation_messages.citation_diagnostics,
        'createdAt', project_conversation_messages.created_at
      ) as message,
      project_conversation_messages.created_at,
      project_conversation_messages.id
    from public.project_conversation_messages
    where project_conversation_messages.conversation_id = v_conversation_id
      and project_conversation_messages.id <> v_user_message_id
    order by project_conversation_messages.created_at desc,
      project_conversation_messages.id desc
    limit 16
  ) as recent;

  return jsonb_build_object(
    'outcome', 'started',
    'conversationId', v_conversation_id,
    'userMessageId', v_user_message_id,
    'attemptToken', attempt_token,
    'messagesUsed', messages_used + 1,
    'messagesLimit', case when unlimited then null else 5 end,
    'tier', case when unlimited then 'pro' else 'free' end,
    'history', history
  );
end;
$$;

revoke all on function public.start_project_grounded_question(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.start_project_grounded_question(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
