-- Enter the authoritative persistence phase by locking the exact token-fenced
-- attempt and completing its durable assistant in one transaction. A cancel or
-- stale-attempt reaper either wins before this lock or observes the completed
-- turn after it; there is no intermediate lease that can expire mid-commit.

create function public.begin_project_grounded_answer_persistence_v2(
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
  p_mode text default 'question'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_role text := current_setting('role', true);
  normalized_mode text := coalesce(nullif(btrim(p_mode), ''), 'question');
  attempt_state text;
  stored_mode text;
begin
  if request_role <> 'service_role' then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  select messages.completion_state, messages.analysis_mode
  into attempt_state, stored_mode
  from public.project_conversation_messages as messages
  join public.project_conversations as conversations
    on conversations.id = messages.conversation_id
  join public.projects on projects.id = conversations.project_id
  join public.workspaces on workspaces.id = projects.workspace_id
  where messages.id = p_user_message_id
    and messages.conversation_id = p_conversation_id
    and messages.role = 'user'
    and messages.completion_attempt_token = p_attempt_token
    and projects.id = p_project_id
    and workspaces.owner_id = p_owner_id
  for update of messages;
  if not found
    or stored_mode is distinct from normalized_mode
    or attempt_state = 'cancelled'
  then
    return jsonb_build_object('outcome', 'stale');
  end if;

  return public.complete_project_grounded_answer_v2(
    p_owner_id,
    p_project_id,
    p_conversation_id,
    p_user_message_id,
    p_attempt_token,
    p_assistant_content,
    p_answer_classification,
    p_source_set_revision,
    p_source_manifest,
    p_source_coverage,
    p_evidence_snapshot,
    normalized_mode
  );
end;
$$;

revoke all on function public.begin_project_grounded_answer_persistence_v2(
  uuid, uuid, uuid, uuid, uuid, text, text, bigint, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.begin_project_grounded_answer_persistence_v2(
  uuid, uuid, uuid, uuid, uuid, text, text, bigint, jsonb, jsonb, jsonb, text
) to service_role;

notify pgrst, 'reload schema';
