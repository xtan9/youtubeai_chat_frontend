-- Wrap the final v2 contracts rather than rewriting their established
-- authorization, pagination, lease, and reconciliation semantics.
alter function public.start_project_grounded_question_v2(
  uuid, uuid, text, uuid, text
) rename to start_project_grounded_question_v2_before_analytics;
revoke all on function public.start_project_grounded_question_v2_before_analytics(
  uuid, uuid, text, uuid, text
) from public, anon, authenticated, service_role;

create function public.start_project_grounded_question_v2(
  p_project_id uuid,
  p_question_id uuid,
  p_question text,
  p_conversation_id uuid,
  p_mode text default 'question'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_result jsonb;
  canonical_ordinal bigint;
  enriched_history jsonb;
begin
  base_result := public.start_project_grounded_question_v2_before_analytics(
    p_project_id,
    p_question_id,
    p_question,
    p_conversation_id,
    p_mode
  );
  if base_result ->> 'outcome' <> 'started' then return base_result; end if;

  select ordinals.message_ordinal into canonical_ordinal
  from public.project_message_analytics_ordinals as ordinals
  where ordinals.user_message_id = (base_result ->> 'userMessageId')::uuid;

  select coalesce(
    jsonb_agg(
      project_private.with_project_message_analytics_ordinal(message.value)
      order by message.ordinality
    ),
    '[]'::jsonb
  ) into enriched_history
  from jsonb_array_elements(base_result -> 'history')
    with ordinality as message(value, ordinality);

  return base_result
    || jsonb_build_object('history', enriched_history)
    || case when canonical_ordinal between 1 and 1000000
      then jsonb_build_object('messageOrdinal', canonical_ordinal)
      else '{}'::jsonb end;
end;
$$;

revoke all on function public.start_project_grounded_question_v2(
  uuid, uuid, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.start_project_grounded_question_v2(
  uuid, uuid, text, uuid, text
) to authenticated;
