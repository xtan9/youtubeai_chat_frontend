alter function public.load_project_conversation_page_v2(
  uuid, uuid, timestamptz, uuid, integer
) rename to load_project_conversation_page_v2_before_analytics;
revoke all on function public.load_project_conversation_page_v2_before_analytics(
  uuid, uuid, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;

create function public.load_project_conversation_page_v2(
  p_project_id uuid,
  p_conversation_id uuid default null,
  p_before_created_at timestamptz default null,
  p_before_user_message_id uuid default null,
  p_turn_limit integer default 25
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_result jsonb;
  enriched_messages jsonb;
begin
  -- The delegated v2 implementation performs
  -- project_private.reap_expired_project_grounded_attempts_v2 before loading.
  base_result := public.load_project_conversation_page_v2_before_analytics(
    p_project_id,
    p_conversation_id,
    p_before_created_at,
    p_before_user_message_id,
    p_turn_limit
  );
  if base_result ->> 'outcome' <> 'ready' then return base_result; end if;

  select coalesce(
    jsonb_agg(
      project_private.with_project_message_analytics_ordinal(message.value)
      order by message.ordinality
    ),
    '[]'::jsonb
  ) into enriched_messages
  from jsonb_array_elements(base_result -> 'messages')
    with ordinality as message(value, ordinality);

  return base_result || jsonb_build_object('messages', enriched_messages);
end;
$$;

revoke all on function public.load_project_conversation_page_v2(
  uuid, uuid, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.load_project_conversation_page_v2(
  uuid, uuid, timestamptz, uuid, integer
) to authenticated;

alter function public.load_project_grounded_attempt_v2(uuid, uuid, uuid)
  rename to load_project_grounded_attempt_v2_before_analytics;
revoke all on function public.load_project_grounded_attempt_v2_before_analytics(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;

create function public.load_project_grounded_attempt_v2(
  p_project_id uuid,
  p_question_id uuid,
  p_conversation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_result jsonb;
begin
  -- The delegated v2 implementation performs
  -- project_private.reap_expired_project_grounded_attempts_v2 before loading.
  base_result := public.load_project_grounded_attempt_v2_before_analytics(
    p_project_id,
    p_question_id,
    p_conversation_id
  );
  if base_result ->> 'outcome' <> 'ready'
    or base_result -> 'assistant' = 'null'::jsonb then
    return base_result;
  end if;
  return jsonb_set(
    base_result,
    '{assistant}',
    project_private.with_project_message_analytics_ordinal(
      base_result -> 'assistant'
    )
  );
end;
$$;

revoke all on function public.load_project_grounded_attempt_v2(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.load_project_grounded_attempt_v2(
  uuid, uuid, uuid
) to authenticated;

notify pgrst, 'reload schema';
