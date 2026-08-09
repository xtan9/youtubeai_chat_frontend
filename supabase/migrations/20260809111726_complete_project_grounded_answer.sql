-- Validate and persist one terminal Grounded Answer. Only service_role can
-- cross this seam; the opaque attempt token fences stale or cross-request
-- completion and the user row is the sole in-progress artifact.

create function project_private.project_grounded_artifact_is_coherent(
  p_project_id uuid,
  p_source_set_revision bigint,
  p_answer_classification text,
  p_source_manifest jsonb,
  p_source_coverage jsonb,
  p_evidence_snapshot jsonb,
  p_citation_diagnostics jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  sources jsonb;
  passages jsonb;
  unavailable jsonb;
  total_videos integer;
  ready_videos integer;
  used_videos integer;
  passages_examined integer;
  passages_used integer;
  manifest_passages integer;
  snapshot_videos integer;
begin
  if p_source_set_revision < 0
    or p_answer_classification not in ('supported', 'abstained', 'unsupported')
    or jsonb_typeof(p_source_manifest) <> 'object'
    or jsonb_typeof(p_source_coverage) <> 'object'
    or jsonb_typeof(p_evidence_snapshot) <> 'object'
    or jsonb_typeof(p_citation_diagnostics) <> 'array'
    or octet_length(p_source_manifest::text) > 65536
    or octet_length(p_source_coverage::text) > 32768
    or octet_length(p_evidence_snapshot::text) > 131072
    or octet_length(p_citation_diagnostics::text) > 16384
  then
    return false;
  end if;

  sources := p_source_manifest -> 'sources';
  passages := p_evidence_snapshot -> 'passages';
  unavailable := p_source_coverage -> 'unavailableVideos';

  if p_source_manifest ->> 'projectId' <> p_project_id::text
    or p_evidence_snapshot ->> 'projectId' <> p_project_id::text
    or jsonb_typeof(p_source_manifest -> 'sourceSetRevision') <> 'number'
    or jsonb_typeof(p_evidence_snapshot -> 'sourceSetRevision') <> 'number'
    or jsonb_typeof(sources) <> 'array'
    or jsonb_typeof(passages) <> 'array'
    or jsonb_typeof(unavailable) <> 'array'
    or jsonb_typeof(p_source_coverage -> 'totalVideos') <> 'number'
    or jsonb_typeof(p_source_coverage -> 'readyVideos') <> 'number'
    or jsonb_typeof(p_source_coverage -> 'usedVideos') <> 'number'
    or jsonb_typeof(p_source_coverage -> 'passagesExamined') <> 'number'
    or jsonb_typeof(p_source_coverage -> 'passagesUsed') <> 'number'
    or jsonb_array_length(sources) > 5
    or jsonb_array_length(passages) > 10
    or jsonb_array_length(unavailable) > 5
    or jsonb_array_length(p_citation_diagnostics) > 20
  then
    return false;
  end if;

  begin
    if (p_source_manifest ->> 'sourceSetRevision') !~ '^(0|[1-9][0-9]*)$'
      or (p_evidence_snapshot ->> 'sourceSetRevision') !~ '^(0|[1-9][0-9]*)$'
      or (p_source_coverage ->> 'totalVideos') !~ '^(0|[1-9][0-9]*)$'
      or (p_source_coverage ->> 'readyVideos') !~ '^(0|[1-9][0-9]*)$'
      or (p_source_coverage ->> 'usedVideos') !~ '^(0|[1-9][0-9]*)$'
      or (p_source_coverage ->> 'passagesExamined') !~ '^(0|[1-9][0-9]*)$'
      or (p_source_coverage ->> 'passagesUsed') !~ '^(0|[1-9][0-9]*)$'
      or (p_source_manifest ->> 'sourceSetRevision')::bigint
        <> p_source_set_revision
      or (p_evidence_snapshot ->> 'sourceSetRevision')::bigint
        <> p_source_set_revision
    then
      return false;
    end if;

    total_videos := (p_source_coverage ->> 'totalVideos')::integer;
    ready_videos := (p_source_coverage ->> 'readyVideos')::integer;
    used_videos := (p_source_coverage ->> 'usedVideos')::integer;
    passages_examined := (p_source_coverage ->> 'passagesExamined')::integer;
    passages_used := (p_source_coverage ->> 'passagesUsed')::integer;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      return false;
  end;

  if total_videos not between 0 and 5
    or ready_videos not between 0 and 5
    or used_videos not between 0 and 5
    or passages_examined < 0
    or passages_used not between 0 and 10
    or ready_videos + jsonb_array_length(unavailable) <> total_videos
    or used_videos > ready_videos
    or passages_used > passages_examined
    or passages_used <> jsonb_array_length(passages)
    or used_videos <> jsonb_array_length(sources)
  then
    return false;
  end if;

  select count(*)::integer,
    count(distinct source ->> 'sourceId')::integer
  into manifest_passages, snapshot_videos
  from jsonb_array_elements(sources) as source_row(source)
  cross join lateral jsonb_array_elements(source -> 'passages')
    as passage_row(passage)
  where jsonb_typeof(source) = 'object'
    and source ->> 'sourceId' ~ '^S[1-5]$'
    and jsonb_typeof(source -> 'passages') = 'array';

  -- Reuse snapshot_videos temporarily above to prove source ids are unique.
  if snapshot_videos <> jsonb_array_length(sources)
    or manifest_passages <> jsonb_array_length(passages)
  then
    return false;
  end if;

  select count(distinct passage ->> 'videoId')::integer
  into snapshot_videos
  from jsonb_array_elements(passages) as passage_row(passage);

  if snapshot_videos <> used_videos then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(sources) with ordinality as manifest(source, ordinal)
    where jsonb_typeof(manifest.source) <> 'object'
      or coalesce(manifest.source ->> 'sourceId', '')
        <> 'S' || manifest.ordinal::text
      or coalesce(manifest.source ->> 'videoId', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      or coalesce(manifest.source ->> 'youtubeVideoId', '')
        !~ '^[A-Za-z0-9_-]{11}$'
      or jsonb_typeof(manifest.source -> 'passages') <> 'array'
      or jsonb_array_length(manifest.source -> 'passages') not between 1 and 10
  ) then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(passages) as evidence(passage)
    where jsonb_typeof(evidence.passage) <> 'object'
      or evidence.passage ->> 'passageId' is null
      or char_length(evidence.passage ->> 'passageId') not between 1 and 80
      or coalesce(evidence.passage ->> 'videoId', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      or coalesce(evidence.passage ->> 'youtubeVideoId', '')
        !~ '^[A-Za-z0-9_-]{11}$'
      or jsonb_typeof(evidence.passage -> 'text') <> 'string'
      or char_length(evidence.passage ->> 'text') not between 1 and 600
      or not exists (
        select 1
        from jsonb_array_elements(sources) as manifest(source)
        cross join lateral jsonb_array_elements(manifest.source -> 'passages')
          as manifest_passage(passage)
        where manifest.source ->> 'videoId' = evidence.passage ->> 'videoId'
          and manifest.source ->> 'youtubeVideoId'
            = evidence.passage ->> 'youtubeVideoId'
          and manifest_passage.passage ->> 'passageId'
            = evidence.passage ->> 'passageId'
          and manifest_passage.passage -> 'startSeconds'
            = evidence.passage -> 'startSeconds'
          and manifest_passage.passage -> 'endSeconds'
            is not distinct from evidence.passage -> 'endSeconds'
      )
  ) then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(unavailable) as item(video)
    where jsonb_typeof(item.video) <> 'object'
      or coalesce(item.video ->> 'videoId', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      or coalesce(item.video ->> 'status', '')
        not in ('processing', 'failed', 'unavailable')
  ) then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_citation_diagnostics) as diagnostic(item)
    where jsonb_typeof(diagnostic.item) <> 'object'
      or coalesce(diagnostic.item ->> 'kind', '') not in (
        'malformed', 'unknown_source', 'timestamp_not_in_evidence'
      )
      or char_length(coalesce(diagnostic.item ->> 'raw', '')) not between 1 and 80
  ) then
    return false;
  end if;

  if p_answer_classification = 'supported'
    and jsonb_array_length(passages) = 0
  then
    return false;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

revoke all on function project_private.project_grounded_artifact_is_coherent(
  uuid, bigint, text, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;

create function public.complete_project_grounded_answer(
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

  select messages.completion_state, coalesce(source_sets.revision, 0)
  into attempt_state, current_source_set_revision
  from public.project_conversation_messages as messages
  join public.project_conversations as conversations
    on conversations.id = messages.conversation_id
  join public.projects
    on projects.id = conversations.project_id
  join public.workspaces
    on workspaces.id = projects.workspace_id
  left join public.project_source_sets as source_sets
    on source_sets.project_id = projects.id
  where messages.id = p_user_message_id
    and messages.conversation_id = p_conversation_id
    and messages.role = 'user'
    and messages.completion_attempt_token = p_attempt_token
    and conversations.kind = 'default'
    and conversations.project_id = p_project_id
    and workspaces.owner_id = p_owner_id
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

notify pgrst, 'reload schema';
