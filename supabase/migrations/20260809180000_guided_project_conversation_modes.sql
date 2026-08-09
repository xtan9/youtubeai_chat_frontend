-- Issue #321: persist the guided synthesis mode without creating a second
-- conversation path. The existing question/start/complete RPCs remain the
-- compatibility seams for ordinary questions; guided calls use the overloads
-- below and share the same quota, retrieval, revision, and evidence writes.

alter table public.project_conversation_messages
  add column if not exists analysis_mode text not null default 'question';

alter table public.project_conversation_messages
  drop constraint if exists project_conversation_messages_analysis_mode_check;
alter table public.project_conversation_messages
  add constraint project_conversation_messages_analysis_mode_check
  check (analysis_mode in ('question', 'compare_viewpoints', 'common_themes'));

create index if not exists project_conversation_messages_analysis_mode_idx
  on public.project_conversation_messages (conversation_id, analysis_mode, created_at);

-- Guided reservations delegate to the already-locked, owner-scoped three
-- argument RPC, then stamp only the just-created reserved user row. This keeps
-- the atomic Free cap and Source Set revision trigger in one transaction.
create or replace function public.start_project_grounded_question(
  p_project_id uuid,
  p_question text,
  p_conversation_id uuid,
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_mode text := coalesce(nullif(btrim(p_mode), ''), 'question');
  base_result jsonb;
  enriched_history jsonb;
  stamped_count integer;
begin
  if normalized_mode not in ('question', 'compare_viewpoints', 'common_themes') then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  base_result := public.start_project_grounded_question(
    p_project_id,
    p_question,
    p_conversation_id
  );

  if base_result ->> 'outcome' <> 'started' then
    return base_result;
  end if;

  update public.project_conversation_messages
  set analysis_mode = normalized_mode
  where id = (base_result ->> 'userMessageId')::uuid
    and role = 'user'
    and completion_state = 'reserved';
  get diagnostics stamped_count = row_count;
  if stamped_count <> 1 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  select coalesce(
    jsonb_agg(
      message.value || jsonb_build_object(
        'mode', coalesce(messages.analysis_mode, 'question')
      )
      order by message.ordinality
    ),
    '[]'::jsonb
  )
  into enriched_history
  from jsonb_array_elements(base_result -> 'history')
    with ordinality as message(value, ordinality)
  left join public.project_conversation_messages as messages
    on messages.id = (message.value ->> 'id')::uuid;

  return base_result
    || jsonb_build_object(
      'mode', normalized_mode,
      'history', enriched_history
    );
end;
$$;

revoke all on function public.start_project_grounded_question(uuid, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.start_project_grounded_question(uuid, text, uuid, text)
  to authenticated;

-- Enrich the #320 loader with immutable mode metadata. The legacy loader is
-- intentionally retained as the compatibility base so old rows and old
-- Source Set Evidence Snapshots continue to load unchanged.
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
  base_result jsonb;
  enriched_messages jsonb;
  source_set_events jsonb;
begin
  base_result := public.load_project_conversation_legacy(
    p_project_id,
    p_conversation_id
  );

  if base_result ->> 'outcome' <> 'ready' then
    return base_result;
  end if;

  select coalesce(
    jsonb_agg(
      message.value
      || jsonb_build_object(
        'mode', coalesce(metadata.analysis_mode, 'question')
      )
      || case
        when message.value ->> 'role' = 'assistant'
          and metadata.evidence_snapshot is not null
        then jsonb_build_object(
          'evidenceSnapshot', metadata.evidence_snapshot
        )
        else '{}'::jsonb
      end
      order by message.ordinality
    ),
    '[]'::jsonb
  )
  into enriched_messages
  from jsonb_array_elements(base_result -> 'messages')
    with ordinality as message(value, ordinality)
  left join lateral (
    select messages.analysis_mode, messages.evidence_snapshot
    from public.project_conversation_messages as messages
    where messages.id = (message.value ->> 'id')::uuid
  ) as metadata on true;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'eventId', events.id,
      'projectId', events.project_id,
      'revision', events.revision,
      'kind', events.event_kind,
      'videoId', events.video_id,
      'videoTitle', events.video_title,
      'fromPosition', events.from_position,
      'toPosition', events.to_position,
      'fromStatus', events.from_status,
      'toStatus', events.to_status,
      'createdAt', events.created_at
    ) order by events.created_at, events.id
  ), '[]'::jsonb)
  into source_set_events
  from (
    select *
    from public.project_source_set_events
    where project_id = p_project_id
    order by created_at, id
    limit 500
  ) as events;

  return base_result
    || jsonb_build_object(
      'messages', enriched_messages,
      'sourceSetEvents', source_set_events
    );
end;
$$;

revoke all on function public.load_project_conversation(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.load_project_conversation(uuid, uuid)
  to authenticated;

-- Guided completion delegates artifact validation and immutable Evidence
-- Snapshot persistence to the established 12-argument service-role RPC. The
-- user row's mode is checked before completion, and the resulting assistant
-- row receives the same mode in the same transaction.
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
  p_citation_diagnostics jsonb,
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_mode text := coalesce(nullif(btrim(p_mode), ''), 'question');
  stored_mode text;
  base_result jsonb;
begin
  if current_setting('role', true) <> 'service_role'
    or normalized_mode not in ('question', 'compare_viewpoints', 'common_themes')
  then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  select analysis_mode
  into stored_mode
  from public.project_conversation_messages
  where id = p_user_message_id
    and conversation_id = p_conversation_id
    and role = 'user'
    and completion_attempt_token = p_attempt_token
  for update;

  if stored_mode is null then
    return jsonb_build_object('outcome', 'stale');
  end if;
  if stored_mode <> normalized_mode then
    return jsonb_build_object('outcome', 'stale');
  end if;

  base_result := public.complete_project_grounded_answer(
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
    p_citation_diagnostics
  );

  if base_result ->> 'outcome' in ('completed', 'already_completed') then
    update public.project_conversation_messages
    set analysis_mode = normalized_mode
    where id = coalesce(
      (base_result ->> 'assistantMessageId')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
      and role = 'assistant'
      and in_reply_to_message_id = p_user_message_id;
  end if;

  return base_result;
end;
$$;

revoke all on function public.complete_project_grounded_answer(
  uuid, uuid, uuid, uuid, uuid, text, text, bigint, jsonb, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.complete_project_grounded_answer(
  uuid, uuid, uuid, uuid, uuid, text, text, bigint, jsonb, jsonb, jsonb, jsonb, text
) to service_role;

notify pgrst, 'reload schema';
