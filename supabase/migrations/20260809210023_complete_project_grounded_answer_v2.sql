-- Service-only v2 terminal write. Expensive artifact and citation validation
-- runs before locks. The serialized section locks attempt, Project, Source
-- Set, then its small member-Video set and compares mutation versions.

create function public.complete_project_grounded_answer_v2(
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
  assistant_message_id uuid;
  current_revision bigint;
  captured_video_versions jsonb := '{}'::jsonb;
  current_video_versions jsonb := '{}'::jsonb;
  citation_analysis jsonb;
  derived_diagnostics jsonb;
  terminal_classification text := p_answer_classification;
begin
  if request_role <> 'service_role' then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if normalized_mode not in (
    'question',
    'compare_viewpoints',
    'common_themes',
    'find_gaps',
    'project_assessment'
  ) then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  -- Fence ownership, Project, conversation, attempt token, and mode before
  -- every terminal fast path. A completed row from another aggregate can
  -- never be replayed through this service RPC.
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
    and workspaces.owner_id = p_owner_id;
  if not found or stored_mode is distinct from normalized_mode then
    return jsonb_build_object('outcome', 'stale');
  end if;
  if attempt_state = 'cancelled' then
    return jsonb_build_object('outcome', 'stale');
  end if;
  if attempt_state = 'completed' then
    select
      answers.id,
      answers.answer_classification,
      answers.citation_diagnostics
    into assistant_message_id, terminal_classification, derived_diagnostics
    from public.project_conversation_messages as answers
    where answers.conversation_id = p_conversation_id
      and answers.role = 'assistant'
      and answers.in_reply_to_message_id = p_user_message_id;
    if not found then return jsonb_build_object('outcome', 'stale'); end if;
    return jsonb_build_object(
      'outcome', 'already_completed',
      'assistantMessageId', assistant_message_id,
      'answerClassification', terminal_classification,
      'citationDiagnostics', derived_diagnostics
    );
  end if;

  if pg_catalog.char_length(coalesce(p_assistant_content, ''))
      not between 1 and 20000
    or not project_private.project_grounded_artifact_is_coherent_v2(
      p_project_id,
      p_source_set_revision,
      p_answer_classification,
      p_source_manifest,
      p_source_coverage,
      p_evidence_snapshot
    )
  then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  -- Capture revision plus every current member Video's evidence version before
  -- scanning canonical Transcript data. Membership-independent Video versions
  -- also fence evidence changed before a Video joined this Source Set.
  select source_sets.revision
  into current_revision
  from public.project_source_sets as source_sets
  where source_sets.project_id = p_project_id;
  if not found then
    current_revision := 0;
  end if;
  if current_revision is distinct from p_source_set_revision then
    return jsonb_build_object('outcome', 'stale');
  end if;
  select coalesce(jsonb_object_agg(
    member_video.id::text,
    member_video.evidence_version
    order by member_video.id
  ), '{}'::jsonb)
  into captured_video_versions
  from public.project_videos as membership
  join public.videos as member_video on member_video.id = membership.video_id
  where membership.project_id = p_project_id;

  citation_analysis :=
    project_private.project_grounded_citation_analysis_v2(
      p_assistant_content,
      p_source_manifest
    );
  derived_diagnostics := citation_analysis -> 'diagnostics';
  if pg_catalog.jsonb_typeof(citation_analysis) is distinct from 'object'
    or pg_catalog.jsonb_typeof(
      citation_analysis -> 'validCitationCount'
    ) is distinct from 'number'
    or pg_catalog.jsonb_typeof(
      citation_analysis -> 'allClaimsCited'
    ) is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(
      citation_analysis -> 'validSourceIds'
    ) is distinct from 'array'
    or pg_catalog.jsonb_typeof(derived_diagnostics) is distinct from 'array'
    or pg_catalog.jsonb_array_length(derived_diagnostics) > 20
    or (terminal_classification = 'supported' and (
      (citation_analysis ->> 'validCitationCount')::integer < 1
      or not (citation_analysis ->> 'allClaimsCited')::boolean
      or (
        normalized_mode in (
          'compare_viewpoints',
          'common_themes',
          'project_assessment'
        )
        and (
          select count(distinct source_row.source ->> 'videoId')
          from pg_catalog.jsonb_array_elements(
            p_source_manifest -> 'sources'
          ) as source_row(source)
          where (citation_analysis -> 'validSourceIds')
            ? (source_row.source ->> 'sourceId')
        ) < 2
      )
      or (
        normalized_mode = 'project_assessment'
        and exists (
          select 1
          from pg_catalog.jsonb_array_elements(
            p_source_manifest -> 'sources'
          ) as source_row(source)
          where not (
            (citation_analysis -> 'validSourceIds')
              ? (source_row.source ->> 'sourceId')
          )
        )
      )
    ))
  then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if not project_private.project_grounded_artifact_matches_evidence_v2(
    p_project_id,
    p_source_manifest,
    p_source_coverage,
    p_evidence_snapshot
  ) then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  select messages.completion_state, messages.analysis_mode
  into attempt_state, stored_mode
  from public.project_conversation_messages as messages
  where messages.id = p_user_message_id
    and messages.conversation_id = p_conversation_id
    and messages.role = 'user'
    and messages.completion_attempt_token = p_attempt_token
  for update of messages;
  if not found or stored_mode is distinct from normalized_mode then
    return jsonb_build_object('outcome', 'stale');
  end if;
  if attempt_state = 'completed' then
    select
      answers.id,
      answers.answer_classification,
      answers.citation_diagnostics
    into assistant_message_id, terminal_classification, derived_diagnostics
    from public.project_conversation_messages as answers
    where answers.conversation_id = p_conversation_id
      and answers.role = 'assistant'
      and answers.in_reply_to_message_id = p_user_message_id;
    return jsonb_build_object(
      'outcome', 'already_completed',
      'assistantMessageId', assistant_message_id,
      'answerClassification', terminal_classification,
      'citationDiagnostics', derived_diagnostics
    );
  end if;
  if attempt_state <> 'reserved' then
    return jsonb_build_object('outcome', 'stale');
  end if;

  perform 1
  from public.projects
  join public.workspaces on workspaces.id = projects.workspace_id
  join public.project_conversations as conversations
    on conversations.project_id = projects.id
  where projects.id = p_project_id
    and workspaces.owner_id = p_owner_id
    and conversations.id = p_conversation_id
  for update of projects;
  if not found then return jsonb_build_object('outcome', 'stale'); end if;

  select source_sets.revision
  into current_revision
  from public.project_source_sets as source_sets
  where source_sets.project_id = p_project_id
  for update of source_sets;
  if not found then
    current_revision := 0;
  end if;
  if current_revision is distinct from p_source_set_revision then
    return jsonb_build_object('outcome', 'stale');
  end if;

  perform 1
  from public.project_videos as membership
  join public.videos as member_video on member_video.id = membership.video_id
  where membership.project_id = p_project_id
  order by member_video.id
  for update of member_video;

  select coalesce(jsonb_object_agg(
    member_video.id::text,
    member_video.evidence_version
    order by member_video.id
  ), '{}'::jsonb)
  into current_video_versions
  from public.project_videos as membership
  join public.videos as member_video on member_video.id = membership.video_id
  where membership.project_id = p_project_id;
  if current_video_versions is distinct from captured_video_versions then
    return jsonb_build_object('outcome', 'stale');
  end if;

  insert into public.project_conversation_messages(
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
    completed_at,
    analysis_mode
  ) values (
    p_conversation_id,
    p_user_message_id,
    'assistant',
    p_assistant_content,
    terminal_classification,
    p_source_set_revision,
    p_source_manifest,
    p_source_coverage,
    p_evidence_snapshot,
    derived_diagnostics,
    pg_catalog.now(),
    normalized_mode
  ) returning id into assistant_message_id;

  update public.project_conversation_messages
  set completion_state = 'completed', lease_expires_at = null
  where id = p_user_message_id
    and completion_attempt_token = p_attempt_token
    and completion_state = 'reserved';
  update public.project_conversations
  set updated_at = pg_catalog.now()
  where id = p_conversation_id;

  return jsonb_build_object(
    'outcome', 'completed',
    'assistantMessageId', assistant_message_id,
    'answerClassification', terminal_classification,
    'citationDiagnostics', derived_diagnostics
  );
end;
$$;

revoke all on function public.complete_project_grounded_answer_v2(
  uuid, uuid, uuid, uuid, uuid, text, text, bigint, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.complete_project_grounded_answer_v2(
  uuid, uuid, uuid, uuid, uuid, text, text, bigint, jsonb, jsonb, jsonb, text
) to service_role;

notify pgrst, 'reload schema';
