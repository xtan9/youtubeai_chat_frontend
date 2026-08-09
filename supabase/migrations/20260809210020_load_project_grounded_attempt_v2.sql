-- Load one owned attempt by the browser's exact correlation UUID. Tokens and
-- Evidence Snapshot passage text are never returned. Each lookup first reaps
-- every expired reservation in the owned Project.

create function public.load_project_grounded_attempt_v2(
  p_project_id uuid,
  p_question_id uuid,
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
  attempt_state text;
  assistant jsonb;
begin
  if request_role <> 'authenticated' or researcher_id is null then
    return jsonb_build_object('outcome','missing');
  end if;
  if not exists (
    select 1
    from public.projects
    join public.workspaces on workspaces.id = projects.workspace_id
    where projects.id = p_project_id
      and workspaces.owner_id = researcher_id
  ) then
    return jsonb_build_object('outcome','missing');
  end if;

  perform project_private.reap_expired_project_grounded_attempts_v2(
    p_project_id
  );

  select question.completion_state
  into attempt_state
  from public.project_conversation_messages as question
  join public.project_conversations as conversations
    on conversations.id = question.conversation_id
  join public.projects on projects.id = conversations.project_id
  join public.workspaces on workspaces.id = projects.workspace_id
  where question.id = p_question_id
    and question.role = 'user'
    and conversations.project_id = p_project_id
    and (p_conversation_id is null or conversations.id = p_conversation_id)
    and workspaces.owner_id = researcher_id
  for update of question;
  if not found then return jsonb_build_object('outcome','missing'); end if;

  if attempt_state = 'completed' then
    select jsonb_build_object(
      'id', answer.id,
      'inReplyToMessageId', answer.in_reply_to_message_id,
      'role', answer.role,
      'content', answer.content,
      'answerClassification', answer.answer_classification,
      'completionState', null,
      'sourceSetRevision', answer.source_set_revision,
      'sourceManifest', answer.source_manifest,
      'sourceCoverage',
        project_private.project_grounded_normalize_coverage_v2(
          answer.source_coverage
        ),
      'citationDiagnostics', answer.citation_diagnostics,
      'mode', answer.analysis_mode,
      'createdAt', answer.created_at
    ) into assistant
    from public.project_conversation_messages as answer
    join public.project_conversation_messages as question
      on question.id = answer.in_reply_to_message_id
    join public.project_conversations as conversations
      on conversations.id = answer.conversation_id
    join public.projects on projects.id = conversations.project_id
    join public.workspaces on workspaces.id = projects.workspace_id
    where answer.role = 'assistant'
      and answer.in_reply_to_message_id = p_question_id
      and conversations.project_id = p_project_id
      and (p_conversation_id is null or conversations.id = p_conversation_id)
      and workspaces.owner_id = researcher_id;
    if assistant is null then
      return jsonb_build_object('outcome','missing');
    end if;
  end if;
  return jsonb_build_object(
    'outcome','ready',
    'userMessageId',p_question_id,
    'state',attempt_state,
    'assistant',assistant
  );
end;
$$;

revoke all on function public.load_project_grounded_attempt_v2(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.load_project_grounded_attempt_v2(uuid, uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';
