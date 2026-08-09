-- Add owner-safe cursor pagination in complete user-anchored turns. Old durable
-- coverage is normalized only in the returned JSON, never rewritten.

create function public.load_project_conversation_page_v2(
  p_project_id uuid,
  p_conversation_id uuid default null,
  p_before_created_at timestamptz default null,
  p_before_user_message_id uuid default null,
  p_turn_limit integer default 25
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
  v_conversation_id uuid;
  messages jsonb := '[]'::jsonb;
  messages_used integer := 0;
  owner_tier text;
  unlimited boolean := false;
  oldest_at timestamptz;
  oldest_id uuid;
  has_earlier boolean := false;
  cleared_at timestamptz;
begin
  if request_role <> 'authenticated' or researcher_id is null
    or (p_before_created_at is null) <> (p_before_user_message_id is null)
    or p_turn_limit not between 1 and 25
  then return jsonb_build_object('outcome','missing'); end if;
  if not exists (
    select 1 from public.projects
    join public.workspaces on workspaces.id = projects.workspace_id
    where projects.id = p_project_id and workspaces.owner_id = researcher_id
  ) then return jsonb_build_object('outcome','missing'); end if;

  perform project_private.reap_expired_project_grounded_attempts_v2(
    p_project_id
  );

  select tier into owner_tier
  from public.user_subscriptions where user_id = researcher_id;
  unlimited := coalesce(owner_tier,'free') = 'pro' or (
    request_jwt ->> 'sub' = researcher_id::text
    and request_jwt @> '{
      "app_metadata": {
        "is_smoke_account": true,
        "smoke_entitlement": "pro"
      }
    }'::jsonb
  );
  if p_conversation_id is null then
    select id, project_conversations.cleared_at
    into v_conversation_id, cleared_at
    from public.project_conversations
    where project_id = p_project_id and kind = 'default'
    limit 1;
  else
    select id, project_conversations.cleared_at
    into v_conversation_id, cleared_at
    from public.project_conversations
    where project_id = p_project_id and id = p_conversation_id;
    if not found then return jsonb_build_object('outcome','missing'); end if;
  end if;

  select count(*)::integer into messages_used
  from public.project_conversation_messages as project_message
  join public.project_conversations as project_conversation
    on project_conversation.id = project_message.conversation_id
  where project_conversation.project_id = p_project_id
    and project_message.role = 'user';

  if v_conversation_id is not null then
    with selected_users as materialized (
      select id, created_at
      from public.project_conversation_messages
      where conversation_id = v_conversation_id and role = 'user'
        and created_at > coalesce(cleared_at, '-infinity'::timestamptz)
        and (
          completion_state = 'cancelled'
          or (
            completion_state = 'completed'
            and exists (
              select 1
              from public.project_conversation_messages as answer
              where answer.conversation_id = v_conversation_id
                and answer.role = 'assistant'
                and answer.in_reply_to_message_id =
                  project_conversation_messages.id
            )
          )
        )
        and (p_before_created_at is null
          or (created_at,id) < (p_before_created_at,p_before_user_message_id))
      order by created_at desc, id desc
      limit p_turn_limit
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
      value order by turn_created_at,turn_id,role_order,id
    ),'[]'::jsonb)
    into messages from page_messages;

    select id, created_at into oldest_id, oldest_at
    from public.project_conversation_messages
    where conversation_id = v_conversation_id and role = 'user'
      and created_at > coalesce(cleared_at, '-infinity'::timestamptz)
      and (
        completion_state = 'cancelled'
        or (
          completion_state = 'completed'
          and exists (
            select 1
            from public.project_conversation_messages as answer
            where answer.conversation_id = v_conversation_id
              and answer.role = 'assistant'
              and answer.in_reply_to_message_id =
                project_conversation_messages.id
          )
        )
      )
      and (p_before_created_at is null
        or (created_at,id) < (p_before_created_at,p_before_user_message_id))
    order by created_at desc, id desc
    offset greatest(p_turn_limit - 1, 0)
    limit 1;
    if oldest_id is not null then
      select exists (
        select 1 from public.project_conversation_messages
        where conversation_id = v_conversation_id and role = 'user'
          and created_at > coalesce(cleared_at, '-infinity'::timestamptz)
          and (
            completion_state = 'cancelled'
            or (
              completion_state = 'completed'
              and exists (
                select 1
                from public.project_conversation_messages as answer
                where answer.conversation_id = v_conversation_id
                  and answer.role = 'assistant'
                  and answer.in_reply_to_message_id =
                    project_conversation_messages.id
              )
            )
          )
          and (created_at,id) < (oldest_at,oldest_id)
      ) into has_earlier;
    end if;
  end if;

  return jsonb_build_object(
    'outcome','ready',
    'conversationId',v_conversation_id,
    'messages',messages,
    -- The dedicated event-page RPC is the sole v2 activity source. Keep an
    -- empty compatibility field without duplicating its query or transfer.
    'sourceSetEvents','[]'::jsonb,
    'messagesUsed',messages_used,
    'messagesLimit',case when unlimited then null else 5 end,
    'tier',case when unlimited then 'pro' else 'free' end,
    'nextCursor',case when has_earlier then jsonb_build_object(
      'createdAt',oldest_at,'userMessageId',oldest_id
    ) else null end
  );
end;
$$;

revoke all on function public.load_project_conversation_page_v2(
  uuid, uuid, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.load_project_conversation_page_v2(
  uuid, uuid, timestamptz, uuid, integer
) to authenticated;

notify pgrst, 'reload schema';
