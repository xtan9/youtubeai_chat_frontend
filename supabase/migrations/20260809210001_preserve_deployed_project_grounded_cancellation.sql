-- Keep the deployed authenticated cancellation envelope while preventing a
-- late cancel from deleting an assistant that already committed.

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
begin
  if request_role <> 'authenticated' or researcher_id is null then
    return jsonb_build_object('outcome', 'missing');
  end if;
  select messages.completion_state into attempt_state
  from public.project_conversation_messages as messages
  join public.project_conversations as conversations
    on conversations.id = messages.conversation_id
  join public.projects on projects.id = conversations.project_id
  join public.workspaces on workspaces.id = projects.workspace_id
  where messages.id = p_user_message_id
    and messages.role = 'user'
    and conversations.project_id = p_project_id
    and workspaces.owner_id = researcher_id
  for update of messages;
  if attempt_state is null then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if attempt_state = 'reserved' then
    update public.project_conversation_messages
    set completion_state = 'cancelled'
    where id = p_user_message_id
      and role = 'user'
      and completion_state = 'reserved';
  end if;
  return jsonb_build_object('outcome', 'cancelled');
end;
$$;

revoke all on function public.cancel_project_grounded_question(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_project_grounded_question(uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';
