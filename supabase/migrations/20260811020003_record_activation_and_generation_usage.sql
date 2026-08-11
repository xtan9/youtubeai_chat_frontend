-- A qualifying generation must activate its Project before usage admission in
-- the same transaction. Separate after() callbacks have no ordering guarantee,
-- so the first generation could otherwise be permanently classified inactive.

create or replace function public.record_project_activated_generation_usage(
  p_project_id uuid,
  p_owner_id uuid,
  p_operation_id uuid,
  p_generation_kind text,
  p_model_id text,
  p_provider_kind text,
  p_cost_status text,
  p_input_tokens bigint,
  p_cached_input_tokens bigint,
  p_output_tokens bigint,
  p_cost_usd_micros bigint,
  p_duration_ms integer,
  p_rate_card_version text,
  p_rate_card_source text,
  p_rate_card_effective_date date,
  p_error_class text,
  p_trigger_kind text,
  p_occurred_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  transition_result jsonb;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'record_project_activated_generation_usage requires service_role';
  end if;

  transition_result := public.record_project_analytics_transition(
    p_project_id,
    p_owner_id,
    p_trigger_kind,
    p_occurred_at
  );
  if transition_result ->> 'outcome' = 'missing' then
    return jsonb_build_object('outcome', 'missing');
  end if;

  return public.record_project_generation_usage(
    p_project_id,
    p_owner_id,
    p_operation_id,
    p_generation_kind,
    p_model_id,
    p_provider_kind,
    p_cost_status,
    p_input_tokens,
    p_cached_input_tokens,
    p_output_tokens,
    p_cost_usd_micros,
    p_duration_ms,
    p_rate_card_version,
    p_rate_card_source,
    p_rate_card_effective_date,
    p_error_class
  );
end;
$$;

revoke execute on function public.record_project_activated_generation_usage(
  uuid, uuid, uuid, text, text, text, text, bigint, bigint, bigint, bigint,
  integer, text, text, date, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.record_project_activated_generation_usage(
  uuid, uuid, uuid, text, text, text, text, bigint, bigint, bigint, bigint,
  integer, text, text, date, text, text, timestamptz
) to service_role;
