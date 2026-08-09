-- Service-only, token-fenced cancellation. Completion and cancellation lock
-- the same attempt row first, so exactly one terminal state wins.

create function public.cancel_project_grounded_question_v2(
  p_owner_id uuid,
  p_project_id uuid,
  p_conversation_id uuid,
  p_user_message_id uuid,
  p_attempt_token uuid
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
begin
  if request_role <> 'service_role' then
    return jsonb_build_object('outcome','forbidden');
  end if;
  select messages.completion_state into attempt_state
  from public.project_conversation_messages as messages
  where messages.id = p_user_message_id
    and messages.conversation_id = p_conversation_id
    and messages.role = 'user'
    and messages.completion_attempt_token = p_attempt_token
  for update of messages;
  if not found then return jsonb_build_object('outcome','stale'); end if;

  perform 1 from public.projects
  join public.workspaces on workspaces.id = projects.workspace_id
  join public.project_conversations as conversations
    on conversations.project_id = projects.id
  where projects.id = p_project_id
    and workspaces.owner_id = p_owner_id
    and conversations.id = p_conversation_id
  for update of projects;
  if not found then return jsonb_build_object('outcome','stale'); end if;

  if attempt_state = 'completed' then
    select id into assistant_message_id
    from public.project_conversation_messages
    where conversation_id = p_conversation_id
      and role = 'assistant'
      and in_reply_to_message_id = p_user_message_id;
    return jsonb_build_object(
      'outcome','completed','assistantMessageId',assistant_message_id
    );
  end if;
  if attempt_state = 'cancelled' then
    return jsonb_build_object('outcome','cancelled');
  end if;
  update public.project_conversation_messages
  set completion_state = 'cancelled', lease_expires_at = null
  where id = p_user_message_id
    and completion_attempt_token = p_attempt_token
    and completion_state = 'reserved';
  return jsonb_build_object('outcome','cancelled');
end;
$$;

revoke all on function public.cancel_project_grounded_question_v2(
  uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.cancel_project_grounded_question_v2(
  uuid, uuid, uuid, uuid, uuid
) to service_role;

notify pgrst, 'reload schema';
